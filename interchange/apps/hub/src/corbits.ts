import {
  CODEX_BASE_URL,
  CODEX_ORIGINATOR,
  CODEX_PROVIDER,
  codexOAuthConfig,
  exchangeCodexCode,
  refreshCodexTokens,
} from "@corbits/codex-provider";
import { mountMcpDiscovery } from "@corbits/mcp/hub";
import {
  createOAuthTokenRefresher,
  OAUTH_PROVIDER_METADATA_KEY,
  type OAuthLoginProviders,
  type OAuthTokenRefresher,
} from "@corbits/oauth-core/hub";
import type { DB } from "@intx/db";
import { credential, workflowRun } from "@intx/db/schema";
import type { AppEnv, RequireGrant, TenantEnv } from "@intx/hub-api";
import { pushSourceUpdates, type SidecarRouter } from "@intx/hub-sessions";
import { getLogger } from "@intx/log";
import { credentialAad, type CredentialCipher } from "@intx/types";
import { type } from "arktype";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { mountCodexDeviceLogin } from "./codex-device-login";

const log = getLogger(["hub", "corbits"]);

const TENANT_PREFIX = "/api/tenants/:tenantId";
const CodexModels = type({
  models: type({
    slug: "string",
    display_name: "string",
    visibility: "string",
    "description?": "string | null",
  }).array(),
});

export function listedCodexModels(payload: unknown) {
  const parsed = CodexModels(payload);
  if (parsed instanceof type.errors) return null;
  return parsed.models
    .filter((model) => model.visibility === "list" && model.slug)
    .map((model) => ({
      id: model.slug,
      name: model.display_name || model.slug,
      description: model.description ?? null,
    }));
}

export type MountCorbitsDeps = {
  readonly app: Hono<AppEnv>;
  readonly db: DB["db"];
  readonly credentialCipher: CredentialCipher;
  readonly requireGrant: RequireGrant;
  readonly sidecarRouter: SidecarRouter;
};

/**
 * Mounts the Corbits extensions on the hub: "Continue with Codex" login,
 * background renewal of the OAuth tokens it mints, and server-side MCP
 * catalog discovery. Returns the refresher so a caller can stop it.
 */
export function mountCorbits({
  app,
  db,
  credentialCipher,
  requireGrant,
  sidecarRouter,
}: MountCorbitsDeps): OAuthTokenRefresher {
  const providers: OAuthLoginProviders = {
    [CODEX_PROVIDER]: {
      oauthConfig: codexOAuthConfig,
      exchange: (code, verifier, now) => exchangeCodexCode(code, verifier, now),
      // The account id lives on the credential's metadata, so the prior
      // tokens need only supply the refresh secret.
      refresh: (refreshSecret, now) =>
        refreshCodexTokens(refreshSecret, now, {
          access: "",
          refresh: refreshSecret,
        }),
      // The Codex backend rejects inference without this header value.
      metadata: (tokens) =>
        "accountId" in tokens && typeof tokens.accountId === "string"
          ? { accountId: tokens.accountId }
          : {},
    },
  };

  // Device code login works when the person's browser and this hub are on
  // different machines. Only the code and login status reach the browser.
  const oauthLoginApi = new Hono<TenantEnv>();
  mountCodexDeviceLogin(oauthLoginApi, {
    db,
    cipher: credentialCipher,
    requireGrant: requireGrant("credential:*", "create"),
    onError: (error) => {
      log.error`Codex device login failed: ${String(error)}`;
    },
  });
  oauthLoginApi.get(
    "/codex-models",
    requireGrant("credential:*", "read"),
    async (c) => {
      const row = await db.query.credential.findFirst({
        where: and(
          eq(credential.tenantId, c.get("tenant").id),
          eq(credential.type, "oauth_token"),
          eq(credential.status, "active"),
          eq(
            sql`${credential.metadata} ->> ${OAUTH_PROVIDER_METADATA_KEY}`,
            CODEX_PROVIDER,
          ),
          or(
            eq(credential.principalId, c.get("principal").id),
            isNull(credential.principalId),
          ),
        ),
        orderBy: desc(credential.updatedAt),
      });
      if (!row) return c.json({ error: "Connect Codex first." }, 404);
      if (row.expiresAt && row.expiresAt <= new Date()) {
        return c.json({ error: "Codex token expired. Reconnect Codex." }, 409);
      }

      try {
        const token = await credentialCipher.decrypt(
          row.secret,
          credentialAad(row.id, "secret"),
        );
        const accountId =
          row.metadata &&
          typeof row.metadata === "object" &&
          "accountId" in row.metadata &&
          typeof row.metadata.accountId === "string"
            ? row.metadata.accountId
            : null;
        if (!accountId) {
          return c.json(
            { error: "Codex account id is missing. Reconnect Codex." },
            409,
          );
        }
        const response = await fetch(
          `${CODEX_BASE_URL}/codex/models?client_version=0.155.1`,
          {
            headers: {
              authorization: `Bearer ${token}`,
              "chatgpt-account-id": accountId,
              originator: CODEX_ORIGINATOR,
              accept: "application/json",
            },
            signal: AbortSignal.timeout(15_000),
          },
        );
        if (!response.ok) {
          return c.json(
            { error: `ChatGPT model list failed (${response.status}).` },
            502,
          );
        }
        const models = listedCodexModels(await response.json());
        if (!models) {
          return c.json(
            { error: "ChatGPT returned an invalid model list." },
            502,
          );
        }
        return c.json({ models });
      } catch (error) {
        log.error`Codex model list failed: ${String(error)}`;
        return c.json({ error: "Couldn't load ChatGPT models." }, 502);
      }
    },
  );
  // A login stores its credential as the signed-in person's own, but model
  // offerings resolve only tenant-owned credentials, so an agent cannot use
  // it. The owner can hand it to the tenant; the refresher keeps renewing it.
  oauthLoginApi.post(
    "/oauth-credentials/:credentialId/share",
    requireGrant("credential:*", "update"),
    async (c) => {
      const shared = await db
        .update(credential)
        .set({ principalId: null, updatedAt: new Date() })
        .where(
          and(
            eq(credential.id, c.req.param("credentialId")),
            eq(credential.tenantId, c.get("tenant").id),
            eq(credential.principalId, c.get("principal").id),
            eq(credential.type, "oauth_token"),
          ),
        )
        .returning({ id: credential.id });
      if (shared.length === 0) {
        return c.json(
          { error: "No OAuth credential of yours with that id here" },
          404,
        );
      }
      return c.json({ credentialId: shared[0]?.id });
    },
  );
  app.route(TENANT_PREFIX, oauthLoginApi);

  // Renews tokens ahead of expiry, then pushes the new material to running
  // sidecars the same way a stock credential rotation does.
  const refresher = createOAuthTokenRefresher({
    db,
    cipher: credentialCipher,
    providers,
    intervalMs: 60_000,
    onRefreshed: ({ tenantId, credentialId }) => {
      void pushSourceUpdates(
        db,
        sidecarRouter,
        tenantId,
        credentialCipher,
      ).catch((error: unknown) => {
        log.error`Failed to push refreshed credential ${credentialId}: ${String(error)}`;
      });
    },
    onError: (error, { provider, credentialId }) => {
      log.error`OAuth refresh failed for ${provider ?? "?"} credential ${credentialId ?? "?"}: ${String(error)}`;
    },
  });
  refresher.start();

  // The browser never holds an MCP server's token, so the catalog is read
  // here, with the secret decrypted in-process.
  const mcpApi = new Hono<TenantEnv>();
  mountMcpDiscovery(mcpApi, {
    db,
    cipher: credentialCipher,
    requireGrant: requireGrant("credential:*", "read"),
    onError: (error, { url }) => {
      log.error`MCP discovery failed for ${url}: ${String(error)}`;
    },
  });
  app.route(TENANT_PREFIX, mcpApi);

  mountChatEvents({ app, db, requireGrant, sidecarRouter });

  return refresher;
}

const KEEPALIVE_MS = 15_000;

/**
 * Live token stream for a chat deployment: the deployment's streamed text
 * (`delta`) and the end of each inference (`done`), as server-sent events.
 * The finished reply is the agent's mail, which lands in the person's
 * mailbox (./mailbox.ts); this only shows it being written.
 */
function mountChatEvents({
  app,
  db,
  requireGrant,
  sidecarRouter,
}: Pick<MountCorbitsDeps, "app" | "db" | "requireGrant" | "sidecarRouter">) {
  const chatApi = new Hono<TenantEnv>();
  chatApi.get(
    "/chat/:deploymentId/events",
    requireGrant("workflow:*", "read"),
    async (c) => {
      const deploymentId = c.req.param("deploymentId");
      const run = await db.query.workflowRun.findFirst({
        where: and(
          eq(workflowRun.id, deploymentId),
          eq(workflowRun.tenantId, c.get("tenant").id),
        ),
        columns: { id: true },
      });
      if (run === undefined) {
        return c.json({ error: "No such deployment in this tenant" }, 404);
      }
      const ownAddress = (address: string) =>
        address.toLowerCase().startsWith(`${deploymentId.toLowerCase()}@`);

      return streamSSE(c, async (stream) => {
        const send = (event: string, data: unknown) =>
          void stream.writeSSE({ event, data: JSON.stringify(data) });

        const offAgent = sidecarRouter.events.on(
          "agent.event",
          ({ agentAddress, event }) => {
            if (!ownAddress(agentAddress)) return;
            const type: unknown = Reflect.get(Object(event), "type");
            if (type === "inference.text.delta") {
              const token: unknown = Reflect.get(
                Object(Reflect.get(Object(event), "data")),
                "token",
              );
              if (typeof token === "string") send("delta", { token });
            } else if (type === "inference.done") {
              send("done", {});
            }
          },
        );
        await stream.writeSSE({ event: "ready", data: "{}" });
        const keepalive = setInterval(() => send("ping", {}), KEEPALIVE_MS);
        await new Promise<void>((resolve) => stream.onAbort(resolve));
        clearInterval(keepalive);
        offAgent();
      });
    },
  );
  app.route(TENANT_PREFIX, chatApi);
}

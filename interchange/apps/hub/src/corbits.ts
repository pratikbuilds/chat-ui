import {
  CODEX_PROVIDER,
  codexOAuthConfig,
  exchangeCodexCode,
  refreshCodexTokens,
} from "@corbits/codex-provider";
import { mountMcpDiscovery } from "@corbits/mcp/hub";
import {
  createOAuthTokenRefresher,
  mountOAuthLogin,
  type OAuthLoginProviders,
  type OAuthTokenRefresher,
} from "@corbits/oauth-core/hub";
import type { DB } from "@intx/db";
import type { AppEnv, RequireGrant, TenantEnv } from "@intx/hub-api";
import { pushSourceUpdates, type SidecarRouter } from "@intx/hub-sessions";
import { getLogger } from "@intx/log";
import type { CredentialCipher } from "@intx/types";
import { Hono } from "hono";

const log = getLogger(["hub", "corbits"]);

const TENANT_PREFIX = "/api/tenants/:tenantId";

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

  // The loopback PKCE flow runs in this process, so the verifier and the
  // callback listener never leave the hub and the browser only learns the
  // id of the credential the tokens were stored under.
  const oauthLoginApi = new Hono<TenantEnv>();
  mountOAuthLogin(oauthLoginApi, {
    db,
    cipher: credentialCipher,
    requireGrant: requireGrant("credential:*", "create"),
    providers,
    onError: (error, { provider }) => {
      log.error`OAuth login failed for ${provider}: ${String(error)}`;
    },
  });
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

  return refresher;
}

import {
  CODEX_CLIENT_ID,
  CODEX_PROVIDER,
  codexOAuthConfig,
  codexTokensFromResponse,
} from "@corbits/codex-provider";
import { exchangeCode } from "@corbits/oauth-core";
import {
  createLoginStore,
  persistOAuthCredential,
} from "@corbits/oauth-core/hub";
import type { DB } from "@intx/db";
import type { TenantEnv } from "@intx/hub-api";
import type { CredentialCipher } from "@intx/types";
import { type } from "arktype";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Hono, type MiddlewareHandler } from "hono";

const AUTH_ORIGIN = "https://auth.openai.com";
const DEVICE_URL = `${AUTH_ORIGIN}/codex/device`;
const DEVICE_API = `${AUTH_ORIGIN}/api/accounts/deviceauth`;
const DEVICE_REDIRECT = `${AUTH_ORIGIN}/deviceauth/callback`;
const LOGIN_TTL_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

const StartLogin = type({ providerId: "string", credentialName: "string" });
const UserCode = type({
  device_auth_id: "string",
  user_code: "string",
  "interval?": "string | number",
});
const DeviceCode = type({
  authorization_code: "string",
  code_challenge: "string",
  code_verifier: "string",
});

type DeviceLogin = {
  deviceAuthId: string;
  userCode: string;
  intervalMs: number;
};
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function postDevice(
  path: string,
  body: Record<string, string>,
  signal?: AbortSignal,
  fetchImpl: FetchLike = fetch,
): Promise<Response> {
  return fetchImpl(`${DEVICE_API}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

export async function requestDeviceCode(
  fetchImpl: FetchLike = fetch,
): Promise<DeviceLogin> {
  const response = await postDevice(
    "usercode",
    { client_id: CODEX_CLIENT_ID },
    undefined,
    fetchImpl,
  );
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? "Device code sign-in is unavailable. Enable it in ChatGPT settings or workspace permissions."
        : `Device code request failed (${response.status}).`,
    );
  }
  const parsed = UserCode(await response.json());
  if (
    parsed instanceof type.errors ||
    !parsed.device_auth_id ||
    !parsed.user_code
  ) {
    throw new Error("Device code service returned an invalid response.");
  }
  const interval = Number(parsed.interval ?? 5);
  return {
    deviceAuthId: parsed.device_auth_id,
    userCode: parsed.user_code,
    intervalMs: Number.isFinite(interval)
      ? Math.max(1000, Math.min(30_000, interval * 1000))
      : 5000,
  };
}

export async function waitForDeviceCode(
  login: DeviceLogin,
  signal: AbortSignal,
  fetchImpl: FetchLike = fetch,
): Promise<{ code: string; verifier: string }> {
  const deadline = Date.now() + LOGIN_TTL_MS;
  while (Date.now() < deadline) {
    await delay(login.intervalMs, undefined, { signal });
    const response = await postDevice(
      "token",
      { device_auth_id: login.deviceAuthId, user_code: login.userCode },
      signal,
      fetchImpl,
    );
    if (response.status === 403 || response.status === 404) continue;
    if (!response.ok)
      throw new Error(`Device authorization failed (${response.status}).`);
    const parsed = DeviceCode(await response.json());
    if (parsed instanceof type.errors) {
      throw new Error("Device authorization returned an invalid response.");
    }
    const challenge = createHash("sha256")
      .update(parsed.code_verifier)
      .digest("base64url");
    if (challenge !== parsed.code_challenge) {
      throw new Error(
        "Device authorization verifier did not match its challenge.",
      );
    }
    return { code: parsed.authorization_code, verifier: parsed.code_verifier };
  }
  throw new Error("Device code expired. Start sign-in again.");
}

export function mountCodexDeviceLogin(
  app: Hono<TenantEnv>,
  opts: {
    db: DB["db"];
    cipher: CredentialCipher;
    requireGrant: MiddlewareHandler<TenantEnv>;
    onError: (error: unknown) => void;
  },
): void {
  const logins = createLoginStore();
  const owner = (c: { get(key: "tenant" | "principal"): { id: string } }) => ({
    tenantId: c.get("tenant").id,
    principalId: c.get("principal").id,
  });

  app.post("/codex-device-logins", opts.requireGrant, async (c) => {
    const body = StartLogin(await c.req.json().catch(() => undefined));
    if (
      body instanceof type.errors ||
      !body.providerId ||
      !body.credentialName.trim()
    ) {
      return c.json(
        { error: "A provider and credential name are required." },
        400,
      );
    }
    let device: DeviceLogin;
    try {
      device = await requestDeviceCode();
    } catch (error) {
      opts.onError(error);
      return c.json(
        {
          error:
            error instanceof Error ? error.message : "Device sign-in failed.",
        },
        502,
      );
    }

    const identity = owner(c);
    const abort = new AbortController();
    const loginId = logins.create({
      ...identity,
      expiresAt: Date.now() + LOGIN_TTL_MS,
      abort,
      cancel: () => abort.abort(),
    });
    void (async () => {
      try {
        const { code, verifier } = await waitForDeviceCode(
          device,
          abort.signal,
        );
        const response = await exchangeCode(
          { ...codexOAuthConfig, redirectUri: DEVICE_REDIRECT },
          code,
          verifier,
        );
        const tokens = codexTokensFromResponse(response, Date.now());
        if (!tokens.accountId)
          throw new Error("Codex did not return a ChatGPT account id.");
        if (abort.signal.aborted) return;
        const credentialId = await persistOAuthCredential({
          db: opts.db,
          cipher: opts.cipher,
          ...identity,
          providerId: body.providerId,
          provider: CODEX_PROVIDER,
          name: body.credentialName,
          scopes: codexOAuthConfig.scopes,
          tokens,
          metadata: { accountId: tokens.accountId },
        });
        logins.settle(loginId, { status: "completed", credentialId });
      } catch (error) {
        if (abort.signal.aborted) return;
        opts.onError(error);
        logins.settle(loginId, {
          status: "failed",
          message: "Codex sign-in failed. Please try again.",
        });
      }
    })();
    return c.json(
      { loginId, verificationUrl: DEVICE_URL, userCode: device.userCode },
      201,
    );
  });

  app.get("/codex-device-logins/:loginId", opts.requireGrant, (c) => {
    const state = logins.read(c.req.param("loginId"), owner(c));
    return state ? c.json(state) : c.json({ error: "not_found" }, 404);
  });

  app.delete("/codex-device-logins/:loginId", opts.requireGrant, (c) =>
    logins.cancel(c.req.param("loginId"), owner(c))
      ? c.body(null, 204)
      : c.json({ error: "not_found" }, 404),
  );
}

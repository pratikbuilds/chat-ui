import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { requestDeviceCode, waitForDeviceCode } from "./codex-device-login";

test("device sign-in polls until authorized and checks the PKCE verifier", async () => {
  const verifier = "device-code-test-verifier";
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const requests: string[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    requests.push(url);
    const body: unknown = JSON.parse(String(init?.body));
    if (url.endsWith("/usercode")) {
      expect(body).toEqual({ client_id: "app_EMoamEEZ73f0CkXaXp7hrann" });
      return Response.json({
        device_auth_id: "device-1",
        user_code: "ABCD-EFGH",
        interval: "0",
      });
    }
    expect(body).toEqual({
      device_auth_id: "device-1",
      user_code: "ABCD-EFGH",
    });
    if (requests.filter((item) => item.endsWith("/token")).length === 1) {
      return new Response(null, { status: 403 });
    }
    return Response.json({
      authorization_code: "authorization-code",
      code_challenge: challenge,
      code_verifier: verifier,
    });
  };

  const login = await requestDeviceCode(fetchImpl);
  expect(login.intervalMs).toBe(1000);
  expect(
    await waitForDeviceCode(login, new AbortController().signal, fetchImpl),
  ).toEqual({
    code: "authorization-code",
    verifier,
  });
});

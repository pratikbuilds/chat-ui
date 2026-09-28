// Client for the Interchange hub (interchange/apps/hub). Requests go to
// `/api/*` on this origin; Vite proxies them to the hub in development, so
// the hub's session cookie rides along with every call.

export const CODEX_PROVIDER = "codex"
const CODEX_BASE_URL = "https://chatgpt.com/backend-api"

export type HubUser = { id: string; name: string; email: string }

export type Workspace = {
  tenantId: string
  tenantName: string
  tenantSlug: string
}

export type Provider = {
  id: string
  name: string
  plugin: string
  apiBaseUrl: string | null
}

export type Credential = {
  id: string
  providerId: string
  name: string
  type: string
  status: string
  expiresAt: string | null
}

export type CodexModel = { id: string; name: string; description: string | null }

export type LoginState =
  | { status: "pending" }
  | { status: "completed"; credentialId: string }
  | { status: "failed"; message: string }
  | { status: "cancelled" }

export class HubError extends Error {
  status: number | undefined

  constructor(message: string, status?: number) {
    super(message)
    this.name = "HubError"
    this.status = status
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers:
        body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new HubError("Can't reach the Interchange hub.")
  }
  const text = await response.text()
  const data: unknown = text ? safeJson(text) : undefined
  if (!response.ok) {
    throw new HubError(errorMessage(data, response.status), response.status)
  }
  return data as T
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function errorMessage(data: unknown, status: number): string {
  if (typeof data === "object" && data !== null) {
    for (const key of ["error", "message"]) {
      const value: unknown = Reflect.get(data, key)
      if (typeof value === "string" && value) return value
      if (typeof value === "object" && value !== null) {
        const nested: unknown = Reflect.get(value, "message")
        if (typeof nested === "string" && nested) return nested
      }
    }
  }
  return `The hub answered ${status}.`
}

const tenantPath = (tenantId: string, rest: string) =>
  `/api/tenants/${encodeURIComponent(tenantId)}${rest}`

export async function getSession(): Promise<HubUser | null> {
  const data = await request<{ user?: HubUser } | null>(
    "GET",
    "/api/auth/get-session"
  )
  return data?.user ?? null
}

export async function signIn(email: string, password: string) {
  await request("POST", "/api/auth/sign-in/email", { email, password })
}

export async function signOut() {
  await request("POST", "/api/auth/sign-out", {})
}

export async function listWorkspaces(): Promise<Workspace[]> {
  const { data } = await request<{ data: Workspace[] }>(
    "GET",
    "/api/me/principals"
  )
  return data
}

/** The tenant's Codex provider row (its own or inherited), if one exists. */
export async function findCodexProvider(
  tenantId: string
): Promise<Provider | null> {
  const { data } = await request<{ data: Provider[] }>(
    "GET",
    tenantPath(tenantId, "/providers?inherited=true")
  )
  return (
    data.find((provider) => provider.name.toLowerCase() === CODEX_PROVIDER) ??
    null
  )
}

/** The provider row a Codex credential is filed under, created on first use. */
export async function ensureCodexProvider(tenantId: string): Promise<Provider> {
  const existing = await findCodexProvider(tenantId)
  if (existing) return existing
  return request<Provider>("POST", tenantPath(tenantId, "/providers"), {
    name: CODEX_PROVIDER,
    plugin: "openai-responses",
    apiBaseUrl: CODEX_BASE_URL,
  })
}

/** The newest active Codex sign-in stored under `providerId`, if any. */
export async function findCodexCredential(
  tenantId: string,
  providerId: string
): Promise<Credential | null> {
  const { data } = await request<{ data: Credential[] }>(
    "GET",
    tenantPath(tenantId, "/credentials")
  )
  const matches = data.filter(
    (credential) =>
      credential.providerId === providerId &&
      credential.type === "oauth_token" &&
      credential.status === "active"
  )
  return matches.at(-1) ?? null
}

export async function startCodexDeviceLogin(
  tenantId: string,
  providerId: string,
  credentialName: string
): Promise<{ loginId: string; verificationUrl: string; userCode: string }> {
  return request("POST", tenantPath(tenantId, "/codex-device-logins"), {
    providerId,
    credentialName,
  })
}

export async function readDeviceLogin(
  tenantId: string,
  loginId: string
): Promise<LoginState> {
  return request("GET", tenantPath(tenantId, `/codex-device-logins/${loginId}`))
}

export async function cancelDeviceLogin(tenantId: string, loginId: string) {
  await request(
    "DELETE",
    tenantPath(tenantId, `/codex-device-logins/${loginId}`)
  )
}

export async function shareCodexCredential(
  tenantId: string,
  credentialId: string
) {
  await request(
    "POST",
    tenantPath(
      tenantId,
      `/oauth-credentials/${encodeURIComponent(credentialId)}/share`
    ),
    {}
  )
}

export async function listCodexModels(tenantId: string): Promise<CodexModel[]> {
  const { models } = await request<{ models: CodexModel[] }>(
    "GET",
    tenantPath(tenantId, "/codex-models")
  )
  return models
}

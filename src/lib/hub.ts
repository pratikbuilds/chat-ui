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

export const CHAT_ASSET_NAME = "chat-assistant"

type Asset = { id: string; name: string; kind: string }
type Deployment = {
  id: string
  definitionAssetId: string
  status: string
  createdAt: string
}

/**
 * The live deployment of the chat assistant (scripts/deploy-chat-agent.ts),
 * newest first, or null when it has not been deployed to this tenant.
 */
export async function findChatDeployment(
  tenantId: string
): Promise<string | null> {
  const assets = await request<Asset[]>(
    "GET",
    tenantPath(tenantId, "/assets?kind=workflow")
  )
  const asset = assets.find((item) => item.name === CHAT_ASSET_NAME)
  if (!asset) return null
  const deployments = await request<Deployment[]>(
    "GET",
    tenantPath(tenantId, "/workflows/deployments")
  )
  const live = deployments
    .filter(
      (item) =>
        item.definitionAssetId === asset.id && item.status === "deployed"
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return live[0]?.id ?? null
}

/** Live typing for a chat deployment: `delta` {token}, `done`, `ping`. */
export function openChatEvents(tenantId: string, deploymentId: string) {
  return new EventSource(tenantPath(tenantId, `/chat/${deploymentId}/events`))
}

// ---------------------------------------------------------------------------
// Mailbox (@corbits/mailbox on the hub): the durable record of a chat. A
// person's messages to the agent are filed in Sent, the agent's replies land
// in INBOX, and `events` announces each new one.

export type MailboxFolder = "INBOX" | "Sent"

export type MailboxMessage = {
  uid: number
  folder: MailboxFolder
  from: string[]
  to: string[]
  date: number
  text: string
}

type RawMailboxMessage = {
  uid: number
  raw: string
  envelope: { from?: unknown; to?: unknown; date?: unknown }
}

/** The tenant's mail domain: agents are addressed `<runId>@<domain>`. */
export async function getTenantDomain(tenantId: string): Promise<string> {
  const tenant = await request<{ domain: string }>(
    "GET",
    tenantPath(tenantId, "")
  )
  return tenant.domain
}

export async function listMailbox(
  tenantId: string,
  folder: MailboxFolder
): Promise<MailboxMessage[]> {
  const { messages } = await request<{ messages: RawMailboxMessage[] }>(
    "GET",
    tenantPath(tenantId, `/mailbox/me/inbox?folder=${folder}&limit=100`)
  )
  return messages.map((message) => ({
    uid: message.uid,
    folder,
    from: addresses(message.envelope.from),
    to: addresses(message.envelope.to),
    date: Date.parse(String(message.envelope.date ?? "")) || 0,
    text: mailText(message.raw),
  }))
}

export async function sendMailbox(
  tenantId: string,
  to: string,
  body: string
): Promise<void> {
  await request("POST", tenantPath(tenantId, "/mailbox/me/inbox/send"), {
    to: [to],
    subject: "Chat",
    body,
  })
}

/** Server-sent `mailbox` events {op, id}; payload-free, so refetch on one. */
export function openMailboxEvents(tenantId: string) {
  return new EventSource(tenantPath(tenantId, "/mailbox/me/inbox/events"))
}

function addresses(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value]
  return list
    .map((item) =>
      typeof item === "string"
        ? item
        : typeof item === "object" && item !== null
          ? String(
              Reflect.get(item, "email") ?? Reflect.get(item, "address") ?? ""
            )
          : ""
    )
    .map((address) =>
      address.replace(/^.*</, "").replace(/>.*$/, "").trim().toLowerCase()
    )
    .filter(Boolean)
}

/**
 * The first text/plain body of a stored message (base64 RFC 5322). Agent
 * replies are signed multipart mail; a person's sent copy is a flat message.
 */
export function mailText(rawBase64: string): string {
  const bytes = Uint8Array.from(atob(rawBase64), (char) => char.charCodeAt(0))
  return firstTextPart(new TextDecoder().decode(bytes)).trim()
}

function firstTextPart(entity: string): string {
  const split = entity.search(/\r?\n\r?\n/)
  const head = split < 0 ? entity : entity.slice(0, split)
  const body = split < 0 ? "" : entity.slice(split).replace(/^\r?\n\r?\n/, "")
  const contentType = header(head, "content-type") ?? "text/plain"
  const boundary = /boundary="?([^";\r\n]+)"?/i.exec(contentType)?.[1]
  if (/^multipart\//i.test(contentType) && boundary) {
    for (const part of body.split(`--${boundary}`).slice(1)) {
      if (part.startsWith("--")) break
      const text = firstTextPart(part.replace(/^\r?\n/, ""))
      if (text) return text
    }
    return ""
  }
  if (!/^text\/plain/i.test(contentType)) return ""
  return decodeBody(body, header(head, "content-transfer-encoding") ?? "")
}

function header(head: string, name: string): string | undefined {
  const unfolded = head.replace(/\r?\n[ \t]+/g, " ")
  const match = new RegExp(`^${name}:\\s*(.*)$`, "im").exec(unfolded)
  return match?.[1]?.trim()
}

function decodeBody(body: string, encoding: string): string {
  if (/base64/i.test(encoding)) {
    const bytes = Uint8Array.from(atob(body.replace(/\s+/g, "")), (c) =>
      c.charCodeAt(0)
    )
    return new TextDecoder().decode(bytes)
  }
  if (/quoted-printable/i.test(encoding)) {
    const bytes = body
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-F]{2})/gi, (_, hex: string) =>
        String.fromCharCode(parseInt(hex, 16))
      )
    return new TextDecoder().decode(
      Uint8Array.from(bytes, (c) => c.charCodeAt(0))
    )
  }
  return body.replace(/\r\n/g, "\n")
}

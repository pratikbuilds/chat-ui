import { type } from "arktype"
import {
  request,
  listMailbox,
  listCodexModels,
  CHAT_ASSET_NAME,
  type MailboxMessage,
} from "./hub"

const Tenant = type({
  id: "string",
  name: "string",
  domain: "string",
  parentId: "string | null",
  createdAt: "string",
})
const Principals = type({ data: type({ tenantId: "string" }).array() })
const Assets = type({ id: "string", name: "string" }).array()
const Deployments = type({
  id: "string",
  definitionAssetId: "string",
  status: "string",
  createdAt: "string",
}).array()
const Settings = type({
  model: "string > 0",
  effort: "'medium'",
  offeringId: "string",
})
const Token = type({ id: "string", secret: "string" })
const Models = type({
  data: type({
    id: "string",
    canonicalName: "string",
    disabled: "boolean",
  }).array(),
})
const Providers = type({
  data: type({ id: "string", plugin: "string", disabled: "boolean" }).array(),
})
const Offerings = type({
  data: type({
    id: "string",
    modelId: "string",
    providerId: "string",
    disabled: "boolean",
    priority: "number",
    capabilities: "string[]",
    quirks: "Record<string, unknown> | null",
  }).array(),
})
const Id = type({ id: "string" })
const base = (id: string) => `/api/tenants/${encodeURIComponent(id)}`
const settingsFile = ".chat-install.json"
const settingsCache = new Map<string, typeof Settings.infer>()

async function stock<T>(
  method: string,
  path: string,
  schema: (value: unknown) => T | type.errors,
  body?: unknown
): Promise<T> {
  const parsed = schema(await request<unknown>(method, path, body))
  if (parsed instanceof type.errors)
    throw new Error(`Unexpected Hub response: ${parsed.summary}`)
  return parsed
}

export type Conversation = {
  id: string
  deploymentId: string
  previousDeploymentIds: string[]
  domain: string
  title: string
  model: string
  effort: "medium"
  status: string
  createdAt: string
  messages: MailboxMessage[]
}

export async function ownedTenants() {
  const principals = await stock("GET", "/api/me/principals", Principals)
  return Promise.all(
    principals.data.map((row) => stock("GET", base(row.tenantId), Tenant))
  )
}

async function withToken<T>(
  tenantId: string,
  assetId: string,
  push: boolean,
  operation: (secret: string) => Promise<T>
) {
  const token = await stock("POST", `${base(tenantId)}/git-tokens`, Token, {
    name: `chat-${crypto.randomUUID()}`,
    resource: `asset:${assetId}`,
    refPattern: "refs/heads/main",
    actions: push ? ["can_read", "can_push"] : ["can_read"],
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  })
  try {
    return await operation(token.secret)
  } finally {
    await request("DELETE", `${base(tenantId)}/git-tokens/${token.id}`)
  }
}

async function readChat(tenant: typeof Tenant.infer): Promise<Conversation> {
  const [assets, deployments, inbox, sent] = await Promise.all([
    stock(
      "GET",
      `${base(tenant.id)}/assets?kind=workflow&inherited=false`,
      Assets
    ),
    stock("GET", `${base(tenant.id)}/workflows/deployments`, Deployments),
    listMailbox(tenant.id, "INBOX"),
    listMailbox(tenant.id, "Sent"),
  ])
  const asset = assets.find((row) => row.name === CHAT_ASSET_NAME)
  const runs = deployments
    .filter((row) => row.definitionAssetId === asset?.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const latest = runs[0]
  let settings: typeof Settings.infer = {
    model: "gpt-5.5",
    effort: "medium",
    offeringId: "",
  }
  if (asset && latest) {
    const key = `${tenant.id}:${latest.id}`
    const cached = settingsCache.get(key)
    if (cached) settings = cached
    else {
      const { fetchSourceFile } = await import("./git-fetch")
      const text = await withToken(tenant.id, asset.id, false, (token) =>
        fetchSourceFile({
          url:
            location.origin +
            `${base(tenant.id)}/assets/workflow/${CHAT_ASSET_NAME}.git`,
          token,
          filepath: settingsFile,
        })
      )
      settings = Settings.assert(JSON.parse(text))
      settingsCache.set(key, settings)
    }
  }
  return {
    id: tenant.id,
    deploymentId: latest?.id ?? "",
    previousDeploymentIds: runs.slice(1).map((row) => row.id),
    domain: tenant.domain,
    title: tenant.name,
    model: settings.model,
    effort: settings.effort,
    status: latest?.status ?? "released",
    createdAt: tenant.createdAt,
    messages: [...inbox, ...sent],
  }
}

export async function listConversations(parentId: string) {
  const tenants = await ownedTenants()
  const chats = await Promise.all(
    tenants.filter((tenant) => tenant.parentId === parentId).map(readChat)
  )
  return chats.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

async function ensureOffering(parentId: string, selected: string) {
  const advertised = await listCodexModels(parentId)
  if (!advertised.some((row) => row.id === selected))
    throw new Error("This model isn't available on your Codex account.")
  const [models, providers, offerings] = await Promise.all([
    stock("GET", `${base(parentId)}/catalog/models?limit=200`, Models),
    stock("GET", `${base(parentId)}/catalog/providers?limit=200`, Providers),
    stock("GET", `${base(parentId)}/catalog/offerings?limit=200`, Offerings),
  ])
  const provider = providers.data.find(
    (row) => row.plugin === "codex" && !row.disabled
  )
  const template = offerings.data.find(
    (row) => row.providerId === provider?.id && !row.disabled
  )
  if (!provider || !template)
    throw new Error("Connect Codex in this workspace first.")
  let model = models.data.find((row) => row.canonicalName === selected)
  if (model?.disabled)
    throw new Error("This model is disabled in the workspace.")
  if (!model) {
    const created = await stock(
      "POST",
      `${base(parentId)}/catalog/models`,
      Id,
      { canonicalName: selected }
    )
    model = { ...created, canonicalName: selected, disabled: false }
  }
  const existing = offerings.data.find(
    (row) => row.modelId === model.id && row.providerId === provider.id
  )
  if (existing?.disabled) throw new Error("This model offering is disabled.")
  if (existing) return existing.id
  const created = await stock(
    "POST",
    `${base(parentId)}/catalog/offerings`,
    Id,
    {
      modelId: model.id,
      providerId: provider.id,
      priority: template.priority,
      capabilities: template.capabilities,
      ...(template.quirks ? { quirks: template.quirks } : {}),
    }
  )
  return created.id
}

export async function updateConversation(
  parentId: string,
  chat: Conversation,
  model: string
) {
  const offeringId = await ensureOffering(parentId, model)
  const assets = await stock(
    "GET",
    `${base(chat.id)}/assets?kind=workflow&inherited=false`,
    Assets
  )
  const existingAsset = assets.find((row) => row.name === CHAT_ASSET_NAME)
  const assetId =
    existingAsset?.id ??
    (
      await stock("POST", `${base(chat.id)}/assets`, Id, {
        kind: "workflow",
        name: CHAT_ASSET_NAME,
      })
    ).id
  const runtime = await fetch("/chat-runtime.mjs")
  if (!runtime.ok) throw new Error("Couldn't load the chat workflow.")
  const settings = { model, effort: "medium", offeringId }
  const files = {
    "package.json": JSON.stringify({
      name: "@chat-ui/chat-assistant",
      version: "1.0.0",
      interchange: { workflow: "./workflow.mjs" },
    }),
    "runtime.mjs": await runtime.text(),
    "workflow.mjs": `import { buildChatWorkflow } from './runtime.mjs';\nexport const workflow = buildChatWorkflow(${JSON.stringify({ triggerAddress: `chat-assistant@${chat.domain}`, provider: "codex", model })});\n`,
    [settingsFile]: JSON.stringify(settings),
  }
  const { pushSourceTree } = await import("./git-push")
  const pushed = await withToken(chat.id, assetId, true, (token) =>
    pushSourceTree({
      fetch,
      url:
        location.origin +
        `${base(chat.id)}/assets/workflow/${CHAT_ASSET_NAME}.git`,
      token,
      tree: files,
      message: "Configure chat model",
    })
  )
  if (!pushed.changed && chat.status === "deployed") return chat
  const deployment = await stock(
    "POST",
    `${base(chat.id)}/workflows/deployments`,
    Id,
    {
      source: {
        kind: "asset",
        assetId,
        package: { format: "source", commitSha: pushed.commitSha },
      },
      entry: "./workflow.mjs",
      sourceOfferingIds: [offeringId],
      defaultSourceOfferingId: offeringId,
    }
  )
  settingsCache.set(`${chat.id}:${deployment.id}`, Settings.assert(settings))
  return {
    ...chat,
    deploymentId: deployment.id,
    previousDeploymentIds: [
      chat.deploymentId,
      ...chat.previousDeploymentIds,
    ].filter(Boolean),
    model,
    status: "pending",
  }
}

export async function createConversation(parentId: string) {
  const tenant = await stock("POST", "/api/tenants", Tenant, {
    name: "New chat",
    slug: `chat-${crypto.randomUUID()}`,
    parentId,
  })
  // The tenant survives a deploy failure so the next send can retry it.
  return readChat(tenant)
}

export async function nameConversation(id: string, name: string) {
  await request("PATCH", base(id), { name: name.slice(0, 120) })
}

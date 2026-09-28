// Deploys the chat assistant (agents/chat/workflow.ts) to the local
// Interchange hub, the same way interchange's bin/seed.ts deploys its
// fixture: create a workflow asset, push a bundled codebase to it over
// smart-HTTP git, then deploy it against the tenant's Codex offering.
//
// Run from the repo root (so @intx/* resolves to the vendored source):
//   cd interchange && bun --conditions=intx-src ../scripts/deploy-chat-agent.ts
//
// Auth: HUB_COOKIE_FILE=<curl cookie jar> or HUB_EMAIL + HUB_PASSWORD.
// Optional: HUB_URL (default http://localhost:3000), HUB_TENANT_SLUG
// (default: the first workspace), CHAT_MODEL (default gpt-5.5).

import { spawnSync } from "node:child_process"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const HUB = process.env["HUB_URL"] ?? "http://localhost:3000"
const MODEL = process.env["CHAT_MODEL"] ?? "gpt-5.5"
const PROVIDER = "codex"
const ASSET_NAME = "chat-assistant"
const ENTRY_FILE = "workflow.mjs"
const ENTRY = `./${ENTRY_FILE}`

const scriptsDir = import.meta.dirname
const repoRoot = path.resolve(scriptsDir, "..")
const interchangeRoot = path.join(repoRoot, "interchange")
const workflowModule = path.join(repoRoot, "agents/chat/workflow.ts")

type Json = Record<string, unknown>

async function cookieHeader(): Promise<string> {
  const jar = process.env["HUB_COOKIE_FILE"]
  if (jar) {
    // Netscape cookie-jar lines: domain, flag, path, secure, expiry, name, value.
    const lines = (await readFile(jar, "utf-8")).split("\n")
    return lines
      .map((line) => line.replace(/^#HttpOnly_/, ""))
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split("\t"))
      .filter((cols) => cols.length >= 7)
      .map((cols) => `${cols[5]}=${cols[6]}`)
      .join("; ")
  }
  const email = process.env["HUB_EMAIL"]
  const password = process.env["HUB_PASSWORD"]
  if (!email || !password) {
    throw new Error("Set HUB_COOKIE_FILE, or HUB_EMAIL and HUB_PASSWORD")
  }
  const res = await fetch(`${HUB}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: HUB },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new Error(`Sign-in failed: ${res.status}`)
  return res.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ")
}

async function api<T = Json>(
  cookie: string,
  method: string,
  route: string,
  body?: unknown
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${HUB}${route}`, {
    method,
    headers: {
      cookie,
      origin: HUB,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data: unknown = text
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    // Non-JSON bodies (e.g. a bare "Internal Server Error") stay as text.
  }
  return { status: res.status, data: data as T }
}

function must<T>(label: string, result: { status: number; data: T }, ok: number[]): T {
  if (!ok.includes(result.status)) {
    throw new Error(`${label} failed (${result.status}): ${JSON.stringify(result.data)}`)
  }
  return result.data
}

/** Bundles the workflow entry into one ESM file with @intx/* inlined. */
async function bundleEntry(input: Json): Promise<string> {
  const scratch = await mkdtemp(path.join(tmpdir(), "chat-agent-bundle-"))
  try {
    const entryPath = path.join(scratch, "entry.ts")
    await writeFile(
      entryPath,
      `import { buildChatWorkflow } from ${JSON.stringify(workflowModule)};\n` +
        `export const workflow = buildChatWorkflow(${JSON.stringify(input)});\n`
    )
    const built = await Bun.build({
      entrypoints: [entryPath],
      target: "bun",
      format: "esm",
      throw: true,
      plugins: [
        {
          name: "resolve-intx-to-source",
          setup(build) {
            build.onResolve({ filter: /^@intx\// }, (args) => {
              const fromDir = args.importer.startsWith(interchangeRoot + path.sep)
                ? path.dirname(args.importer)
                : interchangeRoot
              return { path: Bun.resolveSync(args.path, fromDir) }
            })
          },
        },
      ],
    })
    const code = await built.outputs[0]?.text()
    if (!code) throw new Error("Bundling produced no output")
    if (code.includes("@intx/")) throw new Error("Bundle still imports @intx/*")
    return code
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

function git(args: string[], cwd: string, env: Record<string, string>) {
  const r = spawnSync("git", args, { cwd, env: { ...process.env, ...env }, encoding: "utf-8" })
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr || r.stdout}`)
  return r.stdout.trim()
}

/** Pushes the codebase to the asset's git repo and returns the commit sha. */
async function pushCodebase(
  tenantId: string,
  token: string,
  files: Record<string, string>
): Promise<string> {
  const work = await mkdtemp(path.join(tmpdir(), "chat-agent-push-"))
  try {
    const askpass = path.join(work, "askpass.sh")
    await writeFile(askpass, `#!/bin/sh\nprintf '%s\\n' '${token.replace(/'/g, "'\\''")}'\n`)
    await chmod(askpass, 0o755)
    const env = {
      GIT_ASKPASS: askpass,
      GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_NAME: "chat-ui",
      GIT_AUTHOR_EMAIL: "chat-ui@localhost",
      GIT_COMMITTER_NAME: "chat-ui",
      GIT_COMMITTER_EMAIL: "chat-ui@localhost",
    }
    const remote = new URL(`${HUB}/api/tenants/${tenantId}/assets/workflow/${ASSET_NAME}.git`)
    remote.username = "x-access-token"
    const repo = path.join(work, "repo")
    git(["-c", "credential.helper=", "clone", remote.toString(), repo], work, env)
    for (const [name, content] of Object.entries(files)) {
      await writeFile(path.join(repo, name), content)
    }
    git(["add", "-A"], repo, env)
    const dirty = spawnSync("git", ["diff", "--cached", "--quiet"], { cwd: repo }).status !== 0
    if (dirty) {
      git(["commit", "-m", "Deploy chat assistant"], repo, env)
      git(["-c", "credential.helper=", "push", remote.toString(), "HEAD:main"], repo, env)
    }
    return git(["rev-parse", "HEAD"], repo, env)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

const cookie = await cookieHeader()

const workspaces = must(
  "list workspaces",
  await api<{ data: { tenantId: string; tenantSlug: string; tenantName: string }[] }>(
    cookie,
    "GET",
    "/api/me/principals"
  ),
  [200]
).data
const slug = process.env["HUB_TENANT_SLUG"]
const workspace = slug ? workspaces.find((w) => w.tenantSlug === slug) : workspaces[0]
if (!workspace) throw new Error(`No workspace ${slug ?? ""} for this user`)
const tenant = `/api/tenants/${workspace.tenantId}`
console.log(`Workspace: ${workspace.tenantName} (${workspace.tenantId})`)

// The Codex offering the agent runs on: model MODEL served by a codex provider.
const models = must("list models", await api<{ data: Json[] }>(cookie, "GET", `${tenant}/catalog/models?limit=200`), [200]).data
const model = models.find((m) => m["canonicalName"] === MODEL)
const providers = must("list providers", await api<{ data: Json[] }>(cookie, "GET", `${tenant}/catalog/providers?limit=200`), [200]).data
const codexProviderIds = new Set(providers.filter((p) => p["plugin"] === PROVIDER).map((p) => p["id"]))
const offerings = must("list offerings", await api<{ data: Json[] }>(cookie, "GET", `${tenant}/catalog/offerings?limit=200`), [200]).data
const offering = offerings.find(
  (o) => o["modelId"] === model?.["id"] && codexProviderIds.has(o["providerId"]) && !o["disabled"]
)
if (!offering) {
  throw new Error(`No Codex offering for ${MODEL}. Connect Codex in chat-ui first.`)
}
const offeringId = String(offering["id"])
console.log(`Codex offering: ${offeringId}`)

// Workflow asset (created once, reused on later deploys).
const created = await api<Json>(cookie, "POST", `${tenant}/assets`, { kind: "workflow", name: ASSET_NAME })
let assetId: string
if (created.status === 201) {
  assetId = String(created.data["id"])
} else {
  const assets = must("list assets", await api<Json[]>(cookie, "GET", `${tenant}/assets?kind=workflow`), [200])
  const existing = assets.find((a) => a["name"] === ASSET_NAME)
  if (!existing) throw new Error(`Create asset failed: ${JSON.stringify(created.data)}`)
  assetId = String(existing["id"])
}

const token = must(
  "mint git token",
  await api<{ secret: string }>(cookie, "POST", `${tenant}/git-tokens`, {
    name: `chat-ui-deploy-${Date.now()}`,
    resource: "asset:*",
    refPattern: "**",
    actions: ["can_read", "can_push"],
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  }),
  [201]
)

const workflowCode = await bundleEntry({
  triggerAddress: `chat-assistant@${workspace.tenantSlug}.localhost`,
  provider: PROVIDER,
  model: MODEL,
})
const commitSha = await pushCodebase(workspace.tenantId, token.secret, {
  "package.json": `${JSON.stringify(
    { name: "@chat-ui/chat-assistant", version: "1.0.0", interchange: { workflow: ENTRY } },
    null,
    2
  )}\n`,
  [ENTRY_FILE]: workflowCode,
})
console.log(`Pushed ${ASSET_NAME} at ${commitSha.slice(0, 7)}`)

const deployed = must(
  "deploy",
  await api<Json>(cookie, "POST", `${tenant}/workflows/deployments`, {
    source: { kind: "asset", assetId, package: { format: "source", commitSha } },
    entry: ENTRY,
    sourceOfferingIds: [offeringId],
    defaultSourceOfferingId: offeringId,
  }),
  [200, 201, 202]
)
console.log("Deployed:", JSON.stringify(deployed, null, 2))

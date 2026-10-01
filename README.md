# Interchange Chat UI

A React chat client for an Interchange Hub. It signs in to ChatGPT with a
Codex device code, keeps separate conversations, lets you switch between the
account's available models, and displays live
agent replies. The Hub and sidecar integration lives in the vendored
`interchange/` source.

## Local development

Install dependencies with `bun install` here and in `interchange/`. Follow
[`interchange/DEV.md`](interchange/DEV.md) to configure PostgreSQL, initialize
the Hub, and seed a development account. Live agent deployment also needs a
sidecar provisioner and the Codex adapter; the default production Hub
composition does not register a provisioner. The local test harness used for
development is `interchange/tests/admin-ui-e2e/harness/hub.ts`.

Start the client with `bun run dev`. Vite proxies `/api` to the local Hub at
`http://localhost:3000`. After connecting Codex in the UI, deploy the chat
agent with `scripts/deploy-chat-agent.ts`; its header documents the required
environment variables and invocation.

## Deployment

Deploy production only from a clean `main` checkout after merging the PR.
Do not upload feature branches or uncommitted work to Railway. Run
`git pull --ff-only` on `main`, then deploy the UI from the repository root
and the Hub from `interchange/`.

The Railway test project has separate `chat-ui`, `interchange-hub`, and Postgres
services. The client proxies `/api` to the Hub over Railway's private network.
Set `BETTER_AUTH_BASE_URL` to the client's public HTTPS origin so sign-in and
session cookies match. The Hub uses a volume for its data and a single replica
because device logins are held in process memory. Its Railway entry uses the
existing local-process sidecar provisioner and loads the Codex adapter.

The live deployment has passed page, OpenAPI, API proxy, and sign-in checks.
Public email sign-up is enabled so colleagues can create accounts. To test an
agent reply, connect Codex in the UI, register a catalog offering for an
available model and the shared credential, then run
`scripts/deploy-chat-agent.ts` against the client's origin. The local-process
provisioner is intended for this single-instance test deployment.

The vendored Interchange source is licensed under
[`LGPL-2.1-only`](interchange/LICENSE). This repository has no license for
the chat client itself.

Each chat is a child tenant, following Workbench. The sidebar lists owned child tenants; their `Sent` and `INBOX` mailboxes supply the complete transcript. Model changes publish the workflow asset and redeploy through stock catalog, Git and workflow APIs. No chat-specific Hub route or database table is used. Old workspace mail remains available under Previous chats.

`bun run build` generates the workflow runtime bundle from `agents/chat/workflow.ts` before building the UI. Install dependencies in both this directory and `interchange/` first.

Run `bun --tsconfig-override tsconfig.app.json scripts/check-conversations.ts` for the mailbox isolation and redeployment-history check.

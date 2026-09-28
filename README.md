# Interchange Chat UI

A React chat client for an Interchange Hub. It signs in to ChatGPT with a
Codex device code, shows the account's available models, and displays live
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

Serve the client and proxy `/api` to the Hub under one HTTPS origin. Set the
Hub's `BETTER_AUTH_BASE_URL` to that origin so sign-in and session cookies
match the client, and keep server-sent events streaming through the proxy.
The deployment also needs a sidecar provisioner and Codex adapter. Device
logins are held in Hub process memory, so use one Hub replica for login or
pin login requests to a replica. Cloud deployment has not yet been verified.

The vendored Interchange source is licensed under
[`LGPL-2.1-only`](interchange/LICENSE). This repository has no license for
the chat client itself.

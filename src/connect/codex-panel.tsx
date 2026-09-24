import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react"
import { CheckCircle2, ExternalLink, Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  cancelLogin,
  ensureCodexProvider,
  readLogin,
  startCodexLogin,
} from "@/lib/hub"
import type { Hub } from "./use-hub"

const POLL_MS = 1500

type CodexPanelProps = {
  hub: Hub
  onClose: () => void
}

/** Sign in to the hub, pick a workspace, and connect a Codex subscription. */
export function CodexPanel({ hub, onClose }: CodexPanelProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const { state } = hub
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <button
        className="absolute inset-0 bg-black/25"
        aria-label="Close"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="codex-panel-title"
        className="relative w-full max-w-md rounded-2xl border border-[#ECE9E4] bg-white p-6 font-['Red_Hat_Display'] text-[#1F1B18] shadow-[0_12px_40px_#1F1B1826]"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 id="codex-panel-title" className="text-lg font-semibold">
              Account & models
            </h2>
            <p className="text-sm text-muted-foreground">
              Connect your ChatGPT subscription to chat with Codex.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>

        {state.phase === "loading" && <Status>Connecting to the hub…</Status>}

        {state.phase === "offline" && (
          <div className="space-y-3">
            <p className="rounded-lg bg-[#FBEDEC] px-3 py-2 text-sm text-[#9B2C22]">
              {state.message}
            </p>
            <Button variant="outline" onClick={() => void hub.reload()}>
              Try again
            </Button>
          </div>
        )}

        {state.phase === "signed-out" && <SignInForm hub={hub} />}

        {state.phase === "ready" && (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">
                Signed in as{" "}
                <span className="font-semibold">{state.user.email}</span>
              </span>
              <Button
                variant="link"
                size="xs"
                className="text-muted-foreground"
                onClick={() => void hub.signOut()}
              >
                Sign out
              </Button>
            </div>

            {state.workspaces.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                You are not a member of any workspace yet.
              </p>
            ) : (
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Workspace
                </span>
                <select
                  className="h-9 w-full rounded-lg border border-[#ECE9E4] bg-white px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  value={state.tenantId ?? ""}
                  onChange={(event) =>
                    void hub.selectWorkspace(event.target.value)
                  }
                >
                  {state.workspaces.map((workspace) => (
                    <option key={workspace.tenantId} value={workspace.tenantId}>
                      {workspace.tenantName}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {state.tenantId && (
              <CodexCard
                key={state.tenantId}
                hub={hub}
                tenantId={state.tenantId}
                email={state.user.email}
              />
            )}
          </div>
        )}
      </section>
    </div>
  )
}

function Status({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {children}
    </p>
  )
}

function SignInForm({ hub }: { hub: Hub }) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await hub.signIn(email, password)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setBusy(false)
    }
  }

  const field =
    "h-9 w-full rounded-lg border border-[#ECE9E4] bg-white px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
  return (
    <form className="space-y-3" onSubmit={(event) => void submit(event)}>
      <p className="text-sm">Sign in to your Interchange hub first.</p>
      <input
        className={field}
        type="email"
        autoComplete="username"
        placeholder="Email"
        aria-label="Email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        required
      />
      <input
        className={field}
        type="password"
        autoComplete="current-password"
        placeholder="Password"
        aria-label="Password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
      />
      {error && <p className="text-sm text-[#9B2C22]">{error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : null}
        Sign in
      </Button>
    </form>
  )
}

type LoginFlow =
  | { step: "idle" }
  | { step: "starting" }
  | { step: "waiting"; loginId: string; authorizeUrl: string }
  | { step: "error"; message: string }

function CodexCard({
  hub,
  tenantId,
  email,
}: {
  hub: Hub
  tenantId: string
  email: string
}) {
  const [flow, setFlow] = useState<LoginFlow>({ step: "idle" })
  const pending = useRef<string | null>(null)
  const codex = hub.state.phase === "ready" ? hub.state.codex : undefined
  const { refreshCodex } = hub

  // Poll the hub while the person finishes signing in on OpenAI's page.
  const waitingId = flow.step === "waiting" ? flow.loginId : null
  useEffect(() => {
    if (!waitingId) return
    let stopped = false
    const timer = window.setInterval(async () => {
      try {
        const login = await readLogin(tenantId, waitingId)
        if (stopped || login.status === "pending") return
        pending.current = null
        if (login.status === "completed") {
          setFlow({ step: "idle" })
          await refreshCodex(tenantId)
        } else if (login.status === "failed") {
          setFlow({ step: "error", message: login.message })
        } else {
          setFlow({ step: "idle" })
        }
      } catch (cause) {
        if (!stopped) {
          setFlow({
            step: "error",
            message: cause instanceof Error ? cause.message : String(cause),
          })
        }
      }
    }, POLL_MS)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [waitingId, tenantId, refreshCodex])

  // An abandoned login holds the hub's fixed callback port; free it.
  useEffect(
    () => () => {
      if (pending.current) void cancelLogin(tenantId, pending.current)
    },
    [tenantId]
  )

  async function connect() {
    // Open the tab now, while the click still counts as a user gesture, so
    // the browser does not block it once the hub answers.
    const tab = window.open("", "_blank")
    setFlow({ step: "starting" })
    try {
      const provider = await ensureCodexProvider(tenantId)
      const login = await startCodexLogin(
        tenantId,
        provider.id,
        codex?.name ?? `codex-${email}`
      )
      pending.current = login.loginId
      if (tab) tab.location.href = login.authorizeUrl
      setFlow({ step: "waiting", ...login })
    } catch (cause) {
      tab?.close()
      setFlow({
        step: "error",
        message: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }

  async function cancel() {
    if (flow.step !== "waiting") return
    pending.current = null
    setFlow({ step: "idle" })
    await cancelLogin(tenantId, flow.loginId).catch(() => undefined)
  }

  return (
    <div className="rounded-xl border border-[#ECE9E4] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Codex</p>
          <p className="truncate text-xs text-muted-foreground">
            {codex === undefined
              ? "Checking…"
              : codex
                ? `Connected · renews before ${formatDate(codex.expiresAt)}`
                : "GPT models on your ChatGPT subscription"}
          </p>
        </div>
        {codex ? (
          <CheckCircle2 className="size-5 shrink-0 text-[#2F7D4F]" />
        ) : null}
      </div>

      {flow.step === "waiting" ? (
        <div className="mt-4 space-y-3">
          <Status>Finish signing in with ChatGPT in the new tab…</Status>
          <div className="flex gap-2">
            <Button
              variant="outline"
              render={
                <a href={flow.authorizeUrl} target="_blank" rel="noreferrer" />
              }
            >
              <ExternalLink />
              Open sign-in page
            </Button>
            <Button variant="ghost" onClick={() => void cancel()}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          className="mt-4 w-full"
          size="lg"
          variant={codex ? "outline" : "default"}
          disabled={codex === undefined || flow.step === "starting"}
          onClick={() => void connect()}
        >
          {flow.step === "starting" && <Loader2 className="animate-spin" />}
          {codex ? "Reconnect Codex" : "Continue with Codex"}
        </Button>
      )}

      {flow.step === "error" && (
        <p className="mt-3 text-sm text-[#9B2C22]">{flow.message}</p>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Sign-in works only when this browser runs on the same computer as the
        hub.
      </p>
    </div>
  )
}

function formatDate(value: string | null): string {
  if (!value) return "it expires"
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
}

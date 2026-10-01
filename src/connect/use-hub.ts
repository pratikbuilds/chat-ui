import { ownedTenants } from "@/lib/workbench"
import { useCallback, useEffect, useState } from "react"
import {
  findChatDeployment,
  findCodexCredential,
  findCodexProvider,
  getSession,
  listWorkspaces,
  signIn as hubSignIn,
  signOut as hubSignOut,
  type Credential,
  type HubUser,
  type Workspace,
} from "@/lib/hub"

const WORKSPACE_KEY = "chat-ui.workspace"

export type HubState =
  | { phase: "loading" }
  | { phase: "offline"; message: string }
  | { phase: "signed-out" }
  | {
      phase: "ready"
      user: HubUser
      workspaces: Workspace[]
      tenantId: string | null
      /** undefined while the workspace's Codex status is loading. */
      codex: Credential | null | undefined
      /** The live chat-assistant deployment id, when one is deployed. */
      chat: string | null
    }

function rememberedWorkspace(workspaces: Workspace[]): string | null {
  let saved: string | null = null
  try {
    saved = window.localStorage.getItem(WORKSPACE_KEY)
  } catch {
    // Storage can be unavailable (private mode); fall back to the first.
  }
  const match = workspaces.find((workspace) => workspace.tenantId === saved)
  return (match ?? workspaces[0])?.tenantId ?? null
}

async function loadCodex(tenantId: string): Promise<Credential | null> {
  const provider = await findCodexProvider(tenantId)
  return provider ? findCodexCredential(tenantId, provider.id) : null
}

/** Reads the whole hub state: session, workspaces and Codex status. */
async function readHub(): Promise<HubState> {
  try {
    const user = await getSession()
    if (!user) return { phase: "signed-out" }
    const [allWorkspaces, tenants] = await Promise.all([
      listWorkspaces(),
      ownedTenants(),
    ])
    const roots = new Set(
      tenants
        .filter((tenant) => tenant.parentId === null)
        .map((tenant) => tenant.id)
    )
    const workspaces = allWorkspaces.filter((workspace) =>
      roots.has(workspace.tenantId)
    )
    const tenantId = rememberedWorkspace(workspaces)
    const codex = tenantId ? await loadCodex(tenantId) : null
    const chat = tenantId ? await findChatDeployment(tenantId) : null
    return { phase: "ready", user, workspaces, tenantId, codex, chat }
  } catch (error) {
    return {
      phase: "offline",
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

/** Session, workspace and Codex connection state from the hub. */
export function useHub() {
  const [state, setState] = useState<HubState>({ phase: "loading" })

  useEffect(() => {
    let active = true
    void readHub().then((next) => {
      if (active) setState(next)
    })
    return () => {
      active = false
    }
  }, [])

  const load = useCallback(async () => {
    setState(await readHub())
  }, [])

  const signIn = useCallback(
    async (email: string, password: string) => {
      await hubSignIn(email, password)
      await load()
    },
    [load]
  )

  const signOut = useCallback(async () => {
    await hubSignOut()
    setState({ phase: "signed-out" })
  }, [])

  const selectWorkspace = useCallback(async (tenantId: string) => {
    try {
      window.localStorage.setItem(WORKSPACE_KEY, tenantId)
    } catch {
      // Not remembering the choice is fine.
    }
    setState((current) =>
      current.phase === "ready"
        ? { ...current, tenantId, codex: undefined, chat: null }
        : current
    )
    const [codex, chat] = await Promise.all([
      loadCodex(tenantId),
      findChatDeployment(tenantId),
    ])
    setState((current) =>
      current.phase === "ready" && current.tenantId === tenantId
        ? { ...current, codex, chat }
        : current
    )
  }, [])

  const refreshCodex = useCallback(async (tenantId: string) => {
    const codex = await loadCodex(tenantId)
    setState((current) =>
      current.phase === "ready" && current.tenantId === tenantId
        ? { ...current, codex }
        : current
    )
  }, [])

  return { state, reload: load, signIn, signOut, selectWorkspace, refreshCodex }
}

export type Hub = ReturnType<typeof useHub>

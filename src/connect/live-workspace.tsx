import { useCallback, useState } from "react"
import { Loader2, Menu, Share2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sidebar } from "@/chat/sidebar"
import { ChatThread } from "@/chat/thread"
import { Composer } from "@/chat/composer"
import { CodexPanel } from "./codex-panel"
import type { Hub } from "./use-hub"
import { chatProgress, useConversations } from "./use-conversations"

export function LiveWorkspace({
  hub,
  tenantId,
}: {
  hub: Hub
  tenantId: string
}) {
  const conversations = useConversations(tenantId)
  const [activeId, setActiveId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(`chat-ui.active.${tenantId}`)
    } catch {
      return null
    }
  })
  const [query, setQuery] = useState("")
  const [mobileOpen, setMobileOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const closeAccount = useCallback(() => setAccountOpen(false), [])
  const openSidebar = useCallback(() => setMobileOpen(true), [])
  const select = (id: string) => {
    setActiveId(id)
    setMobileOpen(false)
    try {
      localStorage.setItem(`chat-ui.active.${tenantId}`, id)
    } catch {
      /* The Hub still stores the chat. */
    }
  }
  const selected =
    conversations.items.find((item) => item.id === activeId) ??
    conversations.items[0]
  const chats = conversations.items.map((item, index) => {
    const messages = conversations.messagesFor(item)
    return {
      id: index + 1,
      title: item.title,
      preview: messages.at(-1)?.text ?? "Start a conversation",
      time: "Now",
      messages,
    }
  })
  const index = conversations.items.findIndex(
    (item) => item.id === selected?.id
  )
  const chat = chats[index] ?? {
    id: 0,
    title: "New chat",
    preview: "Start a conversation",
    time: "Now",
    messages: [],
  }
  const pending = selected ? conversations.pending[selected.id] : undefined
  const starting =
    !!selected &&
    !["deployed", "failed", "released", "destroy_failed"].includes(
      selected.status
    )
  const unavailable =
    conversations.loading ||
    conversations.busy ||
    starting ||
    !selected ||
    (!!pending && !pending.streaming)
  const stream = pending?.streaming
    ? {
        chatId: chat.id,
        step: 0,
        reply: pending.text,
        booking: false,
        live: true as const,
        status: chatProgress[pending.phase],
      }
    : null
  const newChat = async () => {
    const id = await conversations.create()
    if (id) {
      setQuery("")
      select(id)
    }
  }
  const share = async () => {
    await navigator.clipboard.writeText(
      chat.messages
        .map((message) => `${message.role}: ${message.text}`)
        .join("\n\n")
    )
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }
  return (
    <div className="flex h-svh min-h-[400px] overflow-hidden bg-white font-['Red_Hat_Display'] text-[#1F1B18]">
      <Sidebar
        chats={chats}
        canCreate={!conversations.busy && !conversations.loading}
        creating={conversations.operation === "Creating chat…"}
        activeId={chat.id}
        query={query}
        onQueryChange={setQuery}
        mobileOpen={mobileOpen}
        onOpen={openSidebar}
        onClose={() => setMobileOpen(false)}
        onNew={() => void newChat()}
        onSelect={(id) => {
          const item = conversations.items[id - 1]
          if (item) select(item.id)
        }}
        account={{
          name:
            hub.state.phase === "ready"
              ? hub.state.user.name || hub.state.user.email
              : "Codex",
          detail: "Chatting with Codex",
        }}
        onAccount={() => {
          setAccountOpen(true)
          setMobileOpen(false)
        }}
      />
      <main className="flex min-w-0 flex-1 flex-col bg-white">
        <header className="flex h-[60px] shrink-0 items-center justify-between gap-2 border-b border-[#F1EFEB] px-4 md:px-7">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              className="md:hidden"
              aria-label="Open sidebar"
              onClick={openSidebar}
            >
              <Menu />
            </Button>
            <h1 className="truncate text-base font-semibold">{chat.title}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {selected && (
              <span
                className="flex h-8 items-center gap-1.5 rounded-md border border-[#ECE9E4] bg-[#FAF9F7] px-2 text-xs text-muted-foreground"
                title={`Child tenant ID: ${selected.id}`}
              >
                <span className="hidden sm:inline">Tenant</span>
                <code
                  className="max-w-[110px] truncate select-text sm:max-w-none"
                  aria-label="Child tenant ID"
                >
                  {selected.id}
                </code>
              </span>
            )}
            <Button
              variant="outline"
              className="h-8"
              onClick={() => void share()}
              disabled={!chat.messages.length}
            >
              <Share2 />
              {copied ? "Copied" : "Share"}
            </Button>
          </div>
        </header>
        <ChatThread
          chat={chat}
          stream={stream}
          live
          unavailable={false}
          loading={conversations.loading}
          onRegenerate={(messageIndex) => {
            const prompt = chat.messages
              .slice(0, messageIndex)
              .findLast((message) => message.role === "user")?.text
            if (selected && prompt && !pending)
              void conversations.send(selected, prompt)
          }}
        />
        {conversations.error && (
          <p
            role="alert"
            className="mx-auto w-full max-w-[720px] px-4 py-2 text-sm text-[#9B2C22]"
          >
            {conversations.error}
          </p>
        )}
        {selected &&
          !pending &&
          !conversations.busy &&
          ["failed", "released", "destroy_failed"].includes(selected.status) &&
          chat.messages.at(-1)?.role === "user" && (
            <Button
              className="mx-auto mb-3"
              onClick={() => {
                const prompt = chat.messages.at(-1)?.text
                if (prompt) void conversations.send(selected, prompt)
              }}
            >
              Retry message
            </Button>
          )}
        {(conversations.operation || (starting && !pending)) && (
          <p
            role="status"
            className="flex items-center justify-center gap-2 px-4 py-3 text-sm text-muted-foreground"
          >
            <Loader2
              aria-hidden="true"
              className="size-4 animate-spin motion-reduce:animate-none"
            />
            {conversations.operation ?? "Starting your chat agent…"}
          </p>
        )}
        {!selected && !conversations.loading && (
          <Button
            className="mx-auto mb-4"
            onClick={() => void newChat()}
            disabled={conversations.busy}
          >
            New chat
          </Button>
        )}
        {pending && !pending.streaming && (
          <p
            role="status"
            className="text-center text-sm text-muted-foreground"
          >
            Waiting for reply. You can use another chat meanwhile.
          </p>
        )}
        {selected &&
          !chat.messages.length &&
          !pending &&
          !conversations.busy &&
          !starting && (
            <p className="px-4 py-3 text-center text-sm text-muted-foreground">
              Send a message to start this chat. The first reply can take a
              little longer while your agent starts.
            </p>
          )}
        <Composer
          key={selected?.id ?? "empty"}
          workingHere={!!pending?.streaming}
          unavailable={unavailable}
          codexTenantId={tenantId}
          liveModel={selected?.model}
          liveEffort={selected?.effort}
          settingsDisabled={!!pending || conversations.busy || starting}
          statusHint={
            conversations.operation ??
            (pending
              ? chatProgress[pending.phase]
              : conversations.loading
                ? "Loading your chats…"
                : !selected
                  ? "Create a chat to send a message."
                  : "Starting your chat agent…")
          }
          onModelChange={(model) => {
            if (selected) void conversations.configure(selected, model)
          }}
          onSend={(text) =>
            selected ? conversations.send(selected, text) : false
          }
          onStop={() => {
            if (selected) conversations.stop(selected.id)
          }}
        />
      </main>
      {accountOpen && <CodexPanel hub={hub} onClose={closeAccount} />}
    </div>
  )
}

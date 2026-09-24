import { useCallback, useEffect, useState } from "react"
import { ChevronDown, Menu, MoreHorizontal, Share2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Composer } from "@/chat/composer"
import { dinnerReply, initialChats, mockReply, type Stream } from "@/chat/mock"
import { ChatThread } from "@/chat/thread"
import { Sidebar } from "@/chat/sidebar"

export default function App() {
  const [chats, setChats] = useState(initialChats)
  const [activeId, setActiveId] = useState(1)
  const [query, setQuery] = useState("")
  const [stream, setStream] = useState<Stream | null>({
    chatId: 1,
    step: 4,
    reply: dinnerReply,
    booking: true,
  })
  const [mobileOpen, setMobileOpen] = useState(false)
  const [shared, setShared] = useState(false)
  const chat = chats.find((item) => item.id === activeId)!
  const workingHere = stream?.chatId === activeId
  const openSidebar = useCallback(() => setMobileOpen(true), [])

  useEffect(() => {
    if (!stream) return
    const timer = window.setTimeout(() => {
      if (stream.step >= 15 + Math.ceil(stream.reply.length / 4) + 5) {
        setChats((items) =>
          items.map((item) =>
            item.id === stream.chatId
              ? {
                  ...item,
                  preview: stream.reply,
                  messages: [
                    ...item.messages,
                    { role: "assistant", text: stream.reply },
                  ],
                }
              : item
          )
        )
        setStream(null)
      } else
        setStream((current) =>
          current ? { ...current, step: current.step + 1 } : null
        )
    }, 170)
    return () => window.clearTimeout(timer)
  }, [stream])

  function send(text: string, attachmentName?: string) {
    if (!text || stream) return
    setChats((items) =>
      items.map((item) =>
        item.id === activeId
          ? {
              ...item,
              title: item.messages.length ? item.title : text.slice(0, 34),
              preview: text,
              messages: [
                ...item.messages,
                { role: "user", text, attachmentName },
              ],
            }
          : item
      )
    )
    setStream({
      chatId: activeId,
      step: 0,
      ...mockReply(text),
    })
  }

  function stop() {
    if (!stream) return
    const text = stream.reply.slice(0, Math.max(0, stream.step - 15) * 4)
    setChats((items) =>
      items.map((item) =>
        item.id === stream.chatId
          ? {
              ...item,
              preview: text || "Response stopped",
              messages: [
                ...item.messages,
                {
                  role: "assistant",
                  text: text || "Response stopped",
                  stopped: true,
                },
              ],
            }
          : item
      )
    )
    setStream(null)
  }

  function regenerate(index: number) {
    if (stream) return
    const previousPrompt =
      chat.messages
        .slice(0, index)
        .findLast((message) => message.role === "user")?.text ?? ""
    setChats((items) =>
      items.map((item) =>
        item.id === activeId
          ? { ...item, messages: item.messages.slice(0, index) }
          : item
      )
    )
    setStream({
      chatId: activeId,
      step: 0,
      ...mockReply(previousPrompt),
    })
  }

  function newChat() {
    if (stream) stop()
    const id = Date.now()
    setQuery("")
    setChats((items) => [
      {
        id,
        title: "New chat",
        preview: "Start a conversation",
        time: "Now",
        messages: [],
      },
      ...items,
    ])
    setActiveId(id)
    setMobileOpen(false)
  }

  async function share() {
    await navigator.clipboard.writeText(
      chat.messages
        .map(
          (message) =>
            `${message.role === "user" ? "You" : "Assistant"}: ${message.text}`
        )
        .join("\n\n")
    )
    setShared(true)
    window.setTimeout(() => setShared(false), 1600)
  }

  return (
    <div className="flex h-svh min-h-[400px] overflow-hidden bg-white font-['Red_Hat_Display'] text-[#1F1B18]">
      <Sidebar
        chats={chats}
        activeId={activeId}
        query={query}
        mobileOpen={mobileOpen}
        onQueryChange={setQuery}
        onOpen={openSidebar}
        onClose={() => setMobileOpen(false)}
        onNew={newChat}
        onSelect={(id) => {
          if (stream) stop()
          setActiveId(id)
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
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="default"
              className="h-8"
              onClick={share}
              title="Copy conversation"
              disabled={chat.messages.length === 0}
            >
              <Share2 />{" "}
              <span className="hidden sm:inline">
                {shared ? "Copied" : "Share"}
              </span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="More options"
                  />
                }
              >
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="min-w-36 border border-[#ECE9E4] bg-white p-1 font-['Red_Hat_Display'] text-[#1F1B18]"
              >
                <DropdownMenuItem onClick={newChat}>New chat</DropdownMenuItem>
                <DropdownMenuItem
                  onClick={share}
                  disabled={chat.messages.length === 0}
                >
                  Copy conversation
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <ChatThread chat={chat} stream={stream} onRegenerate={regenerate} />
        <Composer
          key={chat.id}
          workingHere={workingHere}
          onSend={send}
          onStop={stop}
        />
      </main>
    </div>
  )
}

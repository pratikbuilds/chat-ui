import { useEffect, useRef } from "react"
import { Loader2, MoreHorizontal, Plus, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Chat } from "./mock"

type SidebarProps = {
  chats: Chat[]
  canCreate: boolean
  creating?: boolean
  activeId: number
  query: string
  mobileOpen: boolean
  onQueryChange: (query: string) => void
  onOpen: () => void
  onClose: () => void
  onNew: () => void
  onSelect: (id: number) => void
  account: { name: string; detail: string }
  onAccount: () => void
}

export function Sidebar({
  chats,
  canCreate,
  creating = false,
  activeId,
  query,
  mobileOpen,
  onQueryChange,
  onOpen,
  onClose,
  onNew,
  onSelect,
  account,
  onAccount,
}: SidebarProps) {
  const searchInput = useRef<HTMLInputElement>(null)
  const filtered = chats.filter((item) =>
    `${item.title} ${item.preview}`.toLowerCase().includes(query.toLowerCase())
  )
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        onOpen()
        searchInput.current?.focus()
      }
    }
    window.addEventListener("keydown", shortcut)
    return () => window.removeEventListener("keydown", shortcut)
  }, [onOpen])
  return (
    <>
      {mobileOpen && (
        <button
          className="fixed inset-0 z-20 bg-black/25 md:hidden"
          aria-label="Close sidebar"
          onClick={onClose}
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-72 shrink-0 flex-col border-r border-[#ECE9E4] bg-[#FAF9F7] transition-transform md:static md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-[62px] items-center justify-between px-4 pl-5">
          <div className="flex items-center gap-2.5">
            <span className="flex size-[22px] items-center justify-center rounded-md bg-[#D9772B] text-white">
              <MessageMark />
            </span>
            <span className="text-base font-semibold">Chats</span>
          </div>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={creating ? "Creating chat" : "New chat"}
            title={creating ? "Creating chat…" : "New chat"}
            disabled={!canCreate}
            onClick={onNew}
          >
            {creating ? (
              <Loader2 className="animate-spin motion-reduce:animate-none" />
            ) : (
              <Plus />
            )}
          </Button>
        </div>
        <div className="px-4 pb-3">
          <label className="flex h-9 items-center gap-2 rounded-[9px] bg-[#F1EFEB] px-3">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={searchInput}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              placeholder="Search chats"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              aria-label="Search chats"
            />
            <kbd className="font-mono text-[11px] text-[#A8A29B]">⌘K</kbd>
          </label>
        </div>
        <nav
          className="min-h-0 flex-1 overflow-y-auto px-2 pb-4"
          aria-label="Conversations"
        >
          {filtered.length === 0 && (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              No chats found
            </p>
          )}
          {filtered.map((item, index) => (
            <div key={item.id}>
              {(index === 0 || item.time === "Mon") && (
                <p className="px-3 pt-4 pb-1.5 font-mono text-[11px] tracking-[.08em] text-muted-foreground uppercase">
                  {item.time === "Mon" ? "Previous 7 days" : "Today"}
                </p>
              )}
              <button
                onClick={() => onSelect(item.id)}
                className={cn(
                  "flex w-full flex-col gap-[3px] rounded-[10px] px-3 py-2.5 text-left hover:bg-white/70",
                  item.id === activeId &&
                    "bg-white shadow-[0_0_0_1px_#ECE9E4,0_1px_2px_#1F1B180A]"
                )}
              >
                <span className="flex w-full items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {item.title}
                  </span>
                  <span className="w-9 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
                    {item.time}
                  </span>
                </span>
                <span className="w-full truncate text-[13px] text-[#6E6862]">
                  {item.preview}
                </span>
              </button>
            </div>
          ))}
        </nav>
        <button
          className="flex h-[66px] shrink-0 items-center gap-2.5 border-t px-5 text-left hover:bg-white/70"
          onClick={onAccount}
          aria-label="Account and models"
        >
          <span className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-[#F3E2D2] font-mono text-[11px] font-bold text-[#9A5220]">
            {initials(account.name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">
              {account.name}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {account.detail}
            </span>
          </span>
          <MoreHorizontal className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </aside>
    </>
  )
}

function initials(name: string) {
  const letters = name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
  return letters || "?"
}

function MessageMark() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

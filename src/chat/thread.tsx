import { useEffect, useRef, useState } from "react"
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Paperclip,
  RotateCcw,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Chat, Message, Stream } from "./mock"

function Itinerary() {
  const rows = [
    ["Thu", "Alfama on foot, 8am", "Sardines near the Sé"],
    ["Fri", "Belém at opening", "LX Factory"],
    ["Sat", "Slow coffee, Príncipe Real", "Nothing planned"],
    ["Sun", "Sintra, 8:11 train", "Dinner with a view"],
  ]
  return (
    <div className="space-y-3.5">
      <p className="leading-[25px]">
        Mid-October is ideal — warm days, thinner crowds, most sights open by
        9:30.{" "}
        <sup className="rounded bg-muted px-1 text-[10px] text-muted-foreground">
          1
        </sup>
        <br />
        Here's a shape that front-loads mornings and keeps Saturday open.{" "}
        <sup className="rounded bg-muted px-1 text-[10px] text-muted-foreground">
          2
        </sup>
      </p>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[520px] border-collapse text-left text-[13px]">
          <thead className="bg-sidebar text-muted-foreground">
            <tr>
              <th className="w-[84px] border-r px-3.5 py-2 font-medium">Day</th>
              <th className="w-[44%] border-r px-3.5 py-2 font-medium">
                Morning
              </th>
              <th className="px-3.5 py-2 font-medium">Evening</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([day, morning, evening]) => (
              <tr
                key={day}
                className={cn("border-t", day === "Sat" && "bg-[#FFF8F2]")}
              >
                <td className="border-r px-3.5 py-2.5 font-mono text-xs text-[#9A5220]">
                  {day}
                </td>
                <td className="border-r px-3.5 py-2.5">{morning}</td>
                <td
                  className={cn(
                    "px-3.5 py-2.5",
                    day === "Sat" && "text-muted-foreground"
                  )}
                >
                  {evening}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-1 border-t pt-2.5 text-[13px]">
        <p>
          <sup className="mr-2 rounded bg-muted px-1 text-[10px]">1</sup>Lisbon
          in autumn: what's open, what's quiet{" "}
          <span className="text-muted-foreground">· visitlisboa.com</span>
        </p>
        <p>
          <sup className="mr-2 rounded bg-muted px-1 text-[10px]">2</sup>Beating
          the Belém and Sintra lines{" "}
          <span className="text-muted-foreground">· timeout.com</span>
        </p>
      </div>
    </div>
  )
}

function TaskList({ step, booking }: { step: number; booking: boolean }) {
  const tasks = booking
    ? [
        "Find places with a view near Chiado",
        "Check Sunday 8pm availability for two",
        "Hold a table and ask you to approve",
      ]
    : ["Read the request", "Draft a response", "Review the answer"]
  const done = step >= 12 ? 2 : step >= 7 ? 1 : 0
  return (
    <div className="w-full max-w-[440px] rounded-xl border bg-white px-3.5 py-2.5 text-sm">
      <div className="flex h-7 items-center justify-between">
        <span className="font-medium">◌ &nbsp; To-dos</span>
        <span className="font-mono text-xs text-muted-foreground">
          {done}/3
        </span>
      </div>
      {tasks.map((task, i) => (
        <div key={task} className="flex min-h-7 items-center gap-2.5">
          <span
            className={cn(
              "flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px]",
              i < done
                ? "border-[#5B9369] bg-[#5B9369] text-white"
                : i === done
                  ? "border-[#D9772B] text-[#D9772B]"
                  : "border-dashed border-[#C9C3BC]"
            )}
          >
            {i < done ? <Check className="size-2.5" /> : i === done ? "·" : ""}
          </span>
          <span
            className={cn(
              "leading-5",
              i < done && "text-muted-foreground line-through",
              i > done && "text-muted-foreground"
            )}
          >
            {task}
          </span>
        </div>
      ))}
      {booking && step >= 15 && (
        <div className="flex min-h-7 items-center gap-2.5 text-[#A5523B]">
          <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-[#A5523B] text-[10px] text-white">
            ×
          </span>
          <span>Mirador booking · fully booked</span>
        </div>
      )}
    </div>
  )
}

function AssistantMessage({
  message,
  live,
  onRegenerate,
}: {
  message: Message
  live: boolean
  onRegenerate?: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  async function copy() {
    await navigator.clipboard.writeText(message.text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }
  if (message.stopped)
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Response stopped</p>
        {message.text !== "Response stopped" && (
          <p className="leading-[25px]">{message.text}</p>
        )}
        {onRegenerate && (
          <Button variant="ghost" size="sm" onClick={onRegenerate}>
            <RotateCcw /> Try again
          </Button>
        )}
      </div>
    )
  return (
    <div className="space-y-3.5">
      {!live && (
        <button
          className="flex items-center gap-1 text-sm text-[#6E6862] hover:text-foreground"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          Thought <span className="text-[#A39D96]">for 6s</span>
          {expanded ? (
            <ChevronUp className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
        </button>
      )}
      {!live && expanded && (
        <p className="border-l pl-3 text-sm leading-6 text-muted-foreground">
          {message.itinerary
            ? "Mid-October means shorter days, so the sunset plans belong earlier. Keep one slow day open."
            : "Consider the request, then give a concise answer that can be refined."}
        </p>
      )}
      {message.itinerary ? (
        <Itinerary />
      ) : (
        <p className="leading-[25px] whitespace-pre-wrap">{message.text}</p>
      )}
      <div className="flex gap-1 text-muted-foreground">
        <Button
          aria-label={copied ? "Copied" : "Copy response"}
          title={copied ? "Copied" : "Copy response"}
          variant="ghost"
          size="icon-sm"
          onClick={copy}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
        {onRegenerate && (
          <Button
            aria-label="Regenerate response"
            title="Regenerate response"
            variant="ghost"
            size="icon-sm"
            onClick={onRegenerate}
          >
            <RotateCcw />
          </Button>
        )}
      </div>
    </div>
  )
}

export function ChatThread({
  chat,
  stream,
  live,
  unavailable,
  loading,
  onRegenerate,
}: {
  chat: Chat
  stream: Stream | null
  live: boolean
  unavailable: boolean
  loading: boolean
  onRegenerate: (index: number) => void
}) {
  const bottom = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [chat.messages.length, stream?.step, stream?.reply, chat.id])
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-10 pb-6 md:px-12">
      <div className="mx-auto flex min-h-full w-full max-w-[720px] flex-col gap-7">
        {chat.messages.length > 0 && (
          <div className="min-h-0 flex-1" aria-hidden="true" />
        )}
        {chat.messages.length === 0 && !(stream?.chatId === chat.id) && (
          <div className="py-24 text-center">
            <h2 className="font-['Instrument_Serif'] text-4xl">
              {loading
                ? "Connecting to Interchange"
                : unavailable
                  ? "Chat agent not ready"
                  : "What's on your mind?"}
            </h2>
            <p className="mt-3 text-sm text-muted-foreground">
              {loading
                ? "Checking your workspace and chat agent."
                : unavailable
                ? "The local Interchange Hub is connected. Waiting for a chat agent."
                : "Ask a question to start this chat."}
            </p>
          </div>
        )}
        {chat.messages.map((message, index) =>
          message.role === "user" ? (
            <div key={index} className="flex justify-end">
              <div className="max-w-[500px] rounded-[18px] bg-[#F1EFEB] px-4 py-2.5 text-[15px] leading-6">
                {message.text}
                {message.attachmentName && (
                  <span className="mt-2 flex items-center gap-1 text-xs text-[#6E6862]">
                    <Paperclip className="size-3" />
                    {message.attachmentName} · preview only
                  </span>
                )}
              </div>
            </div>
          ) : (
            <AssistantMessage
              key={index}
              message={message}
              live={live}
              onRegenerate={
                index === chat.messages.length - 1 && !stream
                  ? () => onRegenerate(index)
                  : undefined
              }
            />
          )
        )}
        {stream?.chatId === chat.id && stream?.live && (
          <div className="space-y-3.5" aria-live="polite">
            {stream.reply ? (
              <p className="text-[15px] leading-[25px] whitespace-pre-wrap">
                {stream.reply}
                <span className="ml-0.5 inline-block h-[17px] w-[8px] animate-pulse bg-[#1F1B18] align-middle" />
              </p>
            ) : (
              <div className="text-sm font-medium text-[#6E6862]">
                Thinking...
              </div>
            )}
          </div>
        )}
        {stream?.chatId === chat.id && stream && !stream.live && (
          <div className="space-y-3.5" aria-live="polite">
            <div>
              <div className="text-sm font-medium text-[#6E6862]">
                Thinking...
              </div>
              <p className="mt-1 border-l pl-3 text-sm leading-[22px] text-muted-foreground">
                {stream.step < 8
                  ? "Reading the request and shaping a response."
                  : "Checking the details and putting the answer together."}
              </p>
            </div>
            <TaskList step={stream.step} booking={stream.booking} />
            {stream.step > 15 && (
              <p className="text-[15px] leading-[25px] whitespace-pre-wrap">
                {stream.reply.slice(0, (stream.step - 15) * 4)}
                <span className="ml-0.5 inline-block h-[17px] w-[8px] animate-pulse bg-[#1F1B18] align-middle" />
              </p>
            )}
          </div>
        )}
        <div ref={bottom} />
      </div>
    </div>
  )
}

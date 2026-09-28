import { useCallback, useEffect, useRef, useState } from "react"
import type { Message } from "@/chat/mock"
import {
  getTenantDomain,
  listMailbox,
  openChatEvents,
  openMailboxEvents,
  sendMailbox,
  type MailboxMessage,
} from "@/lib/hub"

/** How long to show a reply being typed before trusting the mailbox alone. */
const TYPING_TIMEOUT_MS = 120_000

type History = {
  /** Which deployment this history belongs to. */
  key: string
  address: string
  messages: Message[]
}

type Pending = {
  prompt: string
  text: string
  /** Assistant replies already stored when this one was asked for. */
  repliesBefore: number
}

function conversation(
  address: string,
  inbox: MailboxMessage[],
  sent: MailboxMessage[]
): Message[] {
  return [
    ...inbox.filter((message) => message.from.includes(address)),
    ...sent.filter((message) => message.to.includes(address)),
  ]
    .sort((a, b) => a.date - b.date || a.uid - b.uid)
    .map((message) => ({
      role: message.folder === "Sent" ? "user" : "assistant",
      text: message.text,
    }))
}

const replies = (messages: Message[]) =>
  messages.filter((message) => message.role === "assistant").length

/**
 * The conversation with the hub's chat agent. The mailbox is the record:
 * history is the person's Sent mail to the agent plus the agent's INBOX
 * replies, refetched whenever the mailbox announces new mail. While a reply
 * is being written, its tokens stream in from the chat events route.
 */
export function useLiveChat(
  tenantId: string | null,
  deploymentId: string | null
) {
  const key = tenantId && deploymentId ? `${tenantId}/${deploymentId}` : null
  const [history, setHistory] = useState<History | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [error, setError] = useState<string | null>(null)
  const typing = useRef<{ source: EventSource; timer: number } | null>(null)

  const stopTyping = useCallback(() => {
    if (!typing.current) return
    typing.current.source.close()
    window.clearTimeout(typing.current.timer)
    typing.current = null
  }, [])

  useEffect(() => {
    if (!tenantId || !deploymentId || !key) return
    let active = true
    let address: string | null = null

    const reload = async () => {
      if (!address) return
      const [inbox, sent] = await Promise.all([
        listMailbox(tenantId, "INBOX"),
        listMailbox(tenantId, "Sent"),
      ])
      if (!active) return
      const messages = conversation(address, inbox, sent)
      setHistory({ key, address, messages })
      setPending((current) => {
        if (current && replies(messages) > current.repliesBefore) {
          stopTyping()
          return null
        }
        return current
      })
    }

    getTenantDomain(tenantId)
      .then((domain) => {
        address = `${deploymentId}@${domain}`.toLowerCase()
        return reload()
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : String(cause))
      })

    const events = openMailboxEvents(tenantId)
    events.addEventListener("mailbox", () => {
      reload().catch(() => undefined)
    })
    return () => {
      active = false
      events.close()
      stopTyping()
    }
  }, [tenantId, deploymentId, key, stopTyping])

  const current = history && history.key === key ? history : null

  const send = useCallback(
    (prompt: string) => {
      if (!tenantId || !deploymentId || !current || typing.current) return
      const repliesBefore = replies(current.messages)
      setError(null)
      setPending({ prompt, text: "", repliesBefore })

      // Open the token stream first so no early token is missed.
      const source = openChatEvents(tenantId, deploymentId)
      const timer = window.setTimeout(() => {
        stopTyping()
        setPending(null)
      }, TYPING_TIMEOUT_MS)
      typing.current = { source, timer }
      let text = ""
      source.addEventListener("delta", (event) => {
        text += (JSON.parse(event.data) as { token: string }).token
        setPending((pendingNow) =>
          pendingNow ? { ...pendingNow, text } : null
        )
      })
      source.addEventListener(
        "open",
        () => {
          sendMailbox(tenantId, current.address, prompt).catch(
            (cause: unknown) => {
              stopTyping()
              setPending(null)
              setError(cause instanceof Error ? cause.message : String(cause))
            }
          )
        },
        { once: true }
      )
    },
    [tenantId, deploymentId, current, stopTyping]
  )

  const stop = useCallback(() => {
    stopTyping()
    setPending(null)
  }, [stopTyping])

  // Until the mailbox files the prompt in Sent, show it from here.
  const messages = current
    ? pending &&
      current.messages.at(-1)?.text !== pending.prompt &&
      replies(current.messages) === pending.repliesBefore
      ? [...current.messages, { role: "user" as const, text: pending.prompt }]
      : current.messages
    : null

  return { ready: current !== null, messages, pending, error, send, stop }
}

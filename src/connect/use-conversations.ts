import { useCallback, useEffect, useRef, useState } from "react"
import type { Message } from "@/chat/mock"
import { openChatEvents, openMailboxEvents, sendMailbox } from "@/lib/hub"
import {
  createConversation,
  listConversations,
  updateConversation,
  nameConversation,
  type Conversation,
} from "@/lib/workbench"

const HISTORY_PREFIX = "[Previous conversation context]\n"
const MESSAGE_SEPARATOR = "\n[Current message]\n"
export function visiblePrompt(text: string) {
  return text.startsWith(HISTORY_PREFIX) && text.includes(MESSAGE_SEPARATOR)
    ? text.slice(text.indexOf(MESSAGE_SEPARATOR) + MESSAGE_SEPARATOR.length)
    : text
}

export function conversationMessages(conversation: Conversation): Message[] {
  return [...conversation.messages]
    .sort((a, b) => a.date - b.date || a.uid - b.uid)
    .map((message) => ({
      role: message.folder === "Sent" ? "user" : "assistant",
      text: visiblePrompt(message.text),
    }))
}

type Pending = {
  prompt: string
  text: string
  repliesBefore: number
  streaming: boolean
}
const causeMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause)

export function useConversations(tenantId: string) {
  const [items, setItems] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Record<string, Pending>>({})
  const pendingRef = useRef(pending)
  const streams = useRef(
    new Map<string, { source: EventSource; timer: number }>()
  )
  const mounted = useRef(true)
  const readVersion = useRef(0)
  const reading = useRef(false)

  const stop = useCallback((id: string) => {
    const stream = streams.current.get(id)
    if (stream) {
      stream.source.close()
      window.clearTimeout(stream.timer)
      streams.current.delete(id)
    }
    const current = pendingRef.current[id]
    if (current) {
      pendingRef.current = {
        ...pendingRef.current,
        [id]: { ...current, streaming: false },
      }
      setPending(pendingRef.current)
    }
  }, [])

  const clearPending = useCallback(
    (id: string) => {
      stop(id)
      const next = { ...pendingRef.current }
      delete next[id]
      pendingRef.current = next
      setPending(next)
    },
    [stop]
  )

  const reload = useCallback(async () => {
    if (reading.current) return
    reading.current = true
    const version = readVersion.current
    try {
      const conversations = await listConversations(tenantId)
      if (!mounted.current || version !== readVersion.current) return
      setItems(conversations)
      setLoading(false)
      setError(null)
      for (const conversation of conversations) {
        const history = conversationMessages(conversation)
        const last = history.at(-1)
        if (
          !pendingRef.current[conversation.id] &&
          last?.role === "user" &&
          conversation.status === "deployed"
        ) {
          pendingRef.current = {
            ...pendingRef.current,
            [conversation.id]: {
              prompt: last.text,
              text: "",
              streaming: false,
              repliesBefore: history.filter(
                (message) => message.role === "assistant"
              ).length,
            },
          }
          setPending(pendingRef.current)
        }
        const current = pendingRef.current[conversation.id]
        if (
          current &&
          ["failed", "released", "destroy_failed"].includes(conversation.status)
        ) {
          clearPending(conversation.id)
          setError(
            "This chat's agent stopped before replying. Retry the message to restart it."
          )
          continue
        }
        if (
          current &&
          conversationMessages(conversation).filter(
            (message) => message.role === "assistant"
          ).length > current.repliesBefore
        )
          clearPending(conversation.id)
      }
    } finally {
      reading.current = false
    }
  }, [tenantId, clearPending])

  useEffect(() => {
    mounted.current = true
    const read = () =>
      void reload().catch((cause: unknown) => {
        if (mounted.current) {
          setError(causeMessage(cause))
          setLoading(false)
        }
      })
    read()
    const poll = window.setInterval(read, 5000)
    const activeStreams = streams.current
    return () => {
      mounted.current = false
      window.clearInterval(poll)
      for (const stream of activeStreams.values()) {
        stream.source.close()
        window.clearTimeout(stream.timer)
      }
      activeStreams.clear()
    }
  }, [tenantId, reload])

  const mailboxTenants = items
    .map((item) => item.id)
    .sort()
    .join(",")
  useEffect(() => {
    const events = mailboxTenants
      .split(",")
      .filter(Boolean)
      .map((id) => openMailboxEvents(id))
    const read = () =>
      void reload().catch((cause: unknown) => setError(causeMessage(cause)))
    for (const source of events) source.addEventListener("mailbox", read)
    return () => {
      for (const source of events) source.close()
    }
  }, [mailboxTenants, reload])

  const create = async () => {
    if (busy) return null
    setBusy(true)
    setError(null)
    try {
      const conversation = await createConversation(tenantId)
      readVersion.current++
      setItems((current) => [conversation, ...current])
      return conversation.id
    } catch (cause) {
      setError(causeMessage(cause))
      return null
    } finally {
      setBusy(false)
    }
  }

  const configure = async (conversation: Conversation, model: string) => {
    if (busy || pendingRef.current[conversation.id]) return
    setBusy(true)
    setError(null)
    try {
      const updated = await updateConversation(tenantId, conversation, model)
      readVersion.current++
      setItems((current) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      )
    } catch (cause) {
      setError(causeMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const send = async (conversation: Conversation, prompt: string) => {
    if (busy || pendingRef.current[conversation.id] || !prompt.trim())
      return false
    const history = conversationMessages(conversation)
    pendingRef.current = {
      ...pendingRef.current,
      [conversation.id]: {
        prompt,
        text: "",
        streaming: true,
        repliesBefore: history.filter((message) => message.role === "assistant")
          .length,
      },
    }
    setPending(pendingRef.current)
    setError(null)
    try {
      let updated = conversation
      if (["failed", "released", "destroy_failed"].includes(updated.status))
        updated = await updateConversation(
          tenantId,
          conversation,
          conversation.model
        )
      if (conversation.title === "New chat") {
        await nameConversation(conversation.id, prompt)
        updated = { ...updated, title: prompt.slice(0, 120) }
      }
      readVersion.current++
      setItems((current) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      )
      if (updated.status !== "deployed") {
        const deadline = Date.now() + 45_000
        while (updated.status !== "deployed" && Date.now() < deadline) {
          await new Promise((resolve) => window.setTimeout(resolve, 1000))
          const latest = await listConversations(tenantId)
          const ready = latest.find((item) => item.id === conversation.id)
          if (!ready) throw new Error("This chat is no longer available.")
          updated = ready
          if (["failed", "released", "destroy_failed"].includes(updated.status))
            throw new Error("Couldn't start this chat's agent. Try again.")
          setItems(latest)
        }
        if (updated.status !== "deployed")
          throw new Error(
            "Starting this chat took too long. Your message is still in the composer; try again shortly."
          )
      }
      const address = `${updated.deploymentId}@${updated.domain}`.toLowerCase()
      const hasCurrentHistory = conversation.messages.some(
        (message) => message.folder === "Sent" && message.to.includes(address)
      )
      const body =
        !hasCurrentHistory && history.length
          ? HISTORY_PREFIX +
            history
              .map((message) => `${message.role}: ${message.text}`)
              .join("\n\n") +
            MESSAGE_SEPARATOR +
            prompt
          : prompt
      const source = openChatEvents(conversation.id, updated.deploymentId)
      const timer = window.setTimeout(() => stop(conversation.id), 120_000)
      streams.current.set(conversation.id, { source, timer })
      source.addEventListener("delta", (event) => {
        const data: unknown = JSON.parse(event.data)
        if (
          typeof data !== "object" ||
          data === null ||
          !("token" in data) ||
          typeof data.token !== "string"
        )
          return
        const current = pendingRef.current[conversation.id]
        if (current) {
          pendingRef.current = {
            ...pendingRef.current,
            [conversation.id]: { ...current, text: current.text + data.token },
          }
          setPending(pendingRef.current)
        }
      })
      // The server's ready event means its token listener is installed.
      await new Promise<void>((resolve, reject) => {
        const readyTimeout = window.setTimeout(
          () => reject(new Error("Couldn't open the reply stream. Try again.")),
          20_000
        )
        source.addEventListener(
          "ready",
          () => {
            window.clearTimeout(readyTimeout)
            resolve()
          },
          { once: true }
        )
        source.addEventListener(
          "error",
          () => {
            window.clearTimeout(readyTimeout)
            reject(new Error("The reply stream disconnected. Try again."))
          },
          { once: true }
        )
      })
      await sendMailbox(conversation.id, address, body)
      void reload().catch(() => undefined)
      return true
    } catch (cause) {
      clearPending(conversation.id)
      setError(causeMessage(cause))
      return false
    }
  }

  const messagesFor = (conversation: Conversation) => {
    const history = conversationMessages(conversation)
    const current = pending[conversation.id]
    return current && history.at(-1)?.text !== current.prompt
      ? [...history, { role: "user" as const, text: current.prompt }]
      : history
  }
  return {
    items,
    loading,
    busy,
    error,
    pending,
    create,
    configure,
    send,
    stop,
    messagesFor,
  }
}

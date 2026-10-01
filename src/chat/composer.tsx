import { useEffect, useRef, useState } from "react"
import { ArrowUp, Paperclip, Plus, Square, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { listCodexModels, type CodexModel } from "@/lib/hub"

const effortOptions = ["Low", "Medium", "High"].map((value) => ({
  label: value,
  value,
}))
const modelOptions = ["Sonnet 5", "GPT-6"].map((value) => ({
  label: value,
  value,
}))

export function Composer({
  workingHere,
  unavailable,
  codexTenantId,
  liveModel,
  liveEffort,
  settingsDisabled,
  onModelChange,
  onEffortChange,
  onSend,
  onStop,
}: {
  workingHere: boolean
  unavailable: boolean
  codexTenantId?: string
  /** The model the live chat agent runs on; replaces the demo choices. */
  liveModel?: string
  liveEffort?: "low" | "medium" | "high"
  settingsDisabled?: boolean
  onModelChange?: (model: string) => void
  onEffortChange?: (effort: "low" | "medium" | "high") => void
  onSend: (
    text: string,
    attachmentName?: string
  ) => void | boolean | Promise<boolean | undefined>
  onStop: () => void
}) {
  const [draft, setDraft] = useState("")
  const [attachment, setAttachment] = useState<File | null>(null)
  const [effort, setEffort] = useState("Medium")
  const [model, setModel] = useState("Sonnet 5")
  const [catalog, setCatalog] = useState<{
    tenantId: string
    models: CodexModel[]
    error: string | null
  } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!codexTenantId) return
    let active = true
    void listCodexModels(codexTenantId).then(
      (models) => {
        if (active) setCatalog({ tenantId: codexTenantId, models, error: null })
      },
      (cause: unknown) => {
        if (active)
          setCatalog({
            tenantId: codexTenantId,
            models: [],
            error: cause instanceof Error ? cause.message : String(cause),
          })
      }
    )
    return () => {
      active = false
    }
  }, [codexTenantId])

  const currentCatalog = catalog?.tenantId === codexTenantId ? catalog : null
  const models = codexTenantId
    ? currentCatalog?.models.length
      ? currentCatalog.models.map((entry) => ({
          label: entry.name,
          value: entry.id,
        }))
      : [
          {
            label: currentCatalog?.error
              ? "Models unavailable"
              : "Loading models…",
            value: "unavailable",
          },
        ]
    : unavailable
      ? [{ label: "Loading models…", value: "unavailable" }]
      : modelOptions
  if (liveModel && !models.some((entry) => entry.value === liveModel)) {
    models.unshift({ label: liveModel, value: liveModel })
  }
  const selectedModel = liveModel
    ? liveModel
    : models.some((entry) => entry.value === model)
      ? model
      : models[0]?.value

  async function send() {
    const text = draft.trim()
    if (!text || workingHere || unavailable) return
    const sent = await onSend(text, attachment?.name)
    if (sent === false) return
    setDraft((current) => (current.trim() === text ? "" : current))
    setAttachment(null)
    if (fileInput.current) fileInput.current.value = ""
  }

  return (
    <form
      className="shrink-0 px-4 pt-1 pb-6 md:px-12"
      onSubmit={(event) => {
        event.preventDefault()
        send()
      }}
    >
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-3 rounded-2xl border border-[#E2DED8] bg-white px-3 pt-3.5 pb-3 pl-4 shadow-sm focus-within:border-[#D9772B] focus-within:shadow-[0_0_0_3px_#D9772B24]">
        <Textarea
          aria-label="Message"
          placeholder={
            unavailable
              ? "Waiting for Interchange agent"
              : workingHere
                ? "Ask a follow-up..."
                : "Ask anything"
          }
          disabled={unavailable}
          className="max-h-36 min-h-6 resize-none rounded-none border-0 bg-transparent px-0.5 py-0 text-[15px] leading-6 shadow-none placeholder:text-[#A39D96] focus-visible:border-0 focus-visible:ring-0"
          rows={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
        />
        {attachment && (
          <div className="flex w-fit items-center gap-2 rounded-md bg-muted px-2 py-1 text-xs">
            <Paperclip className="size-3" />
            {attachment.name}
            <button
              aria-label="Remove attachment"
              type="button"
              onClick={() => setAttachment(null)}
            >
              <X className="size-3" />
            </button>
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <input
              className="hidden"
              ref={fileInput}
              type="file"
              onChange={(event) =>
                setAttachment(event.target.files?.[0] ?? null)
              }
            />
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              className="size-[30px] rounded-full"
              title="Attach file"
              aria-label="Attach file"
              disabled={unavailable || !!onModelChange}
              onClick={() => fileInput.current?.click()}
            >
              <Plus />
            </Button>
            {(!onModelChange || onEffortChange) && (
              <Select
                items={effortOptions}
                value={
                  liveEffort
                    ? liveEffort[0].toUpperCase() + liveEffort.slice(1)
                    : effort
                }
                disabled={
                  settingsDisabled || (!!onModelChange && !onEffortChange)
                }
                onValueChange={(value) => {
                  if (!value) return
                  if (onEffortChange) {
                    const next = value.toLowerCase()
                    if (next === "low" || next === "medium" || next === "high")
                      onEffortChange(next)
                  } else setEffort(value)
                }}
              >
                <SelectTrigger
                  aria-label="Reasoning effort"
                  className="h-[30px] rounded-full border-0 bg-[#F1EFEB] px-2.5 text-[13px] font-medium shadow-none hover:bg-[#EAE7E2]"
                >
                  <span className="flex items-end gap-[2px]" aria-hidden="true">
                    <span className="h-1.5 w-[3px] rounded-sm bg-[#1F1B18]" />
                    <span className="h-2 w-[3px] rounded-sm bg-[#1F1B18]" />
                    <span className="h-3 w-[3px] rounded-sm bg-[#C9C3BC]" />
                  </span>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent
                  side="top"
                  align="start"
                  alignItemWithTrigger={false}
                  className="min-w-32 border border-[#ECE9E4] p-1 shadow-[0_8px_24px_#1F1B1814]"
                >
                  {effortOptions.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      className="px-2.5 py-2 text-[13px] focus:bg-[#F1EFEB]"
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="flex items-center gap-2">
            <select
              aria-label="Model"
              value={selectedModel}
              onChange={(event) =>
                onModelChange
                  ? onModelChange(event.target.value)
                  : setModel(event.target.value)
              }
              disabled={
                settingsDisabled ||
                (unavailable && !codexTenantId) ||
                (codexTenantId !== undefined && !currentCatalog?.models.length)
              }
              className="h-[30px] max-w-36 cursor-pointer rounded-lg border-0 bg-transparent px-2 text-[13px] text-[#6E6862] outline-none hover:bg-[#F1EFEB] focus-visible:ring-2 focus-visible:ring-[#D9772B]"
            >
              {models.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {workingHere ? (
              <Button
                type="button"
                size="icon-sm"
                className="size-[30px] rounded-full"
                aria-label="Stop response"
                title="Stop response"
                onClick={onStop}
              >
                <Square className="size-2.5 fill-current" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon-sm"
                className="size-[30px] rounded-full"
                disabled={unavailable || !draft.trim()}
                aria-label="Send message"
                title="Send message"
              >
                <ArrowUp className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
      {codexTenantId && unavailable && (
        <p className="mx-auto mt-2 max-w-[720px] text-xs text-muted-foreground">
          {liveModel
            ? "Loading the Interchange conversation…"
            : "Codex is connected. Deploy the Interchange chat agent to send messages."}
        </p>
      )}
      {currentCatalog?.error && (
        <p className="mx-auto mt-1 max-w-[720px] text-xs text-[#9B2C22]">
          {currentCatalog.error}
        </p>
      )}
      {!codexTenantId && !unavailable && (
        <p className="sr-only">Mock chat. No message is sent to a server.</p>
      )}
    </form>
  )
}

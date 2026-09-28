// The chat assistant chat-ui talks to: an Interchange workflow with one
// mail-triggered step. A single step with `triggers: "unbounded"` keeps one
// warm agent for the whole deployment, so every message sent to it is the
// next turn of the same conversation. The step has no tools; its final text
// is the reply, read back from the run's StepCompleted event.
//
// Bundled and pushed by scripts/deploy-chat-agent.ts; imports resolve
// against the vendored interchange/ workspace at bundle time.

import { defineAgent } from "@intx/agent"
import { defineWorkflow, step, type WorkflowDefinition } from "@intx/workflow"

export const CHAT_WORKFLOW_ID = "wf_chat_assistant"

export type ChatWorkflowInput = {
  /** A well-formed address on the tenant's domain (`<slug>.localhost`). */
  readonly triggerAddress: string
  /** Catalog plugin and canonical model name, e.g. codex / gpt-5.5. */
  readonly provider: string
  readonly model: string
}

const SYSTEM_PROMPT = [
  "You are a helpful, friendly assistant in a chat app.",
  "Answer the person's latest message directly and concisely.",
  "Use Markdown for lists, tables and code when it helps.",
].join(" ")

export function buildChatWorkflow(input: ChatWorkflowInput): WorkflowDefinition {
  const assistant = defineAgent({
    id: "chat-assistant",
    systemPrompt: SYSTEM_PROMPT,
    tools: [],
    capabilities: [],
    inference: {
      sources: [{ provider: input.provider, model: input.model }],
    },
  })

  return defineWorkflow({
    id: CHAT_WORKFLOW_ID,
    trigger: { type: "mail", to: input.triggerAddress },
    steps: {
      assistant: step({ agent: assistant, triggers: "unbounded" }),
    },
  })
}

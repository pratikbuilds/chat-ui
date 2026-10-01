import assert from "node:assert/strict"
import {
  conversationMessages,
  visiblePrompt,
} from "../src/connect/use-conversations"
import type { Conversation } from "../src/lib/workbench"

const chat: Conversation = {
  id: "child-a",
  deploymentId: "new-run",
  previousDeploymentIds: ["old-run"],
  domain: "child-a.localhost",
  title: "Apple",
  model: "gpt-6-sol",
  effort: "medium",
  status: "deployed",
  createdAt: "",
  archive: false,
  messages: [
    {
      uid: 2,
      folder: "INBOX",
      from: ["old-run@child-a.localhost"],
      to: [],
      date: 2,
      text: "apple",
    },
    {
      uid: 1,
      folder: "Sent",
      from: [],
      to: ["old-run@child-a.localhost"],
      date: 1,
      text: "Remember apple",
    },
    {
      uid: 3,
      folder: "INBOX",
      from: ["new-run@child-a.localhost"],
      to: [],
      date: 3,
      text: "still apple",
    },
  ],
}
const other: Conversation = {
  ...chat,
  id: "child-b",
  messages: [
    { uid: 1, folder: "Sent", from: [], to: [], date: 1, text: "banana" },
  ],
}
assert.deepEqual(
  conversationMessages(chat).map((row) => row.text),
  ["Remember apple", "apple", "still apple"]
)
assert.deepEqual(
  conversationMessages(other).map((row) => row.text),
  ["banana"]
)
assert.equal(
  chat.messages[0].text,
  "apple",
  "projection must not reorder stored mail"
)
assert.equal(
  visiblePrompt(
    "[Previous conversation context]\nuser: apple\n[Current message]\nWhat did I say?"
  ),
  "What did I say?"
)
assert.equal(visiblePrompt("ordinary prompt"), "ordinary prompt")
console.log(
  "Child mailbox isolation, redeployment history, and prompt display passed."
)

export type Message = {
  role: "user" | "assistant"
  text: string
  attachmentName?: string
  itinerary?: true
  stopped?: true
}
export type Chat = {
  id: number
  title: string
  preview: string
  time: string
  messages: Message[]
}
export type Stream = {
  chatId: number
  step: number
  reply: string
  booking: boolean
}

export const dinnerReply =
  "For Sunday dinner with a view, I'd start with a terrace near Chiado or a riverside table. Check 8 pm availability for two, then compare menus and cancellation terms before choosing."
export const generalReply =
  "Here's a starting point: tell me the outcome you want and the constraints that matter most. I can turn that into a focused plan and refine it with you."

export function mockReply(prompt: string) {
  const booking = /lisbon|dinner|view|sunday/i.test(prompt)
  return { booking, reply: booking ? dinnerReply : generalReply }
}

export const initialChats: Chat[] = [
  {
    id: 1,
    title: "Trip to Lisbon in October",
    preview: "Day three works best as a slow one…",
    time: "9:41",
    messages: [
      {
        role: "user",
        text: "Four days in Lisbon mid-October, two of us. Food first, no queues, and one properly slow day. Sketch a plan?",
      },
      {
        role: "assistant",
        text: "Mid-October is ideal — warm days, thinner crowds, most sights open by 9:30. Here's a shape that front-loads mornings and keeps Saturday open.",
        itinerary: true,
      },
      { role: "user", text: "Book the Sunday dinner — somewhere with a view." },
    ],
  },
  {
    id: 2,
    title: "Sourdough starter rescue",
    preview: "Feed it twice a day at 1:1:1 for now",
    time: "8:12",
    messages: [
      {
        role: "user",
        text: "My sourdough starter is sluggish. What should I try?",
      },
      {
        role: "assistant",
        text: "Feed it twice a day at 1:1:1 for now. Keep it somewhere warm and watch for a reliable rise before baking.",
      },
    ],
  },
  {
    id: 3,
    title: "Explain CRDTs like I'm five",
    preview: "Imagine two kids editing one drawing…",
    time: "7:30",
    messages: [
      { role: "user", text: "Explain CRDTs like I'm five." },
      {
        role: "assistant",
        text: "Imagine two kids editing one drawing. They can each make changes, then combine them without losing either kid's work.",
      },
    ],
  },
  {
    id: 4,
    title: "Cover letter for Paper",
    preview: "Tighter opening, lead with the launch",
    time: "Mon",
    messages: [
      { role: "user", text: "Help me tighten a cover letter for Paper." },
      {
        role: "assistant",
        text: "Lead with the launch you shipped, then connect that work to the role. Keep the opening concrete.",
      },
    ],
  },
  {
    id: 5,
    title: "Weekly meal plan, vegetarian",
    preview: "Shopping list grouped by aisle",
    time: "Sun",
    messages: [
      { role: "user", text: "Make me a vegetarian meal plan." },
      {
        role: "assistant",
        text: "Start with two flexible bases: a grain bowl and a bean stew. Reuse vegetables across both.",
      },
    ],
  },
  {
    id: 6,
    title: "Postgres index not used",
    preview: "The cast on created_at kills it",
    time: "Sat",
    messages: [
      { role: "user", text: "Why is Postgres ignoring my index?" },
      {
        role: "assistant",
        text: "The cast on created_at can prevent the planner from using that index. Compare the plan before and after removing it.",
      },
    ],
  },
  {
    id: 7,
    title: "Birthday gift ideas for Mom",
    preview: "A pottery class you two can take",
    time: "Fri",
    messages: [
      { role: "user", text: "Birthday ideas for my mom?" },
      {
        role: "assistant",
        text: "A pottery class you two can take gives you a day together and something to bring home.",
      },
    ],
  },
]

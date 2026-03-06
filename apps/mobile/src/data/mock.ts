export const summaryStats = [
  { label: "Queue", value: "04", hint: "Jobs waiting on agent attention" },
  { label: "Prompts", value: "02", hint: "Permission or question gates" },
  { label: "Runs", value: "03", hint: "Background sessions alive" },
];

export const signalSessions = [
  {
    id: "session-main",
    title: "Main Operator",
    status: "active",
    model: "openai/gpt-5",
    preview: "Reviewing repo structure for the Turborepo migration and mapping server seams.",
    lastActive: "2m ago",
    messageCount: 128,
  },
  {
    id: "session-mobile",
    title: "Mobile Shell",
    status: "idle",
    model: "anthropic/claude-sonnet",
    preview: "Drafting the Expo Router shell, push hooks, and a tighter phone navigation model.",
    lastActive: "19m ago",
    messageCount: 44,
  },
  {
    id: "session-background",
    title: "Background Recon",
    status: "active",
    model: "openrouter/qwen",
    preview: "Watching cron, memory writes, and agent heartbeat deltas from the side channel.",
    lastActive: "41s ago",
    messageCount: 67,
  },
];

export const pendingInboxItems = [
  {
    id: "prompt-01",
    kind: "permission",
    sessionTitle: "Main Operator",
    title: "Allow file edits in apps/server?",
    body: "The agent wants to rewrite package boundaries and add a typed API entrypoint.",
  },
  {
    id: "prompt-02",
    kind: "question",
    sessionTitle: "Background Recon",
    title: "Choose websocket namespace",
    body: "The runtime needs a confirmation on whether the mobile stream should use /ws/runtime or /ws/events.",
  },
];

export const activityBursts = [
  { label: "Heartbeat", value: "12s", detail: "Last scheduler ping" },
  { label: "Tokens", value: "14k", detail: "This session window" },
  { label: "Push", value: "Ready", detail: "Registration scaffold wired" },
];

export const backgroundRuns = [
  {
    id: "run-01",
    title: "Model catalog sync",
    status: "running",
    updatedAt: "Updated 34s ago",
    summary: "Refreshing provider metadata before the shared tRPC router starts exposing model options.",
  },
  {
    id: "run-02",
    title: "Workspace bootstrap audit",
    status: "retrying",
    updatedAt: "Updated 2m ago",
    summary: "Cross-checking AGENTS.md and runtime bundle content for the mobile packaging path.",
  },
];

export const transcriptBySessionId: Record<string, Array<{ id: string; role: "assistant" | "user"; content: string }>> = {
  "session-main": [
    {
      id: "msg-1",
      role: "user",
      content: "Implement the monorepo plan and stand up the typed mobile shell.",
    },
    {
      id: "msg-2",
      role: "assistant",
      content: "I’m splitting the current single-package app into server, web, and shared boundaries before I wire Expo on top.",
    },
    {
      id: "msg-3",
      role: "assistant",
      content: "Next I’ll land the first typed transport seam so the mobile client can stop relying on browser-only EventSource paths.",
    },
  ],
  "session-mobile": [
    {
      id: "msg-4",
      role: "user",
      content: "Keep the desktop feel, but make it usable on a phone.",
    },
    {
      id: "msg-5",
      role: "assistant",
      content: "The shell uses a field-console aesthetic: dense signal cards, warm industrial tones, and tabs that map to the desktop mental model.",
    },
  ],
  "session-background": [
    {
      id: "msg-6",
      role: "assistant",
      content: "Background runs are visible, but the noisy details stay out of the main thread unless they need intervention.",
    },
  ],
};

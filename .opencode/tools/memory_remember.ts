import { tool } from "@opencode-ai/plugin";

function resolveApiBaseUrl() {
  const explicit = process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const port = process.env.AGENT_MOCKINGBIRD_PORT?.trim() || process.env.PORT?.trim() || "3001";
  return `http://127.0.0.1:${port}`;
}

async function postJson(pathname: string, body: unknown) {
  const response = await fetch(`${resolveApiBaseUrl()}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok && response.status !== 422) {
    const error = typeof payload.error === "string" ? payload.error : `Request failed (${response.status})`;
    throw new Error(error);
  }
  return { ok: response.ok, status: response.status, payload };
}

export default tool({
  description: "Persist a memory note so it can be retrieved later.",
  args: {
    content: tool.schema.string().min(1),
    confidence: tool.schema.number().min(0).max(1).optional(),
    source: tool.schema.enum(["assistant", "user", "system"]).optional(),
    entities: tool.schema.array(tool.schema.string()).optional(),
    supersedes: tool.schema.array(tool.schema.string()).optional(),
    topic: tool.schema.string().optional(),
  },
  async execute(args: {
    content: string;
    confidence?: number;
    source?: "assistant" | "user" | "system";
    entities?: string[];
    supersedes?: string[];
    topic?: string;
  }) {
    const response = await postJson("/api/waffle/memory/remember", {
      ...args,
      source: args.source ?? "assistant",
    });

    return JSON.stringify({
      ok: response.ok,
      status: response.status,
      result: response.payload,
    });
  },
});

import { z } from "zod";

function resolveApiBaseUrl() {
  const explicit = process.env.WAFFLEBOT_MEMORY_API_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const port = process.env.WAFFLEBOT_PORT?.trim() || process.env.PORT?.trim() || "3001";
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

export default {
  description: "Persist a durable memory note (fact/preference/decision/todo) with backend policy guardrails.",
  args: {
    type: z.enum(["decision", "preference", "fact", "todo", "observation"]),
    content: z.string().min(1),
    confidence: z.number().min(0).max(1).optional(),
    source: z.enum(["assistant", "user", "system"]).default("assistant"),
    entities: z.array(z.string()).optional(),
    supersedes: z.array(z.string()).optional(),
    topic: z.string().optional(),
  },
  async execute(args: {
    type: "decision" | "preference" | "fact" | "todo" | "observation";
    content: string;
    confidence?: number;
    source?: "assistant" | "user" | "system";
    entities?: string[];
    supersedes?: string[];
    topic?: string;
  }) {
    const response = await postJson("/api/memory/remember", {
      ...args,
      source: args.source ?? "assistant",
    });

    return {
      ok: response.ok,
      status: response.status,
      result: response.payload,
    };
  },
};

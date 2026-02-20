import { tool } from "@opencode-ai/plugin";

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
  if (!response.ok) {
    const error = typeof payload.error === "string" ? payload.error : `Request failed (${response.status})`;
    throw new Error(error);
  }
  return payload;
}

export default tool({
  description: "Search memory for relevant prior context.",
  args: {
    query: tool.schema.string().min(1).describe("Natural language memory query"),
    maxResults: tool.schema.number().int().min(1).max(20).optional(),
    minScore: tool.schema.number().min(0).max(1).optional(),
  },
  async execute(args: { query: string; maxResults?: number; minScore?: number }) {
    const payload = await postJson("/api/memory/retrieve", {
      query: args.query,
      maxResults: args.maxResults,
      minScore: args.minScore,
    });
    const results = Array.isArray(payload.results) ? payload.results : [];
    return JSON.stringify({
      ok: true,
      query: args.query,
      count: results.length,
      results,
    });
  },
});

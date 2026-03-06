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
  if (!response.ok) {
    const error = typeof payload.error === "string" ? payload.error : `Request failed (${response.status})`;
    throw new Error(error);
  }
  return payload;
}

function toPreview(snippet: string) {
  const compact = snippet
    .replace(/^###\s+\[memory:[^\n]+\]\n?/i, "")
    .replace(/^meta:[^\n]*\n?/i, "")
    .trim();
  if (compact.length <= 280) return compact;
  return `${compact.slice(0, 280).trimEnd()}...`;
}

export default tool({
  description: "Search memory for relevant prior context.",
  args: {
    query: tool.schema.string().min(1).describe("Natural language memory query"),
    maxResults: tool.schema.number().int().min(1).max(20).optional(),
    minScore: tool.schema.number().min(0).max(1).optional(),
    debug: tool.schema.boolean().optional().describe("Include retrieval debug details."),
  },
  async execute(args: { query: string; maxResults?: number; minScore?: number; debug?: boolean }) {
    const payload = await postJson("/api/memory/retrieve", {
      query: args.query,
      maxResults: args.maxResults,
      minScore: args.minScore,
      debug: args.debug,
    });
    const results = Array.isArray(payload.results) ? payload.results : [];
    const compactResults = results.map((result: any) => {
      const snippet = typeof result?.snippet === "string" ? result.snippet : "";
      return {
        id: result?.id,
        score: result?.score,
        citation: result?.citation,
        path: result?.path,
        startLine: result?.startLine,
        endLine: result?.endLine,
        preview: toPreview(snippet),
        snippet: toPreview(snippet),
      };
    });
    return JSON.stringify({
      ok: true,
      query: args.query,
      count: compactResults.length,
      results: compactResults,
      debug: args.debug ? payload.debug : undefined,
    });
  },
});

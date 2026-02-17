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
  if (!response.ok) {
    const error = typeof payload.error === "string" ? payload.error : `Request failed (${response.status})`;
    throw new Error(error);
  }
  return payload;
}

export default {
  description: "Read a safe slice of canonical markdown memory files by path and line window.",
  args: {
    path: z.string().min(1).describe("Memory path such as MEMORY.md or memory/2026-02-17.md"),
    from: z.number().int().min(1).optional().describe("Start line number (1-based)"),
    lines: z.number().int().min(1).max(400).optional().describe("Number of lines to return"),
  },
  async execute(args: { path: string; from?: number; lines?: number }) {
    const payload = await postJson("/api/memory/read", {
      path: args.path,
      from: args.from,
      lines: args.lines,
    });
    return {
      ok: true,
      path: payload.path,
      text: payload.text,
    };
  },
};

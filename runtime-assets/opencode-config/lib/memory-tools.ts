import { z } from "zod"

type JsonObject = Record<string, unknown>
type ToolExecuteContext = { sessionID?: string | null }

export type MemoryToolOptions = {
  apiBaseUrl?: string
  memoryApiBaseUrl?: string
}

function normalizeBaseUrl(value?: string) {
  const trimmed = value?.trim()
  if (!trimmed) return
  return trimmed.replace(/\/+$/, "")
}

function resolveMemoryApiBaseUrl(options: MemoryToolOptions) {
  const configured = normalizeBaseUrl(options.memoryApiBaseUrl) ?? normalizeBaseUrl(options.apiBaseUrl)
  if (configured) return configured

  for (const key of [
    "AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL",
    "AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL",
    "AGENT_MOCKINGBIRD_CRON_API_BASE_URL",
  ] as const) {
    const envValue = normalizeBaseUrl(process.env[key])
    if (envValue) return envValue
  }

  const port = process.env.AGENT_MOCKINGBIRD_PORT?.trim() || process.env.PORT?.trim() || "3001"
  return `http://127.0.0.1:${port}`
}

function toJsonObject(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonObject
  }
  return { data: value }
}

function getResponseErrorMessage(response: { status: number; payload: JsonObject; rawText: string }) {
  if (typeof response.payload.error === "string" && response.payload.error.trim()) {
    return response.payload.error
  }
  if (typeof response.payload.body === "string" && response.payload.body.trim()) {
    return response.payload.body
  }
  if (response.rawText.trim()) {
    return response.rawText
  }
  return `Request failed (${response.status})`
}

async function postMemoryJson(options: MemoryToolOptions, pathname: string, body: unknown) {
  const response = await fetch(`${resolveMemoryApiBaseUrl(options)}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
  const rawText = await response.text()
  const trimmed = rawText.trim()
  let payload: JsonObject = {}

  if (trimmed) {
    const looksLikeJson = trimmed.startsWith("{") || trimmed.startsWith("[")
    if (contentType.includes("application/json") || looksLikeJson) {
      try {
        payload = toJsonObject(JSON.parse(rawText))
      } catch {
        payload = { body: rawText }
      }
    } else {
      payload = { body: rawText }
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    payload,
    rawText,
  }
}

function toPreview(snippet: string) {
  const compact = snippet
    .replace(/^###\s+\[memory:[^\n]+\]\n?/i, "")
    .replace(/^meta:[^\n]*\n?/i, "")
    .trim()
  if (compact.length <= 280) return compact
  return `${compact.slice(0, 280).trimEnd()}...`
}

function toolOptions(source: MemoryToolOptions | (() => MemoryToolOptions)) {
  return typeof source === "function" ? source : () => source
}

export function createMemorySearchTool(source: MemoryToolOptions | (() => MemoryToolOptions) = {}) {
  const getOptions = toolOptions(source)
  return {
    description: "Search memory for relevant prior context.",
    args: {
      query: z.string().min(1).describe("Natural language memory query"),
      maxResults: z.number().int().min(1).max(20).optional(),
      minScore: z.number().min(0).max(1).optional(),
      debug: z.boolean().optional().describe("Include retrieval debug details."),
    },
    async execute(
      args: { query: string; maxResults?: number; minScore?: number; debug?: boolean },
      _context?: ToolExecuteContext,
    ) {
      const response = await postMemoryJson(getOptions(), "/api/mockingbird/memory/retrieve", {
        query: args.query,
        maxResults: args.maxResults,
        minScore: args.minScore,
        debug: args.debug,
      })
      if (!response.ok) {
        throw new Error(getResponseErrorMessage(response))
      }

      const results = Array.isArray(response.payload.results) ? response.payload.results : []
      const compactResults = results.map((result) => {
        const value = result as JsonObject
        const snippet = typeof value.snippet === "string" ? value.snippet : ""
        const preview = toPreview(snippet)
        return {
          id: value.id,
          score: value.score,
          citation: value.citation,
          path: value.path,
          startLine: value.startLine,
          endLine: value.endLine,
          preview,
          snippet: preview,
        }
      })

      return JSON.stringify({
        ok: true,
        query: args.query,
        count: compactResults.length,
        results: compactResults,
        debug: args.debug ? response.payload.debug : undefined,
      })
    },
  }
}

export function createMemoryGetTool(source: MemoryToolOptions | (() => MemoryToolOptions) = {}) {
  const getOptions = toolOptions(source)
  return {
    description: "Read a safe slice of canonical markdown memory files by path and line window.",
    args: {
      path: z.string().min(1).describe("Memory path such as MEMORY.md or memory/2026-02-17.md"),
      from: z.number().int().min(1).optional().describe("Start line number (1-based)"),
      lines: z.number().int().min(1).max(400).optional().describe("Number of lines to return"),
    },
    async execute(args: { path: string; from?: number; lines?: number }, _context?: ToolExecuteContext) {
      const response = await postMemoryJson(getOptions(), "/api/mockingbird/memory/read", {
        path: args.path,
        from: args.from,
        lines: args.lines,
      })
      if (!response.ok) {
        throw new Error(getResponseErrorMessage(response))
      }

      return JSON.stringify({
        ok: true,
        path: response.payload.path,
        text: response.payload.text,
      })
    },
  }
}

export function createMemoryRememberTool(source: MemoryToolOptions | (() => MemoryToolOptions) = {}) {
  const getOptions = toolOptions(source)
  return {
    description: "Persist a memory note so it can be retrieved later.",
    args: {
      content: z.string().min(1),
      confidence: z.number().min(0).max(1).optional(),
      source: z.enum(["assistant", "user", "system"]).optional(),
      entities: z.array(z.string()).optional(),
      supersedes: z.array(z.string()).optional(),
      topic: z.string().optional(),
    },
    async execute(
      args: {
        content: string
        confidence?: number
        source?: "assistant" | "user" | "system"
        entities?: string[]
        supersedes?: string[]
        topic?: string
      },
      context: ToolExecuteContext = {},
    ) {
      const response = await postMemoryJson(getOptions(), "/api/mockingbird/memory/remember", {
        ...args,
        source: args.source ?? "assistant",
        sessionId: context.sessionID,
      })

      if (!response.ok && response.status !== 422) {
        throw new Error(getResponseErrorMessage(response))
      }

      return JSON.stringify({
        ok: response.ok,
        status: response.status,
        result: response.payload,
      })
    },
  }
}

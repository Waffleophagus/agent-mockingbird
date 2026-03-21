import { tool, type Plugin, type ToolContext } from "@opencode-ai/plugin"

const z = tool.schema

type JsonObject = Record<string, unknown>

type JsonSchema = {
  type?: string
  description?: string
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
}

function resolveApiBaseUrl(...envKeys: string[]) {
  for (const key of envKeys) {
    const value = process.env[key]?.trim()
    if (value) return value.replace(/\/+$/, "")
  }

  const port = process.env.AGENT_MOCKINGBIRD_PORT?.trim() || process.env.PORT?.trim() || "3001"
  return `http://127.0.0.1:${port}`
}

async function requestJson(pathname: string, init?: RequestInit) {
  const response = await fetch(`${resolveApiBaseUrl(
    "AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL",
    "AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL",
    "AGENT_MOCKINGBIRD_CRON_API_BASE_URL",
  )}${pathname}`, init)
  const payload = (await response.json()) as JsonObject
  if (!response.ok) {
    const error = typeof payload.error === "string" ? payload.error : `Request failed (${response.status})`
    throw new Error(error)
  }
  return payload
}

const systemPromptCache = {
  value: "",
  expiresAtMs: 0,
}

const compactionContextCache = {
  prompt: "",
  value: [] as string[],
  expiresAtMs: 0,
}

type CompactionPayload = {
  prompt?: string
  context: string[]
}

type SessionScope = {
  localSessionId: string | null
  isMain: boolean
  kind: "main" | "cron" | "heartbeat" | "other"
  heartbeat: boolean
  cronJobId: string | null
  cronJobName: string | null
}

const sessionScopeCache = new Map<string, { value: SessionScope; expiresAtMs: number }>()

async function postJson(pathname: string, body: unknown, envKeys: string[] = []) {
  const response = await fetch(`${resolveApiBaseUrl(...envKeys)}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const payload = (await response.json()) as JsonObject
  return {
    ok: response.ok,
    status: response.status,
    payload,
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

function applyPropertyDescription(parameters: unknown, propertyName: string, description: string) {
  if (!parameters || typeof parameters !== "object") return
  const schema = parameters as JsonSchema
  const property = schema.properties?.[propertyName]
  if (!property) return
  property.description = description
}

const toolDescriptionOverrides: Record<string, string> = {
  question:
    "Ask the user a short structured question when multiple-choice or explicit clarification will unblock the assistant faster than plain text.",
  task:
    "Delegate a bounded subtask to a specialized agent when parallel work or focused expertise will help the assistant move faster.",
  bash:
    "Run a shell command in the workspace when direct terminal execution is the fastest way to inspect, verify, or change something.",
  read:
    "Read a file or directory directly when the assistant needs exact local context before acting.",
  write:
    "Create a new file when the assistant needs to add fresh workspace content.",
  edit:
    "Make targeted edits to an existing file when a focused change is enough.",
  apply_patch:
    "Apply a precise patch to workspace files when the assistant needs controlled code or text edits.",
  list:
    "List files in a directory to quickly inspect local workspace structure.",
  glob:
    "Find files by path pattern when the assistant knows roughly where something should live.",
  grep:
    "Search local file contents for exact text or patterns when identifying relevant code or documents.",
  websearch:
    "Search the web for current external information when local context is insufficient and recency matters.",
  webfetch:
    "Fetch and read a specific URL when the assistant already knows which external page or API response is needed.",
  todoread:
    "Read the assistant todo list to understand current planned work.",
  todowrite:
    "Update the assistant todo list when tracking multi-step work would keep execution organized.",
}

function rewriteToolDefinition(toolID: string, output: { description: string; parameters: unknown }) {
  const description = toolDescriptionOverrides[toolID]
  if (description) {
    output.description = description
  }

  if (toolID === "question") {
    applyPropertyDescription(
      output.parameters,
      "questions",
      "One or more short user-facing questions to ask when structured clarification is needed.",
    )
  }

  if (toolID === "task") {
    applyPropertyDescription(output.parameters, "description", "A short summary of the delegated subtask.")
    applyPropertyDescription(output.parameters, "prompt", "Exact instructions for the specialized agent to complete.")
    applyPropertyDescription(
      output.parameters,
      "subagent_type",
      "The specialist agent type that should handle this delegated subtask.",
    )
  }

  if (toolID === "bash") {
    applyPropertyDescription(output.parameters, "description", "Short explanation of why this command is being run.")
  }
}

async function fetchSystemPrompt() {
  const now = Date.now()
  if (systemPromptCache.expiresAtMs > now) {
    return systemPromptCache.value
  }

  const payload = await requestJson("/api/mockingbird/runtime/system-prompt")
  const system = typeof payload.system === "string" ? payload.system : ""
  systemPromptCache.value = system
  systemPromptCache.expiresAtMs = now + 5_000
  return system
}

async function fetchCompactionContext(sessionID?: string): Promise<CompactionPayload> {
  const now = Date.now()
  const cacheKey = sessionID?.trim() || "__default__"
  if (compactionContextCache.expiresAtMs > now && cacheKey === "__default__") {
    return {
      prompt: compactionContextCache.prompt || undefined,
      context: compactionContextCache.value,
    }
  }

  const search = sessionID?.trim() ? `?sessionId=${encodeURIComponent(sessionID.trim())}` : ""
  const payload = await requestJson(`/api/mockingbird/runtime/compaction-context${search}`)
  const prompt = typeof payload.prompt === "string" && payload.prompt.trim().length > 0 ? payload.prompt : undefined
  const context = Array.isArray(payload.context)
    ? payload.context.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : []
  if (cacheKey === "__default__") {
    compactionContextCache.prompt = prompt ?? ""
    compactionContextCache.value = context
    compactionContextCache.expiresAtMs = now + 5_000
  }
  return { prompt, context }
}

async function fetchSessionScope(sessionID?: string) {
  if (!sessionID?.trim()) {
    return {
      localSessionId: null,
      isMain: false,
      kind: "other" as const,
      heartbeat: false,
      cronJobId: null,
      cronJobName: null,
    }
  }

  const cacheKey = sessionID.trim()
  const now = Date.now()
  const cached = sessionScopeCache.get(cacheKey)
  if (cached && cached.expiresAtMs > now) {
    return cached.value
  }

  const payload = await requestJson(`/api/mockingbird/runtime/session-scope?sessionId=${encodeURIComponent(cacheKey)}`)
  const kind: SessionScope["kind"] =
    payload.kind === "main" || payload.kind === "cron" || payload.kind === "heartbeat" || payload.kind === "other"
      ? payload.kind
      : "other"
  const value = {
    localSessionId: typeof payload.localSessionId === "string" && payload.localSessionId.trim()
      ? payload.localSessionId
      : null,
    isMain: payload.isMain === true,
    kind,
    heartbeat: payload.heartbeat === true,
    cronJobId: typeof payload.cronJobId === "string" && payload.cronJobId.trim() ? payload.cronJobId : null,
    cronJobName: typeof payload.cronJobName === "string" && payload.cronJobName.trim() ? payload.cronJobName : null,
  }
  sessionScopeCache.set(cacheKey, {
    value,
    expiresAtMs: now + 5_000,
  })
  return value
}

function buildMainThreadNote() {
  return [
    "Thread policy:",
    "- This is the main/root conversation thread.",
    "- Prefer doing work directly in this thread unless delegation materially improves speed or focus.",
    "- Treat this thread as the primary durable context for the user.",
  ].join("\n")
}

function buildCronThreadNote(sessionScope: SessionScope) {
  const jobLabel = sessionScope.cronJobName
    ? `${sessionScope.cronJobName} (${sessionScope.cronJobId ?? "cron"})`
    : sessionScope.cronJobId ?? "this cron job"
  return [
    "Thread policy:",
    `- This thread belongs to cron job ${jobLabel}.`,
    "- Keep work focused on this cron job's ongoing context and prior runs.",
    "- Do not act like this is the main user-facing conversation thread.",
    "- If user attention or a decision is needed, call notify_main_thread with a concise prompt for main.",
  ].join("\n")
}

function buildHeartbeatThreadNote() {
  return [
    "Thread policy:",
    "- This thread belongs to heartbeat.",
    "- Treat the main/root conversation as the durable source of user context.",
    "- The standard tool surface remains available in this thread.",
    "- Use any available tool when it materially helps the heartbeat do useful work.",
    "- Do not act like this is the main user-facing conversation thread.",
    "- If user attention or a decision is needed, call notify_main_thread with a concise prompt for main.",
  ].join("\n")
}

const scheduleKindSchema = z.enum(["at", "every", "cron"])
const runModeSchema = z.enum(["background", "conditional_agent", "agent"])
const payloadSchema = z.record(z.string(), z.unknown())

const jobCreateSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  enabled: z.boolean().optional(),
  scheduleKind: scheduleKindSchema,
  scheduleExpr: z.string().min(1).nullable().optional(),
  everyMs: z.number().int().positive().nullable().optional(),
  atIso: z.string().min(1).nullable().optional(),
  timezone: z.string().min(1).nullable().optional(),
  runMode: runModeSchema,
  handlerKey: z.string().min(1).nullable().optional(),
  conditionModulePath: z.string().min(1).nullable().optional(),
  conditionDescription: z.string().min(1).nullable().optional(),
  agentPromptTemplate: z.string().min(1).nullable().optional(),
  agentModelOverride: z.string().min(1).nullable().optional(),
  maxAttempts: z.number().int().positive().optional(),
  retryBackoffMs: z.number().int().positive().optional(),
  payload: payloadSchema.optional(),
})

const jobPatchSchema = z.object({
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  scheduleKind: scheduleKindSchema.optional(),
  scheduleExpr: z.string().min(1).nullable().optional(),
  everyMs: z.number().int().positive().nullable().optional(),
  atIso: z.string().min(1).nullable().optional(),
  timezone: z.string().min(1).nullable().optional(),
  runMode: runModeSchema.optional(),
  handlerKey: z.string().min(1).nullable().optional(),
  conditionModulePath: z.string().min(1).nullable().optional(),
  conditionDescription: z.string().min(1).nullable().optional(),
  agentPromptTemplate: z.string().min(1).nullable().optional(),
  agentModelOverride: z.string().min(1).nullable().optional(),
  maxAttempts: z.number().int().positive().optional(),
  retryBackoffMs: z.number().int().positive().optional(),
  payload: payloadSchema.optional(),
})

const cronArgsSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list_jobs") }),
  z.object({ action: z.literal("list_handlers") }),
  z.object({ action: z.literal("health") }),
  z.object({ action: z.literal("get_job"), jobId: z.string().min(1) }),
  z.object({ action: z.literal("create_job"), job: jobCreateSchema }),
  z.object({ action: z.literal("upsert_job"), job: jobCreateSchema }),
  z.object({ action: z.literal("update_job"), jobId: z.string().min(1), patch: jobPatchSchema }),
  z.object({ action: z.literal("enable_job"), jobId: z.string().min(1) }),
  z.object({ action: z.literal("disable_job"), jobId: z.string().min(1) }),
  z.object({ action: z.literal("describe_contract") }),
  z.object({ action: z.literal("delete_job"), jobId: z.string().min(1) }),
  z.object({ action: z.literal("run_job_now"), jobId: z.string().min(1) }),
  z.object({ action: z.literal("list_instances"), jobId: z.string().min(1).optional(), limit: z.number().int().positive().optional() }),
  z.object({ action: z.literal("list_steps"), instanceId: z.string().min(1) }),
])

const agentTypeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  variant: z.string().min(1).optional(),
  mode: z.enum(["subagent", "primary", "all"]).optional(),
  hidden: z.boolean().optional(),
  disable: z.boolean().optional(),
  temperature: z.number().optional(),
  topP: z.number().optional(),
  steps: z.number().int().positive().optional(),
  permission: z.unknown().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  queueMode: z.enum(["collect", "followup", "replace"]).optional(),
})

const agentArgsSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list") }),
  z.object({
    action: z.literal("validate_patch"),
    upserts: z.array(agentTypeSchema).default([]),
    deletes: z.array(z.string().min(1)).default([]),
  }),
  z.object({
    action: z.literal("apply_patch"),
    upserts: z.array(agentTypeSchema).default([]),
    deletes: z.array(z.string().min(1)).default([]),
    expectedHash: z.string().min(1),
  }),
])

const configArgsSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("get_config") }),
  z.object({
    action: z.literal("patch_config"),
    patch: z.unknown(),
    expectedHash: z.string().min(1),
    runSmokeTest: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("replace_config"),
    config: z.unknown(),
    expectedHash: z.string().min(1),
    runSmokeTest: z.boolean().optional(),
  }),
])

const memorySearchTool = tool({
  description: "Search memory for relevant prior context.",
  args: {
    query: z.string().min(1).describe("Natural language memory query"),
    maxResults: z.number().int().min(1).max(20).optional(),
    minScore: z.number().min(0).max(1).optional(),
    debug: z.boolean().optional().describe("Include retrieval debug details."),
  },
  async execute(args: { query: string; maxResults?: number; minScore?: number; debug?: boolean }) {
    const response = await postJson(
      "/api/mockingbird/memory/retrieve",
      {
        query: args.query,
        maxResults: args.maxResults,
        minScore: args.minScore,
        debug: args.debug,
      },
      ["AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL"],
    )
    if (!response.ok) {
      const error = typeof response.payload.error === "string" ? response.payload.error : `Request failed (${response.status})`
      throw new Error(error)
    }

    const results = Array.isArray(response.payload.results) ? response.payload.results : []
    const compactResults = results.map((result) => {
      const value = result as JsonObject
      const snippet = typeof value.snippet === "string" ? value.snippet : ""
      return {
        id: value.id,
        score: value.score,
        citation: value.citation,
        path: value.path,
        startLine: value.startLine,
        endLine: value.endLine,
        preview: toPreview(snippet),
        snippet: toPreview(snippet),
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
})

const memoryGetTool = tool({
  description: "Read a safe slice of canonical markdown memory files by path and line window.",
  args: {
    path: z.string().min(1).describe("Memory path such as MEMORY.md or memory/2026-02-17.md"),
    from: z.number().int().min(1).optional().describe("Start line number (1-based)"),
    lines: z.number().int().min(1).max(400).optional().describe("Number of lines to return"),
  },
  async execute(args: { path: string; from?: number; lines?: number }) {
    const response = await postJson(
      "/api/mockingbird/memory/read",
      {
        path: args.path,
        from: args.from,
        lines: args.lines,
      },
      ["AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL"],
    )
    if (!response.ok) {
      const error = typeof response.payload.error === "string" ? response.payload.error : `Request failed (${response.status})`
      throw new Error(error)
    }

    return JSON.stringify({
      ok: true,
      path: response.payload.path,
      text: response.payload.text,
    })
  },
})

const memoryRememberTool = tool({
  description: "Persist a memory note so it can be retrieved later.",
  args: {
    content: z.string().min(1),
    confidence: z.number().min(0).max(1).optional(),
    source: z.enum(["assistant", "user", "system"]).optional(),
    entities: z.array(z.string()).optional(),
    supersedes: z.array(z.string()).optional(),
    topic: z.string().optional(),
  },
  async execute(args: {
    content: string
    confidence?: number
    source?: "assistant" | "user" | "system"
    entities?: string[]
    supersedes?: string[]
    topic?: string
  }, context: ToolContext) {
    const response = await postJson(
      "/api/mockingbird/memory/remember",
      {
        ...args,
        source: args.source ?? "assistant",
        sessionId: context.sessionID,
      },
      ["AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL"],
    )

    if (!response.ok && response.status !== 422) {
      const error = typeof response.payload.error === "string" ? response.payload.error : `Request failed (${response.status})`
      throw new Error(error)
    }

    return JSON.stringify({
      ok: response.ok,
      status: response.status,
      result: response.payload,
    })
  },
})

const cronManagerTool = tool({
  description: "Manage Agent Mockingbird cron jobs (list/create/update/run/delete/inspect).",
  args: {
    action: z.enum([
      "list_jobs",
      "list_handlers",
      "health",
      "get_job",
      "create_job",
      "upsert_job",
      "update_job",
      "enable_job",
      "disable_job",
      "describe_contract",
      "delete_job",
      "run_job_now",
      "list_instances",
      "list_steps",
    ]),
    jobId: z.string().optional(),
    instanceId: z.string().optional(),
    limit: z.number().int().positive().optional(),
    job: z.unknown().optional(),
    patch: z.unknown().optional(),
  },
  async execute(rawArgs) {
    const args = cronArgsSchema.parse(rawArgs)
    const response = await postJson("/api/mockingbird/cron/manage", args, [
      "AGENT_MOCKINGBIRD_CRON_API_BASE_URL",
      "AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL",
    ])
    if (!response.ok) {
      const error = typeof response.payload.error === "string" ? response.payload.error : `Request failed (${response.status})`
      throw new Error(error)
    }
    return JSON.stringify({
      ok: true,
      ...response.payload,
    })
  },
})

const notifyMainThreadTool = tool({
  description: "Escalate a concise prompt from a cron worker thread into the main/root conversation.",
  args: {
    prompt: z.string().min(1),
    severity: z.enum(["info", "warn", "critical"]).optional(),
  },
  async execute(args: { prompt: string; severity?: "info" | "warn" | "critical" }, context: ToolContext) {
    const response = await postJson("/api/mockingbird/runtime/notify-main-thread", {
      sessionId: context.sessionID,
      prompt: args.prompt,
      severity: args.severity,
    })
    if (!response.ok) {
      const error = typeof response.payload.error === "string" ? response.payload.error : `Request failed (${response.status})`
      throw new Error(error)
    }
    return JSON.stringify({
      ok: true,
      ...response.payload,
    })
  },
})

const agentTypeManagerTool = tool({
  description:
    "Manage OpenCode agent definitions through Agent Mockingbird's OpenCode-backed APIs with validation and hash conflict detection.",
  args: {
    action: z.enum(["list", "validate_patch", "apply_patch"]),
    upserts: z.array(z.unknown()).optional(),
    deletes: z.array(z.string().min(1)).optional(),
    expectedHash: z.string().min(1).optional(),
  },
  async execute(rawArgs: {
    action: "list" | "validate_patch" | "apply_patch"
    upserts?: unknown[]
    deletes?: string[]
    expectedHash?: string
  }) {
    const args = agentArgsSchema.parse(rawArgs)

    if (args.action === "list") {
      const payload = await requestJson("/api/mockingbird/agents")
      return JSON.stringify({ ok: true, ...payload })
    }

    if (args.action === "validate_patch") {
      const payload = await requestJson("/api/mockingbird/agents/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          upserts: args.upserts,
          deletes: args.deletes,
        }),
      })
      return JSON.stringify({ ok: true, ...payload })
    }

    const payload = await requestJson("/api/mockingbird/agents", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        upserts: args.upserts,
        deletes: args.deletes,
        expectedHash: args.expectedHash,
      }),
    })
    return JSON.stringify({ ok: true, ...payload })
  },
})

const configManagerTool = tool({
  description:
    "Read or update Agent Mockingbird managed config through validated APIs with hash conflict detection and optional smoke tests.",
  args: {
    action: z.enum(["get_config", "patch_config", "replace_config"]),
    patch: z.unknown().optional(),
    config: z.unknown().optional(),
    expectedHash: z.string().min(1).optional(),
    runSmokeTest: z.boolean().optional(),
  },
  async execute(rawArgs: {
    action: "get_config" | "patch_config" | "replace_config"
    patch?: unknown
    config?: unknown
    expectedHash?: string
    runSmokeTest?: boolean
  }) {
    const args = configArgsSchema.parse(rawArgs)

    if (args.action === "get_config") {
      const payload = await requestJson("/api/config")
      return JSON.stringify({ ok: true, ...payload })
    }

    if (args.action === "patch_config") {
      const payload = await requestJson("/api/config/patch-safe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patch: args.patch,
          expectedHash: args.expectedHash,
          runSmokeTest: args.runSmokeTest,
        }),
      })
      return JSON.stringify({ ok: true, ...payload })
    }

    const payload = await requestJson("/api/config/replace-safe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: args.config,
        expectedHash: args.expectedHash,
        runSmokeTest: args.runSmokeTest,
      }),
    })
    return JSON.stringify({ ok: true, ...payload })
  },
})

const AgentMockingbirdPlugin: Plugin = async () => {
  return {
    "experimental.chat.system.transform": async (_input, output) => {
      const system = await fetchSystemPrompt()
      if (!system.trim()) return
      output.system.push(system)
      const sessionScope = await fetchSessionScope(_input.sessionID)
      if (sessionScope.isMain) {
        output.system.push(buildMainThreadNote())
      } else if (sessionScope.kind === "cron") {
        output.system.push(buildCronThreadNote(sessionScope))
      } else if (sessionScope.kind === "heartbeat") {
        output.system.push(buildHeartbeatThreadNote())
      }
    },
    "experimental.session.compacting": async (_input, output) => {
      const compaction = await fetchCompactionContext(_input.sessionID)
      if (compaction.prompt) {
        output.prompt = compaction.prompt
        return
      }
      if (compaction.context.length === 0) return
      output.context.push(...compaction.context)
    },
    "tool.definition": async (input, output) => {
      rewriteToolDefinition(input.toolID, output)
    },
    "shell.env": async (_input, output) => {
      const defaultBaseUrl = resolveApiBaseUrl(
        "AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL",
        "AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL",
        "AGENT_MOCKINGBIRD_CRON_API_BASE_URL",
      )
      output.env.AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL ??=
        process.env.AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL?.trim() || defaultBaseUrl
      output.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL ??=
        process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL?.trim() || defaultBaseUrl
      output.env.AGENT_MOCKINGBIRD_CRON_API_BASE_URL ??=
        process.env.AGENT_MOCKINGBIRD_CRON_API_BASE_URL?.trim() ||
        process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL?.trim() ||
        defaultBaseUrl
      if (process.env.AGENT_MOCKINGBIRD_PORT?.trim()) {
        output.env.AGENT_MOCKINGBIRD_PORT ??= process.env.AGENT_MOCKINGBIRD_PORT.trim()
      }
    },
    tool: {
      memory_search: memorySearchTool,
      memory_get: memoryGetTool,
      memory_remember: memoryRememberTool,
      cron_manager: cronManagerTool,
      notify_main_thread: notifyMainThreadTool,
      agent_type_manager: agentTypeManagerTool,
      config_manager: configManagerTool,
    },
  }
}

export { AgentMockingbirdPlugin }
export default AgentMockingbirdPlugin

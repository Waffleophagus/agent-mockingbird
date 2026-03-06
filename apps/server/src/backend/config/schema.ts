import { z } from "zod";

const stringListSchema = z.array(z.string().min(1)).transform(values => {
  const normalized = values.map(value => value.trim()).filter(Boolean);
  return [...new Set(normalized)];
});

const mcpServerIdSchema = z.string().min(1).regex(/^[A-Za-z0-9._-]+$/);
const mcpHeadersSchema = z.record(z.string(), z.string()).default({});
const mcpEnvironmentSchema = z.record(z.string(), z.string()).default({});

export const specialistAgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  specialty: z.string().min(1),
  summary: z.string().min(1),
  model: z.string().min(1),
  status: z.enum(["available", "busy", "offline"]),
});

const agentTypeModeSchema = z.enum(["subagent", "primary", "all"]);
const openCodePermissionScalarSchema = z.enum(["allow", "deny", "ask"]);
const openCodePermissionRuleMapSchema = z.record(z.string(), openCodePermissionScalarSchema);
const openCodePermissionValueSchema = z.union([openCodePermissionScalarSchema, openCodePermissionRuleMapSchema]);
const openCodePermissionSchema = z.record(z.string(), openCodePermissionValueSchema);

const heartbeatActiveHoursSchema = z
  .object({
    start: z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/).default("08:00"),
    end: z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/).default("22:00"),
    timezone: z
      .string()
      .default("America/New_York")
      .refine(value => {
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Invalid timezone"),
  })
  .strict();

const heartbeatConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    interval: z.string().regex(/^\d+[mhd]$/).default("30m"),
    activeHours: heartbeatActiveHoursSchema.optional(),
    prompt: z.string().optional(),
    ackMaxChars: z.number().int().min(0).max(1000).default(300),
  })
  .strict();

const queueModeSchema = z.enum(["collect", "followup", "replace"]);

export const agentTypeDefinitionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    prompt: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    variant: z.string().min(1).optional(),
    mode: agentTypeModeSchema.default("subagent"),
    hidden: z.boolean().default(false),
    disable: z.boolean().default(false),
    temperature: z.number().optional(),
    topP: z.number().optional(),
    steps: z.number().int().positive().optional(),
    permission: openCodePermissionSchema.optional(),
    options: z.record(z.string(), z.unknown()).default({}),
    heartbeat: heartbeatConfigSchema.optional(),
    queueMode: queueModeSchema.optional(),
  })
  .strict();

const agentTypeDefinitionListSchema = z.array(agentTypeDefinitionSchema).transform(agentTypes => {
  const deduped = new Map<string, (typeof agentTypes)[number]>();
  for (const rawType of agentTypes) {
    const id = rawType.id.trim();
    if (!id) continue;
    deduped.set(id, {
      ...rawType,
      id,
      name: rawType.name?.trim() || undefined,
      description: rawType.description?.trim() || undefined,
      prompt: rawType.prompt?.trim() || undefined,
      model: rawType.model?.trim() || undefined,
      variant: rawType.variant?.trim() || undefined,
    });
  }
  return [...deduped.values()].sort((a, b) => a.id.localeCompare(b.id));
});

export const configuredMcpServerSchema = z.discriminatedUnion("type", [
  z
    .object({
      id: mcpServerIdSchema,
      type: z.literal("remote"),
      enabled: z.boolean().default(true),
      url: z.string().url(),
      headers: mcpHeadersSchema,
      oauth: z.enum(["auto", "off"]).default("auto"),
      timeoutMs: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      id: mcpServerIdSchema,
      type: z.literal("local"),
      enabled: z.boolean().default(true),
      command: z.array(z.string().min(1)).min(1),
      environment: mcpEnvironmentSchema,
      timeoutMs: z.number().int().positive().optional(),
    })
    .strict(),
]);

const configuredMcpServerListSchema = z.array(configuredMcpServerSchema).transform(servers => {
  const deduped = new Map<string, (typeof servers)[number]>();
  for (const server of servers) {
    deduped.set(server.id, server);
  }
  return [...deduped.values()].sort((a, b) => a.id.localeCompare(b.id));
});

export const runtimeOpencodeSchema = z
  .object({
    baseUrl: z.string().url(),
    providerId: z.string().min(1),
    modelId: z.string().min(1),
    fallbackModels: stringListSchema.default([]),
    imageModel: z.string().min(1).nullable().default(null),
    smallModel: z.string().min(1),
    timeoutMs: z.number().int().positive(),
    promptTimeoutMs: z.number().int().positive(),
    runWaitTimeoutMs: z.number().int().positive().default(180_000),
    childSessionHideAfterDays: z.number().int().min(0).max(365).default(3),
    directory: z.string().min(1).nullable().default(null),
    bootstrap: z
      .object({
        enabled: z.boolean().default(true),
        maxCharsPerFile: z.number().int().positive().default(20_000),
        maxCharsTotal: z.number().int().positive().default(150_000),
        subagentMinimal: z.boolean().default(true),
        includeAgentPrompt: z.boolean().default(true),
      })
      .strict()
      .default({
        enabled: true,
        maxCharsPerFile: 20_000,
        maxCharsTotal: 150_000,
        subagentMinimal: true,
        includeAgentPrompt: true,
      }),
  })
  .strict();

export const runtimeSmokeTestSchema = z
  .object({
    prompt: z.string().min(1),
    expectedResponsePattern: z.string().min(1),
  })
  .strict();

export const runtimeRunStreamSchema = z
  .object({
    heartbeatMs: z.number().int().min(1_000).default(15_000),
    replayPageSize: z.number().int().positive().max(1_000).default(200),
  })
  .strict();

export const runtimeMemorySchema = z
  .object({
    enabled: z.boolean().default(true),
    workspaceDir: z.string().min(1).default("./data/workspace"),
    embedProvider: z.enum(["ollama", "none"]).default("ollama"),
    embedModel: z.string().min(1).default("granite-embedding:278m"),
    ollamaBaseUrl: z.string().url().default("http://127.0.0.1:11434"),
    chunkTokens: z.number().int().positive().default(400),
    chunkOverlap: z.number().int().min(0).default(80),
    maxResults: z.number().int().positive().default(4),
    minScore: z.number().min(0).max(1).default(0.35),
    syncCooldownMs: z.number().int().min(0).default(10_000),
    toolMode: z.enum(["hybrid", "inject_only", "tool_only"]).default("tool_only"),
    injectionDedupeEnabled: z.boolean().default(true),
    injectionDedupeFallbackRecallOnly: z.boolean().default(true),
    injectionDedupeMaxTracked: z.number().int().min(32).max(10_000).default(256),
    retrieval: z
      .object({
        engine: z.enum(["qmd_hybrid", "legacy"]).default("qmd_hybrid"),
        strongSignalMinScore: z.number().min(0).max(1).default(0.85),
        strongSignalMinGap: z.number().min(0).max(1).default(0.15),
        candidateLimit: z.number().int().positive().max(200).default(40),
        rrfK: z.number().int().positive().max(500).default(60),
        expansionEnabled: z.boolean().default(true),
        conceptExpansionEnabled: z.boolean().default(true),
        conceptExpansionMaxPacks: z.number().int().positive().max(20).default(3),
        conceptExpansionMaxTerms: z.number().int().positive().max(64).default(10),
        rerankEnabled: z.boolean().default(true),
        rerankTopN: z.number().int().positive().max(200).default(40),
        semanticRescueEnabled: z.boolean().default(true),
        semanticRescueMinVectorScore: z.number().min(0).max(1).default(0.75),
        semanticRescueMaxResults: z.number().int().min(0).max(20).default(2),
        expansionModel: z.string().min(1).nullable().default(null),
        rerankModel: z.string().min(1).nullable().default(null),
        vectorBackend: z.enum(["sqlite_vec", "legacy_json", "disabled"]).default("sqlite_vec"),
        vectorUnavailableFallback: z.enum(["disabled", "legacy_json"]).default("disabled"),
        vectorK: z.number().int().positive().max(500).default(60),
        vectorProbeLimit: z.number().int().positive().max(200).default(20),
      })
      .strict()
      .default({
        engine: "qmd_hybrid",
        strongSignalMinScore: 0.85,
        strongSignalMinGap: 0.15,
        candidateLimit: 40,
        rrfK: 60,
        expansionEnabled: true,
        conceptExpansionEnabled: true,
        conceptExpansionMaxPacks: 3,
        conceptExpansionMaxTerms: 10,
        rerankEnabled: true,
        rerankTopN: 40,
        semanticRescueEnabled: true,
        semanticRescueMinVectorScore: 0.75,
        semanticRescueMaxResults: 2,
        expansionModel: null,
        rerankModel: null,
        vectorBackend: "sqlite_vec",
        vectorUnavailableFallback: "disabled",
        vectorK: 60,
        vectorProbeLimit: 20,
      }),
  })
  .strict();

export const runtimeCronSchema = z
  .object({
    defaultMaxAttempts: z.number().int().min(1).default(3),
    defaultRetryBackoffMs: z.number().int().min(1_000).default(30_000),
    retryBackoffCapMs: z.number().int().min(1_000).default(3_600_000),
    conditionalModuleTimeoutMs: z.number().int().min(1_000).max(300_000).default(30_000),
  })
  .strict();

export const runtimeQueueSchema = z
  .object({
    enabled: z.boolean().default(true),
    defaultMode: queueModeSchema.default("collect"),
    maxDepth: z.number().int().min(1).max(100).default(10),
    coalesceDebounceMs: z.number().int().min(0).max(60_000).default(500),
  })
  .strict();

const signalDmPolicySchema = z.enum(["pairing", "allowlist", "open", "disabled"]);
const signalGroupPolicySchema = z.enum(["open", "allowlist", "disabled"]);
const signalGroupActivationSchema = z.enum(["mention", "always"]);

const signalGroupConfigSchema = z
  .object({
    requireMention: z.boolean().optional(),
    activation: signalGroupActivationSchema.optional(),
  })
  .strict();

export const runtimeSignalChannelSchema = z
  .object({
    enabled: z.boolean().default(false),
    httpUrl: z.string().url().default("http://127.0.0.1:8080"),
    account: z.string().min(1).nullable().default(null),
    dmPolicy: signalDmPolicySchema.default("pairing"),
    allowFrom: stringListSchema.default([]),
    groupPolicy: signalGroupPolicySchema.default("allowlist"),
    groupAllowFrom: stringListSchema.default([]),
    groups: z.record(z.string(), signalGroupConfigSchema).default({}),
    mentionPatterns: stringListSchema.default([]),
    groupActivationDefault: signalGroupActivationSchema.default("mention"),
    textChunkLimit: z.number().int().positive().default(4_000),
    chunkMode: z.enum(["length", "newline"]).default("length"),
    pairing: z
      .object({
        ttlMs: z.number().int().positive().default(3_600_000),
        maxPending: z.number().int().positive().max(100).default(3),
      })
      .strict()
      .default({
        ttlMs: 3_600_000,
        maxPending: 3,
      }),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.dmPolicy === "open" && !value.allowFrom.includes("*")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'runtime.channels.signal.dmPolicy="open" requires runtime.channels.signal.allowFrom to include "*"',
        path: ["allowFrom"],
      });
    }
  });

export const runtimeChannelsSchema = z
  .object({
    signal: runtimeSignalChannelSchema.default({
      enabled: false,
      httpUrl: "http://127.0.0.1:8080",
      account: null,
      dmPolicy: "pairing",
      allowFrom: [],
      groupPolicy: "allowlist",
      groupAllowFrom: [],
      groups: {},
      mentionPatterns: [],
      groupActivationDefault: "mention",
      textChunkLimit: 4_000,
      chunkMode: "length",
      pairing: {
        ttlMs: 3_600_000,
        maxPending: 3,
      },
    }),
  })
  .strict()
  .default({
    signal: {
      enabled: false,
      httpUrl: "http://127.0.0.1:8080",
      account: null,
      dmPolicy: "pairing",
      allowFrom: [],
      groupPolicy: "allowlist",
      groupAllowFrom: [],
      groups: {},
      mentionPatterns: [],
      groupActivationDefault: "mention",
      textChunkLimit: 4_000,
      chunkMode: "length",
      pairing: {
        ttlMs: 3_600_000,
        maxPending: 3,
      },
    },
  });

export const runtimeConfigPolicySchema = z
  .object({
    mode: z.enum(["builder", "strict"]).default("builder"),
    denyPaths: stringListSchema.default(["version", "runtime.configPolicy", "runtime.smokeTest"]),
    strictAllowPaths: stringListSchema.default([
      "runtime.opencode.runWaitTimeoutMs",
      "runtime.opencode.childSessionHideAfterDays",
      "runtime.opencode.bootstrap",
      "runtime.opencode.imageModel",
      "runtime.runStream",
      "runtime.memory",
      "runtime.cron",
      "runtime.queue",
      "runtime.channels",
      "ui.skills",
      "ui.mcps",
      "ui.mcpServers",
      "ui.agents",
      "ui.agentTypes",
    ]),
    requireExpectedHash: z.boolean().default(true),
    requireSmokeTest: z.boolean().default(true),
    autoRollbackOnFailure: z.boolean().default(true),
  })
  .strict();

export const wafflebotConfigSchema = z
  .object({
    version: z.literal(1),
    runtime: z
      .object({
        opencode: runtimeOpencodeSchema,
        smokeTest: runtimeSmokeTestSchema,
        runStream: runtimeRunStreamSchema.default({
          heartbeatMs: 15_000,
          replayPageSize: 200,
        }),
        memory: runtimeMemorySchema.default({
          enabled: true,
          workspaceDir: "./data/workspace",
          embedProvider: "ollama",
          embedModel: "granite-embedding:278m",
          ollamaBaseUrl: "http://127.0.0.1:11434",
          chunkTokens: 400,
          chunkOverlap: 80,
          maxResults: 4,
          minScore: 0.35,
          syncCooldownMs: 10_000,
          toolMode: "tool_only",
          injectionDedupeEnabled: true,
          injectionDedupeFallbackRecallOnly: true,
          injectionDedupeMaxTracked: 256,
          retrieval: {
            engine: "qmd_hybrid",
            strongSignalMinScore: 0.85,
            strongSignalMinGap: 0.15,
            candidateLimit: 40,
            rrfK: 60,
            expansionEnabled: true,
            conceptExpansionEnabled: true,
            conceptExpansionMaxPacks: 3,
            conceptExpansionMaxTerms: 10,
            rerankEnabled: true,
            rerankTopN: 40,
            semanticRescueEnabled: true,
            semanticRescueMinVectorScore: 0.75,
            semanticRescueMaxResults: 2,
            expansionModel: null,
            rerankModel: null,
            vectorBackend: "sqlite_vec",
            vectorUnavailableFallback: "disabled",
            vectorK: 60,
            vectorProbeLimit: 20,
          },
        }),
        cron: runtimeCronSchema.default({
          defaultMaxAttempts: 3,
          defaultRetryBackoffMs: 30_000,
          retryBackoffCapMs: 3_600_000,
          conditionalModuleTimeoutMs: 30_000,
        }),
        queue: runtimeQueueSchema.default({
          enabled: true,
          defaultMode: "collect",
          maxDepth: 10,
          coalesceDebounceMs: 500,
        }),
        channels: runtimeChannelsSchema,
        configPolicy: runtimeConfigPolicySchema.default({
          mode: "builder",
          denyPaths: ["version", "runtime.configPolicy", "runtime.smokeTest"],
          strictAllowPaths: [
            "runtime.opencode.runWaitTimeoutMs",
            "runtime.opencode.childSessionHideAfterDays",
            "runtime.opencode.bootstrap",
            "runtime.opencode.imageModel",
            "runtime.runStream",
            "runtime.memory",
            "runtime.cron",
            "runtime.queue",
            "runtime.channels",
            "ui.skills",
            "ui.mcps",
            "ui.mcpServers",
            "ui.agents",
            "ui.agentTypes",
          ],
          requireExpectedHash: true,
          requireSmokeTest: true,
          autoRollbackOnFailure: true,
        }),
      })
      .strict(),
    ui: z
      .object({
        skills: stringListSchema.default([]),
        mcps: stringListSchema.default([]),
        mcpServers: configuredMcpServerListSchema.default([]),
        agents: z.array(specialistAgentSchema).default([]),
        agentTypes: agentTypeDefinitionListSchema.default([]),
      })
      .strict(),
  })
  .strict();

export type WafflebotConfig = z.infer<typeof wafflebotConfigSchema>;
export type ConfiguredMcpServer = z.infer<typeof configuredMcpServerSchema>;
export type AgentTypeDefinition = z.infer<typeof agentTypeDefinitionSchema>;

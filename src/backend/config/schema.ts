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
    smallModel: z.string().min(1),
    timeoutMs: z.number().int().positive(),
    promptTimeoutMs: z.number().int().positive(),
    runWaitTimeoutMs: z.number().int().positive().default(180_000),
    directory: z.string().min(1).nullable().default(null),
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
    embedModel: z.string().min(1).default("nomic-embed-text"),
    ollamaBaseUrl: z.string().url().default("http://127.0.0.1:11434"),
    chunkTokens: z.number().int().positive().default(400),
    chunkOverlap: z.number().int().min(0).default(80),
    maxResults: z.number().int().positive().default(6),
    minScore: z.number().min(0).max(1).default(0.25),
    syncCooldownMs: z.number().int().min(0).default(10_000),
    toolMode: z.enum(["hybrid", "inject_only", "tool_only"]).default("hybrid"),
    writePolicy: z.enum(["conservative", "moderate", "aggressive"]).default("conservative"),
    minConfidence: z.number().min(0).max(1).default(0.7),
  })
  .strict();

export const runtimeCronSchema = z
  .object({
    defaultMaxAttempts: z.number().int().min(1).default(3),
    defaultRetryBackoffMs: z.number().int().min(1_000).default(30_000),
    retryBackoffCapMs: z.number().int().min(1_000).default(3_600_000),
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
          embedModel: "nomic-embed-text",
          ollamaBaseUrl: "http://127.0.0.1:11434",
          chunkTokens: 400,
          chunkOverlap: 80,
          maxResults: 6,
          minScore: 0.25,
          syncCooldownMs: 10_000,
          toolMode: "hybrid",
          writePolicy: "conservative",
          minConfidence: 0.7,
        }),
        cron: runtimeCronSchema.default({
          defaultMaxAttempts: 3,
          defaultRetryBackoffMs: 30_000,
          retryBackoffCapMs: 3_600_000,
        }),
      })
      .strict(),
    ui: z
      .object({
        skills: stringListSchema.default([]),
        mcps: stringListSchema.default([]),
        mcpServers: configuredMcpServerListSchema.default([]),
        agents: z.array(specialistAgentSchema).default([]),
      })
      .strict(),
  })
  .strict();

export type WafflebotConfig = z.infer<typeof wafflebotConfigSchema>;
export type ConfiguredMcpServer = z.infer<typeof configuredMcpServerSchema>;

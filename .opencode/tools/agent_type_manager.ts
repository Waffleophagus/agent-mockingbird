import { tool } from "@opencode-ai/plugin";
import { z } from "zod";

function resolveApiBaseUrl() {
  const explicit = process.env.WAFFLEBOT_CONFIG_API_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const port = process.env.WAFFLEBOT_PORT?.trim() || process.env.PORT?.trim() || "3001";
  return `http://127.0.0.1:${port}`;
}

async function requestJson(pathname: string, init?: RequestInit) {
  const response = await fetch(`${resolveApiBaseUrl()}${pathname}`, init);
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const error = typeof payload.error === "string" ? payload.error : `Request failed (${response.status})`;
    throw new Error(error);
  }
  return payload;
}

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
});

const argsSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list"),
  }),
  z.object({
    action: z.literal("replace"),
    agentTypes: z.array(agentTypeSchema),
    expectedHash: z.string().min(1),
    runSmokeTest: z.boolean().optional(),
  }),
]);

export default tool({
  description:
    "Read or replace Wafflebot agent type definitions through validated APIs with hash conflict detection.",
  args: {
    action: tool.schema.enum(["list", "replace"]),
    agentTypes: tool.schema.array(tool.schema.unknown()).optional(),
    expectedHash: tool.schema.string().min(1).optional(),
    runSmokeTest: tool.schema.boolean().optional(),
  },
  async execute(rawArgs: {
    action: "list" | "replace";
    agentTypes?: unknown[];
    expectedHash?: string;
    runSmokeTest?: boolean;
  }) {
    const args = argsSchema.parse(rawArgs);

    if (args.action === "list") {
      const payload = await requestJson("/api/config/agent-types");
      return JSON.stringify({ ok: true, ...payload });
    }

    const payload = await requestJson("/api/config/agent-types", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentTypes: args.agentTypes,
        expectedHash: args.expectedHash,
        runSmokeTest: args.runSmokeTest,
      }),
    });
    return JSON.stringify({ ok: true, ...payload });
  },
});

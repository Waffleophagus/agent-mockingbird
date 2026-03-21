import { tool } from "@opencode-ai/plugin";
import { z } from "zod";

function resolveApiBaseUrl() {
  const explicit = process.env.AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const port =
    process.env.AGENT_MOCKINGBIRD_PORT?.trim() ||
    process.env.PORT?.trim() ||
    "3001";
  return `http://127.0.0.1:${port}`;
}

async function requestJson(pathname: string, init?: RequestInit) {
  const response = await fetch(`${resolveApiBaseUrl()}${pathname}`, init);
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const error =
      typeof payload.error === "string"
        ? payload.error
        : `Request failed (${response.status})`;
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
]);

export default tool({
  description:
    "Manage OpenCode agent definitions through Agent Mockingbird's OpenCode-backed APIs with validation and hash conflict detection.",
  args: {
    action: tool.schema.enum(["list", "validate_patch", "apply_patch"]),
    upserts: tool.schema.array(tool.schema.unknown()).optional(),
    deletes: tool.schema.array(tool.schema.string().min(1)).optional(),
    expectedHash: tool.schema.string().min(1).optional(),
  },
  async execute(rawArgs: {
    action: "list" | "validate_patch" | "apply_patch";
    upserts?: unknown[];
    deletes?: string[];
    expectedHash?: string;
  }) {
    const args = argsSchema.parse(rawArgs);

    if (args.action === "list") {
      const payload = await requestJson("/api/mockingbird/agents");
      return JSON.stringify({ ok: true, ...payload });
    }

    if (args.action === "validate_patch") {
      const payload = await requestJson("/api/mockingbird/agents/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          upserts: args.upserts,
          deletes: args.deletes,
        }),
      });
      return JSON.stringify({ ok: true, ...payload });
    }

    const payload = await requestJson("/api/mockingbird/agents", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        upserts: args.upserts,
        deletes: args.deletes,
        expectedHash: args.expectedHash,
      }),
    });
    return JSON.stringify({ ok: true, ...payload });
  },
});

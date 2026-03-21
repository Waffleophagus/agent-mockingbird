import { tool } from "@opencode-ai/plugin";
import { z } from "zod";

function resolveApiBaseUrl() {
  const explicit = process.env.AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const memoryAlias = process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL?.trim();
  if (memoryAlias) return memoryAlias.replace(/\/+$/, "");
  const cronAlias = process.env.AGENT_MOCKINGBIRD_CRON_API_BASE_URL?.trim();
  if (cronAlias) return cronAlias.replace(/\/+$/, "");
  const port = process.env.AGENT_MOCKINGBIRD_PORT?.trim() || process.env.PORT?.trim() || "3001";
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

const argsSchema = z.discriminatedUnion("action", [
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
]);

export default tool({
  description:
    "Read or update Agent Mockingbird managed config through validated APIs with hash conflict detection and optional smoke tests.",
  args: {
    action: tool.schema.enum(["get_config", "patch_config", "replace_config"]),
    patch: tool.schema.unknown().optional(),
    config: tool.schema.unknown().optional(),
    expectedHash: tool.schema.string().min(1).optional(),
    runSmokeTest: tool.schema.boolean().optional(),
  },
  async execute(rawArgs: {
    action: "get_config" | "patch_config" | "replace_config";
    patch?: unknown;
    config?: unknown;
    expectedHash?: string;
    runSmokeTest?: boolean;
  }) {
    const args = argsSchema.parse(rawArgs);

    if (args.action === "get_config") {
      const payload = await requestJson("/api/config");
      return JSON.stringify({ ok: true, ...payload });
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
      });
      return JSON.stringify({ ok: true, ...payload });
    }

    const payload = await requestJson("/api/config/replace-safe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: args.config,
        expectedHash: args.expectedHash,
        runSmokeTest: args.runSmokeTest,
      }),
    });
    return JSON.stringify({ ok: true, ...payload });
  },
});

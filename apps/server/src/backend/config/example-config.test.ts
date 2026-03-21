import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { agentMockingbirdConfigSchema } from "./schema";
import { resolveExampleConfigPath } from "./testFixtures";

test("agent-mockingbird.config.example.json stays aligned with schema", () => {
  const filePath = resolveExampleConfigPath();
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;

  const runtime = raw.runtime as Record<string, unknown> | undefined;
  const opencode = runtime?.opencode as Record<string, unknown> | undefined;
  const heartbeat = runtime?.heartbeat as Record<string, unknown> | undefined;
  expect(typeof opencode?.childSessionHideAfterDays).toBe("number");
  expect(typeof heartbeat?.model).toBe("string");
  expect(typeof runtime?.configPolicy).toBe("object");

  const parsed = agentMockingbirdConfigSchema.safeParse(raw);
  expect(parsed.success).toBe(true);
});

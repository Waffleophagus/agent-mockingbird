import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { wafflebotConfigSchema } from "./schema";

test("wafflebot.config.example.json stays aligned with schema", () => {
  const filePath = path.resolve(process.cwd(), "wafflebot.config.example.json");
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;

  const runtime = raw.runtime as Record<string, unknown> | undefined;
  const opencode = runtime?.opencode as Record<string, unknown> | undefined;
  expect(typeof opencode?.childSessionHideAfterDays).toBe("number");
  expect(typeof runtime?.configPolicy).toBe("object");

  const parsed = wafflebotConfigSchema.safeParse(raw);
  expect(parsed.success).toBe(true);
});

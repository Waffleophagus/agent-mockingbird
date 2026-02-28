import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { parseConfig } from "./store";
import { ConfigApplyError } from "./types";

test("parseConfig reports a clear error when WAFFLEBOT_CONFIG_PATH points to OpenCode config.json", () => {
  expect(() =>
    parseConfig({
      $schema: "https://opencode.ai/config.json",
      model: "anthropic/claude-opus-4-5",
    }),
  ).toThrowError(
    new ConfigApplyError(
      "schema",
      "Config file appears to be OpenCode config.json, not wafflebot config. Set WAFFLEBOT_CONFIG_PATH to a wafflebot config file (default: ./data/wafflebot.config.json).",
    ),
  );
});

test("parseConfig does not use WAFFLEBOT_OPENCODE_* env vars as runtime fallbacks", () => {
  const previousModelId = process.env.WAFFLEBOT_OPENCODE_MODEL_ID;
  process.env.WAFFLEBOT_OPENCODE_MODEL_ID = "env-only-model";
  try {
    const filePath = path.resolve(process.cwd(), "wafflebot.config.example.json");
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as {
      runtime?: { opencode?: Record<string, unknown> };
    };
    if (!raw.runtime?.opencode) {
      throw new Error("Test fixture missing runtime.opencode");
    }
    delete raw.runtime.opencode.modelId;
    expect(() => parseConfig(raw)).toThrowError(ConfigApplyError);
  } finally {
    if (previousModelId === undefined) {
      delete process.env.WAFFLEBOT_OPENCODE_MODEL_ID;
    } else {
      process.env.WAFFLEBOT_OPENCODE_MODEL_ID = previousModelId;
    }
  }
});

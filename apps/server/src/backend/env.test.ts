import { expect, test } from "bun:test";

import { env } from "./env";
import { restoreEnv } from "./testEnv";

test("executor mount path env var must start with a slash", () => {
  const previousValue = process.env.AGENT_MOCKINGBIRD_EXECUTOR_UI_MOUNT_PATH;
  process.env.AGENT_MOCKINGBIRD_EXECUTOR_UI_MOUNT_PATH = "executor";

  try {
    expect(() => env.AGENT_MOCKINGBIRD_EXECUTOR_UI_MOUNT_PATH).toThrow(
      "Invalid environment variables",
    );
  } finally {
    if (previousValue === undefined) {
      delete process.env.AGENT_MOCKINGBIRD_EXECUTOR_UI_MOUNT_PATH;
    } else {
      process.env.AGENT_MOCKINGBIRD_EXECUTOR_UI_MOUNT_PATH = previousValue;
    }
  }
});

test("agent host env var is trimmed before validation", () => {
  const previousValue = process.env.AGENT_MOCKINGBIRD_HOST;
  process.env.AGENT_MOCKINGBIRD_HOST = "  localhost  ";

  try {
    expect(env.AGENT_MOCKINGBIRD_HOST).toBe("localhost");
  } finally {
    restoreEnv("AGENT_MOCKINGBIRD_HOST", previousValue);
  }
});

test("agent host env var rejects whitespace-only values", () => {
  const previousValue = process.env.AGENT_MOCKINGBIRD_HOST;
  process.env.AGENT_MOCKINGBIRD_HOST = "   ";

  try {
    expect(() => env.AGENT_MOCKINGBIRD_HOST).toThrow("Invalid environment variables");
  } finally {
    restoreEnv("AGENT_MOCKINGBIRD_HOST", previousValue);
  }
});

test("executor healthcheck path env var must start with a slash", () => {
  const previousValue =
    process.env.AGENT_MOCKINGBIRD_EXECUTOR_HEALTHCHECK_PATH;
  process.env.AGENT_MOCKINGBIRD_EXECUTOR_HEALTHCHECK_PATH = "executor";

  try {
    expect(() => env.AGENT_MOCKINGBIRD_EXECUTOR_HEALTHCHECK_PATH).toThrow(
      "Invalid environment variables",
    );
  } finally {
    if (previousValue === undefined) {
      delete process.env.AGENT_MOCKINGBIRD_EXECUTOR_HEALTHCHECK_PATH;
    } else {
      process.env.AGENT_MOCKINGBIRD_EXECUTOR_HEALTHCHECK_PATH = previousValue;
    }
  }
});

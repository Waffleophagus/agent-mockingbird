import { expect, test } from "bun:test";

import { env } from "./env";

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

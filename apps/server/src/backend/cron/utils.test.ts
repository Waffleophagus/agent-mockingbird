import { describe, expect, test } from "bun:test";

import { validateSchedule } from "./utils";

describe("validateSchedule", () => {
  test("accepts a valid cron timezone", () => {
    expect(() =>
      validateSchedule({
        scheduleKind: "cron",
        scheduleExpr: "0 * * * *",
        everyMs: null,
        atIso: null,
        timezone: "America/Chicago",
      }),
    ).not.toThrow();
  });

  test("rejects an invalid cron timezone", () => {
    expect(() =>
      validateSchedule({
        scheduleKind: "cron",
        scheduleExpr: "0 * * * *",
        everyMs: null,
        atIso: null,
        timezone: "Mars/Olympus",
      }),
    ).toThrow("invalid cron timezone: Invalid timezone.");
  });
});

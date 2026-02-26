import { describe, expect, test } from "bun:test";

import { isHeartbeatAck, parseInterval } from "./service";
import { isActiveHours } from "./activeHours";
import { getHeartbeatJobId, syncHeartbeatJob } from "./jobSync";
import type { HeartbeatConfig } from "./types";

describe("parseInterval", () => {
  test("parses minutes", () => {
    expect(parseInterval("30m")).toBe(30 * 60 * 1000);
  });

  test("parses hours", () => {
    expect(parseInterval("1h")).toBe(60 * 60 * 1000);
  });

  test("parses days", () => {
    expect(parseInterval("1d")).toBe(24 * 60 * 60 * 1000);
  });

  test("parses zero minutes", () => {
    expect(parseInterval("0m")).toBe(0);
  });

  test("rejects invalid format", () => {
    expect(() => parseInterval("invalid")).toThrow();
  });

  test("rejects missing unit", () => {
    expect(() => parseInterval("30")).toThrow();
  });
});

describe("isHeartbeatAck", () => {
  test("matches HEARTBEAT_OK at start", () => {
    expect(isHeartbeatAck("HEARTBEAT_OK", 300)).toBe(true);
  });

  test("matches HEARTBEAT_OK at end", () => {
    expect(isHeartbeatAck("All good. HEARTBEAT_OK", 300)).toBe(true);
  });

  test("matches HEARTBEAT_OK with brief status", () => {
    expect(isHeartbeatAck("HEARTBEAT_OK - nothing urgent", 300)).toBe(true);
  });

  test("matches HEARTBEAT_OK in middle", () => {
    expect(isHeartbeatAck("All good HEARTBEAT_OK done", 300)).toBe(true);
  });

  test("rejects if remaining content too long", () => {
    const longContent = "HEARTBEAT_OK " + "x".repeat(500);
    expect(isHeartbeatAck(longContent, 300)).toBe(false);
  });

  test("rejects if no HEARTBEAT_OK", () => {
    expect(isHeartbeatAck("Something needs attention!", 300)).toBe(false);
  });

  test("rejects partial match", () => {
    expect(isHeartbeatAck("HEARTBEAT_OKAY", 300)).toBe(false);
  });

  test("accepts exactly at limit", () => {
    const content = "HEARTBEAT_OK " + "x".repeat(300);
    expect(isHeartbeatAck(content, 300)).toBe(true);
  });
});

describe("isActiveHours", () => {
  test("returns true if no active hours config", () => {
    const config: HeartbeatConfig = {
      enabled: true,
      interval: "30m",
      ackMaxChars: 300,
    };
    expect(isActiveHours(config)).toBe(true);
  });

  test("returns true for always-on config (00:00-23:59)", () => {
    const config: HeartbeatConfig = {
      enabled: true,
      interval: "30m",
      ackMaxChars: 300,
      activeHours: {
        start: "00:00",
        end: "23:59",
        timezone: "UTC",
      },
    };
    expect(isActiveHours(config)).toBe(true);
  });
});

describe("getHeartbeatJobId", () => {
  test("generates consistent job ID for agent", () => {
    expect(getHeartbeatJobId("my-agent")).toBe("heartbeat-my-agent");
  });

  test("handles agent IDs with special characters", () => {
    expect(getHeartbeatJobId("my_agent-123")).toBe("heartbeat-my_agent-123");
  });
});

describe("syncHeartbeatJob", () => {
  test("deletes existing heartbeat job for zero-length hour interval", async () => {
    const calls: string[] = [];
    const cronService = {
      getJob: async () => ({ id: "heartbeat-agent-1" }),
      deleteJob: async () => {
        calls.push("delete");
      },
      updateJob: async () => {
        calls.push("update");
      },
      createJob: async () => {
        calls.push("create");
      },
    };

    await syncHeartbeatJob(
      cronService as unknown as Parameters<typeof syncHeartbeatJob>[0],
      "agent-1",
      {
        enabled: true,
        interval: "0h",
        ackMaxChars: 300,
      },
    );

    expect(calls).toEqual(["delete"]);
  });

  test("deletes existing heartbeat job for zero-length day interval", async () => {
    const calls: string[] = [];
    const cronService = {
      getJob: async () => ({ id: "heartbeat-agent-1" }),
      deleteJob: async () => {
        calls.push("delete");
      },
      updateJob: async () => {
        calls.push("update");
      },
      createJob: async () => {
        calls.push("create");
      },
    };

    await syncHeartbeatJob(
      cronService as unknown as Parameters<typeof syncHeartbeatJob>[0],
      "agent-1",
      {
        enabled: true,
        interval: "0d",
        ackMaxChars: 300,
      },
    );

    expect(calls).toEqual(["delete"]);
  });
});

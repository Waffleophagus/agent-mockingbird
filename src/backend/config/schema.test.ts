import { describe, expect, test } from "bun:test";

import { agentTypeDefinitionSchema } from "./schema";

describe("heartbeat active hours time validation", () => {
  test("rejects hour values above 23", () => {
    const parsed = agentTypeDefinitionSchema.safeParse({
      id: "agent-1",
      heartbeat: {
        enabled: true,
        interval: "30m",
        ackMaxChars: 300,
        activeHours: {
          start: "29:00",
          end: "22:00",
          timezone: "UTC",
        },
      },
    });
    expect(parsed.success).toBe(false);
  });

  test("accepts valid 24-hour HH:mm values", () => {
    const parsed = agentTypeDefinitionSchema.safeParse({
      id: "agent-1",
      heartbeat: {
        enabled: true,
        interval: "30m",
        ackMaxChars: 300,
        activeHours: {
          start: "23:59",
          end: "00:00",
          timezone: "UTC",
        },
      },
    });
    expect(parsed.success).toBe(true);
  });

  test("rejects invalid IANA timezone values", () => {
    const parsed = agentTypeDefinitionSchema.safeParse({
      id: "agent-1",
      heartbeat: {
        enabled: true,
        interval: "30m",
        ackMaxChars: 300,
        activeHours: {
          start: "08:00",
          end: "22:00",
          timezone: "Mars/Olympus",
        },
      },
    });
    expect(parsed.success).toBe(false);
  });
});

import { expect, test } from "bun:test";

import { agentTypeDefinitionSchema } from "./schema";

test("agent type schema rejects legacy heartbeat config blocks", () => {
  const parsed = agentTypeDefinitionSchema.safeParse({
    id: "agent-1",
    heartbeat: {
      enabled: true,
      interval: "30m",
      ackMaxChars: 300,
    },
  });
  expect(parsed.success).toBe(false);
});

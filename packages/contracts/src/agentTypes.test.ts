import { expect, test } from "bun:test";

import { normalizeAgentTypeDraft } from "./agentTypes";

test("normalizeAgentTypeDraft preserves valid queueMode", () => {
  const normalized = normalizeAgentTypeDraft({
    id: "  worker  ",
    mode: "subagent",
    hidden: false,
    disable: false,
    options: {},
    queueMode: "followup",
  });

  expect(normalized.id).toBe("worker");
  expect(normalized.queueMode).toBe("followup");
});

test("normalizeAgentTypeDraft drops invalid queueMode", () => {
  const normalized = normalizeAgentTypeDraft({
    id: "worker",
    mode: "subagent",
    hidden: false,
    disable: false,
    options: {},
    queueMode: "invalid" as "collect",
  });

  expect(normalized.queueMode).toBeUndefined();
});

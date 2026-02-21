import { expect, test } from "bun:test";

import { resolveModelRefForValidation } from "./semantic";

function buildModelMap() {
  return new Map<string, Set<string>>([
    ["chutes", new Set(["zai-org/GLM-4.7-Flash", "openai/gpt-oss-20b"])],
    ["anthropic", new Set(["claude-sonnet-4-5"])],
  ]);
}

test("resolveModelRefForValidation keeps slash model IDs on default provider when exact model exists", () => {
  const resolved = resolveModelRefForValidation("zai-org/GLM-4.7-Flash", "chutes", buildModelMap());
  expect(resolved).toEqual({
    providerId: "chutes",
    modelId: "zai-org/GLM-4.7-Flash",
  });
});

test("resolveModelRefForValidation accepts qualified provider/model references", () => {
  const resolved = resolveModelRefForValidation("anthropic/claude-sonnet-4-5", "chutes", buildModelMap());
  expect(resolved).toEqual({
    providerId: "anthropic",
    modelId: "claude-sonnet-4-5",
  });
});

test("resolveModelRefForValidation falls back to default provider when provider prefix is unknown", () => {
  const resolved = resolveModelRefForValidation("custom/my-model", "chutes", buildModelMap());
  expect(resolved).toEqual({
    providerId: "chutes",
    modelId: "custom/my-model",
  });
});

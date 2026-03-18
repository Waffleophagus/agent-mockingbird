import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type * as RepositoryModuleType from "./repository";

const testRoot = mkdtempSync(path.join(tmpdir(), "agent-mockingbird-usage-db-test-"));
const testDbPath = path.join(testRoot, "agent-mockingbird.usage-dashboard.test.db");
const testConfigPath = path.join(testRoot, "agent-mockingbird.usage-dashboard.config.json");
const testWorkspacePath = path.join(testRoot, "workspace");

process.env.NODE_ENV = "test";
process.env.AGENT_MOCKINGBIRD_DB_PATH = testDbPath;
process.env.AGENT_MOCKINGBIRD_CONFIG_PATH = testConfigPath;
process.env.AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR = testWorkspacePath;
process.env.AGENT_MOCKINGBIRD_MEMORY_EMBED_PROVIDER = "none";

type RepositoryModule = typeof RepositoryModuleType;

let repository: RepositoryModule;

beforeAll(async () => {
  await import("./migrate");
  repository = await import("./repository");
});

beforeEach(() => {
  repository.resetDatabaseToDefaults();
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe("usage dashboard repository", () => {
  test("groups attributed usage by provider and model for the selected window", () => {
    const now = Date.now();
    const session = repository.createSession({
      title: "Usage Session",
      model: "anthropic/claude-sonnet-4.5",
    });

    repository.recordUsageDelta({
      sessionId: session.id,
      requestCountDelta: 1,
      inputTokensDelta: 120,
      outputTokensDelta: 80,
      estimatedCostUsdDelta: 0.42,
      source: "runtime",
      createdAt: now - 2 * 60 * 60 * 1000,
    });
    repository.recordUsageDelta({
      requestCountDelta: 1,
      inputTokensDelta: 40,
      outputTokensDelta: 10,
      estimatedCostUsdDelta: 0.08,
      source: "system",
      createdAt: now - 60 * 60 * 1000,
    });
    repository.recordUsageDelta({
      providerId: "openai",
      modelId: "gpt-5.4",
      requestCountDelta: 1,
      inputTokensDelta: 500,
      outputTokensDelta: 400,
      estimatedCostUsdDelta: 1.5,
      source: "runtime",
      createdAt: now - 10 * 24 * 60 * 60 * 1000,
    });

    const daily = repository.getUsageDashboardSnapshot("24h");
    expect(daily.totals.requestCount).toBe(2);
    expect(daily.totals.totalTokens).toBe(250);
    expect(daily.unattributedTotals.totalTokens).toBe(50);
    expect(daily.providers).toHaveLength(1);
    expect(daily.providers[0]).toMatchObject({
      providerId: "anthropic",
      totalTokens: 200,
    });
    expect(daily.models).toHaveLength(1);
    expect(daily.models[0]).toMatchObject({
      providerId: "anthropic",
      modelId: "claude-sonnet-4.5",
      totalTokens: 200,
    });

    const monthly = repository.getUsageDashboardSnapshot("30d");
    expect(monthly.totals.requestCount).toBe(3);
    expect(monthly.providers.map(row => row.providerId)).toEqual(["openai", "anthropic"]);
    expect(monthly.models.map(row => `${row.providerId}/${row.modelId}`)).toEqual([
      "openai/gpt-5.4",
      "anthropic/claude-sonnet-4.5",
    ]);
  });
});

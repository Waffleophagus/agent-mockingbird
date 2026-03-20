import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { createUsageRoutes as CreateUsageRoutesType } from "./usageRoutes";
import type * as RepositoryModuleType from "../../db/repository";

const testRoot = mkdtempSync(path.join(tmpdir(), "agent-mockingbird-usage-routes-test-"));
const testDbPath = path.join(testRoot, "agent-mockingbird.usage-routes.test.db");
const testConfigPath = path.join(testRoot, "agent-mockingbird.usage-routes.config.json");
const testWorkspacePath = path.join(testRoot, "workspace");

process.env.NODE_ENV = "test";
process.env.AGENT_MOCKINGBIRD_DB_PATH = testDbPath;
process.env.AGENT_MOCKINGBIRD_CONFIG_PATH = testConfigPath;
process.env.AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR = testWorkspacePath;
process.env.AGENT_MOCKINGBIRD_MEMORY_EMBED_PROVIDER = "none";

type CreateUsageRoutesFn = typeof CreateUsageRoutesType;
type RepositoryModule = typeof RepositoryModuleType;

let createUsageRoutes: CreateUsageRoutesFn;
let repository: RepositoryModule;

beforeAll(async () => {
  await import("../../db/migrate");
  ({ createUsageRoutes } = await import("./usageRoutes"));
  repository = await import("../../db/repository");
});

beforeEach(() => {
  repository.resetDatabaseToDefaults();
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe("usage routes", () => {
  test("GET /api/usage/dashboard returns grouped range-filtered usage data", async () => {
    const session = repository.createSession({
      title: "Usage Route Session",
      model: "anthropic/claude-sonnet-4.5",
    });
    const createdAt = Date.now();
    repository.recordUsageDelta({
      sessionId: session.id,
      requestCountDelta: 1,
      inputTokensDelta: 12,
      outputTokensDelta: 34,
      estimatedCostUsdDelta: 0.1234,
      source: "runtime",
      createdAt,
    });

    const routes = createUsageRoutes();
    const handler = routes["/api/usage/dashboard"]?.GET;
    expect(handler).toBeDefined();

    const response = await handler!(new Request(`http://localhost/api/usage/dashboard?startAt=${createdAt - 1}&endAtExclusive=${createdAt + 1}`));
    expect(response.status).toBe(200);

    const payload = await response.json() as {
      rangeStartAt: string | null;
      rangeEndAtExclusive: string | null;
      totals: { totalTokens: number };
      providers: Array<{ providerId: string }>;
      models: Array<{ providerId: string; modelId: string }>;
      forwardOnlyBreakdown: boolean;
    };

    expect(payload.rangeStartAt).not.toBeNull();
    expect(payload.rangeEndAtExclusive).not.toBeNull();
    expect(payload.totals.totalTokens).toBe(46);
    expect(payload.providers).toHaveLength(1);
    expect(payload.providers[0]).toMatchObject({ providerId: "anthropic" });
    expect(payload.models).toHaveLength(1);
    expect(payload.models[0]).toMatchObject({ providerId: "anthropic", modelId: "claude-sonnet-4.5" });
    expect(payload.forwardOnlyBreakdown).toBe(true);
  });

  test("GET /usage returns standalone usage html", async () => {
    const routes = createUsageRoutes();
    const handler = routes["/usage"]?.GET;
    expect(handler).toBeDefined();

    const response = await handler!();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");

    const html = await response.text();
    expect(html).toContain("<title>Usage</title>");
    expect(html).toContain("/api/usage/dashboard");
    expect(html).toContain("Back to app");
    expect(html).toContain("window.history.back()");
    expect(html).toContain("window.location.origin");
    expect(html).toContain("All time");
    expect(html).toContain("Apply range");
    expect(html).toContain("Month to date");
    expect(html).toContain("usage-start-date");
    expect(html).toContain("usage-end-date");
  });
});

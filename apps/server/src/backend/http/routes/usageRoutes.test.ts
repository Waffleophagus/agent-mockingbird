import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { createUsageRoutes as CreateUsageRoutesType } from "./usageRoutes";
import type * as ClientModuleType from "../../db/client";
import type * as RepositoryModuleType from "../../db/repository";

const originalNodeEnv = process.env.NODE_ENV;
const originalDbPath = process.env.AGENT_MOCKINGBIRD_DB_PATH;
const originalConfigPath = process.env.AGENT_MOCKINGBIRD_CONFIG_PATH;
const originalWorkspaceDir = process.env.AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR;
const originalEmbedProvider = process.env.AGENT_MOCKINGBIRD_MEMORY_EMBED_PROVIDER;

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

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
type ClientModule = typeof ClientModuleType;
type RepositoryModule = typeof RepositoryModuleType;

let createUsageRoutes: CreateUsageRoutesFn;
let client: ClientModule;
let repository: RepositoryModule;

beforeAll(async () => {
  await import("../../db/migrate");
  ({ createUsageRoutes } = await import("./usageRoutes"));
  client = await import("../../db/client");
  repository = await import("../../db/repository");
});

beforeEach(() => {
  repository.resetDatabaseToDefaults();
});

afterAll(() => {
  client.sqlite.close(false);
  restoreEnv("NODE_ENV", originalNodeEnv);
  restoreEnv("AGENT_MOCKINGBIRD_DB_PATH", originalDbPath);
  restoreEnv("AGENT_MOCKINGBIRD_CONFIG_PATH", originalConfigPath);
  restoreEnv("AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR", originalWorkspaceDir);
  restoreEnv("AGENT_MOCKINGBIRD_MEMORY_EMBED_PROVIDER", originalEmbedProvider);
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

  test("GET /api/usage/dashboard returns 400 for invalid timestamp parameters", async () => {
    const routes = createUsageRoutes();
    const handler = routes["/api/usage/dashboard"]?.GET;
    expect(handler).toBeDefined();

    const startResponse = await handler!(
      new Request("http://localhost/api/usage/dashboard?startAt=abc"),
    );
    expect(startResponse.status).toBe(400);
    expect(await startResponse.json()).toEqual({
      error: "startAt must be a non-negative integer timestamp",
    });

    const endResponse = await handler!(
      new Request("http://localhost/api/usage/dashboard?endAtExclusive=-1"),
    );
    expect(endResponse.status).toBe(400);
    expect(await endResponse.json()).toEqual({
      error: "endAtExclusive must be a non-negative integer timestamp",
    });
  });

  test("GET /api/usage/dashboard treats omitted, empty, and whitespace-only timestamp parameters as null", async () => {
    const routes = createUsageRoutes();
    const handler = routes["/api/usage/dashboard"]?.GET;
    expect(handler).toBeDefined();

    const emptyResponse = await handler!(
      new Request("http://localhost/api/usage/dashboard?startAt=&endAtExclusive="),
    );
    expect(emptyResponse.status).toBe(200);

    const whitespaceResponse = await handler!(
      new Request("http://localhost/api/usage/dashboard?startAt=%20%20&endAtExclusive=%20%20"),
    );
    expect(whitespaceResponse.status).toBe(200);
  });

  test("GET /usage returns standalone usage html", async () => {
    const routes = createUsageRoutes();
    const handler = routes["/usage"]?.GET;
    expect(handler).toBeDefined();

    const response = await handler!();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");

    const html = await response.text();
    expect(html).toContain("<title>Usage Report</title>");
    expect(html).toContain("/api/usage/dashboard");
    expect(html).toContain("← Back");
    expect(html).toContain("window.location.origin");
    expect(html).toContain("All");
    expect(html).toContain("Month");
    expect(html).toContain("Overview");
    expect(html).toContain("Models");
    expect(html).toContain("Providers");
  });

  test("GET /usage initializes local date ranges and renders rows without innerHTML interpolation", async () => {
    const routes = createUsageRoutes();
    const handler = routes["/usage"]?.GET;
    expect(handler).toBeDefined();

    const response = await handler!();
    const html = await response.text();

    expect(html).toContain("currentStart = toDateInputValue(startOfMonth);");
    expect(html).toContain("currentEnd = toDateInputValue(today);");
    expect(html).toContain("parseDateInputValue");
    expect(html).toContain("document.createElement(\"tr\")");
    expect(html).not.toContain(".innerHTML = data.models");
    expect(html).not.toContain(".innerHTML = data.providers");
    expect(html).not.toContain("new Date(e.target.value)");
  });
});

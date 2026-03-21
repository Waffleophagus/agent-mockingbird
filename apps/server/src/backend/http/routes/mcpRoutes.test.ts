import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { getConfigSnapshot } from "@/backend/config/store";

import { persistMcpServers } from "./mcpRoutes";
import { readManagedOpencodeConfig } from "../../opencode/managedConfig";

const testRoot = mkdtempSync(
  path.join(tmpdir(), "agent-mockingbird-mcp-routes-test-"),
);
const testDbPath = path.join(testRoot, "agent-mockingbird.mcp-routes.test.db");
const testConfigPath = path.join(
  testRoot,
  "agent-mockingbird.mcp-routes.config.json",
);
const testWorkspacePath = path.join(testRoot, "workspace");
const testWorkspaceConfigPath = path.join(testWorkspacePath, "config.json");
const testManagedConfigDir = path.join(
  testRoot,
  "opencode-config",
  createHash("sha256")
    .update(path.resolve(testWorkspacePath))
    .digest("hex")
    .slice(0, 16),
);
const testManagedConfigPath = path.join(testManagedConfigDir, "opencode.jsonc");

process.env.NODE_ENV = "test";
process.env.AGENT_MOCKINGBIRD_DB_PATH = testDbPath;
process.env.AGENT_MOCKINGBIRD_CONFIG_PATH = testConfigPath;
process.env.AGENT_MOCKINGBIRD_MEMORY_WORKSPACE_DIR = testWorkspacePath;
process.env.AGENT_MOCKINGBIRD_MEMORY_EMBED_PROVIDER = "none";

beforeAll(async () => {
  getConfigSnapshot();
});

beforeEach(() => {
  rmSync(testWorkspaceConfigPath, { force: true });
  rmSync(testManagedConfigDir, { recursive: true, force: true });
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe("persistMcpServers", () => {
  test("writes MCP config to managed OpenCode config without creating workspace config.json", async () => {
    await persistMcpServers([
      {
        id: "github",
        type: "remote",
        enabled: true,
        url: "https://api.github.com/mcp",
        headers: {
          Authorization: "Bearer token",
        },
        oauth: "auto",
      },
    ]);

    expect(existsSync(testWorkspaceConfigPath)).toBe(false);
    expect(existsSync(testManagedConfigPath)).toBe(true);

    const managedConfig = readManagedOpencodeConfig(
      getConfigSnapshot().config,
    ) as {
      mcp?: Record<
        string,
        {
          type?: string;
          url?: string;
          enabled?: boolean;
          headers?: Record<string, string>;
        }
      >;
    };

    expect(managedConfig.mcp?.github).toEqual({
      type: "remote",
      enabled: true,
      url: "https://api.github.com/mcp",
      headers: {
        Authorization: "Bearer token",
      },
    });
    expect(readFileSync(testManagedConfigPath, "utf8")).not.toContain(
      '"default_agent"',
    );
    expect(readFileSync(testManagedConfigPath, "utf8")).not.toContain(
      '"agent-mockingbird"',
    );
  });
});

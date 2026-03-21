import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { readConfiguredMcpServersFromWorkspaceConfig } from "./service";
import type { AgentMockingbirdConfig } from "../config/schema";

const testRoot = mkdtempSync(
  path.join(tmpdir(), "agent-mockingbird-mcp-service-test-"),
);
const workspaceDir = path.join(testRoot, "workspace");
const managedConfigDir = path.join(testRoot, "opencode-config");
const managedConfigPath = path.join(managedConfigDir, "opencode.jsonc");
const previousOpencodeConfigDir = process.env.OPENCODE_CONFIG_DIR;

process.env.OPENCODE_CONFIG_DIR = managedConfigDir;
mkdirSync(managedConfigDir, { recursive: true });

const config = {
  workspace: {
    pinnedDirectory: workspaceDir,
  },
} as AgentMockingbirdConfig;

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
  if (typeof previousOpencodeConfigDir === "string") {
    process.env.OPENCODE_CONFIG_DIR = previousOpencodeConfigDir;
  } else {
    delete process.env.OPENCODE_CONFIG_DIR;
  }
});

describe("readConfiguredMcpServersFromWorkspaceConfig", () => {
  test("returns an empty list when the workspace config file is missing", () => {
    expect(readConfiguredMcpServersFromWorkspaceConfig(config)).toEqual([]);
  });

  test("throws when the workspace config file contains invalid JSON", () => {
    writeFileSync(managedConfigPath, "{ invalid json", "utf8");

    expect(() => readConfiguredMcpServersFromWorkspaceConfig(config)).toThrow(
      /Failed to read or parse workspace MCP configuration from opencode\.jsonc/,
    );
  });

  test("throws when the workspace config parses to a non-object", () => {
    writeFileSync(managedConfigPath, "[]", "utf8");

    expect(() => readConfiguredMcpServersFromWorkspaceConfig(config)).toThrow(
      /Workspace MCP configuration must parse to a JSON object/,
    );
  });

  test("parses configured MCP servers from a valid workspace config", () => {
    writeFileSync(
      managedConfigPath,
      JSON.stringify(
        {
          mcp: {
            github: {
              type: "remote",
              url: "https://api.github.com/mcp",
              headers: {
                Authorization: "Bearer token",
              },
              oauth: "auto",
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    expect(readConfiguredMcpServersFromWorkspaceConfig(config)).toEqual([
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
  });
});

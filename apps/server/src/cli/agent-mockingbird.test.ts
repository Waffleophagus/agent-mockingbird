import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { testing } from "./agent-mockingbird.mjs";

describe("agent-mockingbird CLI onboarding diagnostics", () => {
  test("builds actionable diagnostics when runtime model discovery is empty", () => {
    const diagnostics = testing.buildEmptyModelDiscoveryDiagnostics({
      workspaceDir: "/var/home/agent-mockingbird/.agent-mockingbird/workspace",
      currentModel: "opencode/big-pickle",
      authAttempts: 1,
      authSuccess: true,
      authRefresh: {
        ok: true,
        message: "opencode.service restarted to refresh provider credentials.",
      },
    });

    expect(diagnostics[0]).toBe("No runtime models were discovered after provider setup.");
    expect(diagnostics).toContain("Current runtime default: opencode/big-pickle");
    expect(diagnostics).toContain("Provider auth attempts: 1 (at least one succeeded)");
    expect(diagnostics).toContain("OpenCode auth refresh: opencode.service restarted to refresh provider credentials.");
    expect(diagnostics).toContain(
      "- curl -sS http://127.0.0.1:3001/api/opencode/models",
    );
  });
});

describe("agent-mockingbird CLI opencode version resolution", () => {
  test("defaults install target to running package version when no tag or version is passed", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mockingbird-cli-target-test-"));
    const binDir = path.join(tempRoot, "package", "bin");
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(
      path.join(tempRoot, "package", "package.json"),
      JSON.stringify({ version: "0.0.1-next.7" }),
      "utf8",
    );

    try {
      const args = testing.applyDefaultInstallTarget(
        {
          command: "install",
          positionals: ["install"],
          yes: false,
          json: false,
          dryRun: false,
          skipLinger: false,
          purgeData: false,
          keepData: false,
          registryUrl: "https://registry.npmjs.org/",
          scope: "waffleophagus",
          tag: "latest",
          version: undefined,
          tagExplicit: false,
          versionExplicit: false,
          rootDir: "/tmp/agent-mockingbird",
          legacyImportFlags: [],
        },
        binDir,
      );

      expect(args.version).toBe("0.0.1-next.7");
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("prefers explicit env version", () => {
    const version = testing.readOpenCodePackageVersion({
      env: { AGENT_MOCKINGBIRD_OPENCODE_VERSION: "1.2.99" },
      argv: ["bun", "/tmp/fake-bin/agent-mockingbird"],
      moduleDir: "/tmp/fake-module",
    });

    expect(version).toBe("1.2.99");
  });

  test("resolves version from unscoped installed package root", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mockingbird-cli-test-"));
    const appDir = path.join(tempRoot, "npm", "lib", "node_modules", "agent-mockingbird");
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(
      path.join(appDir, "opencode.lock.json"),
      JSON.stringify({ packageVersion: "1.2.27" }),
      "utf8",
    );

    try {
      const version = testing.readOpenCodePackageVersion({
        paths: {
          agentMockingbirdAppDirGlobal: appDir,
          agentMockingbirdAppDirLocal: path.join(tempRoot, "missing-local"),
        },
        env: {},
        argv: ["bun", "/tmp/fake-bin/agent-mockingbird"],
        moduleDir: "/tmp/fake-module",
      });

      expect(version).toBe("1.2.27");
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("resolves version from scoped installed package root for compatibility", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mockingbird-cli-scoped-test-"));
    const appDir = path.join(tempRoot, "npm", "lib", "node_modules", "@waffleophagus", "agent-mockingbird");
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(
      path.join(appDir, "opencode.lock.json"),
      JSON.stringify({ packageVersion: "1.2.29" }),
      "utf8",
    );

    try {
      const version = testing.readOpenCodePackageVersion({
        paths: {
          agentMockingbirdAppDirGlobal: path.join(tempRoot, "missing-unscoped-global"),
          agentMockingbirdAppDirLocal: path.join(tempRoot, "missing-unscoped-local"),
          agentMockingbirdAppDirScopedGlobal: appDir,
          agentMockingbirdAppDirScopedLocal: path.join(tempRoot, "missing-scoped-local"),
        },
        env: {},
        argv: ["bun", "/tmp/fake-bin/agent-mockingbird"],
        moduleDir: "/tmp/fake-module",
      });

      expect(version).toBe("1.2.29");
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("resolves version from packaged bin sibling lockfile", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mockingbird-cli-packaged-test-"));
    const appDir = path.join(tempRoot, "package");
    const binDir = path.join(appDir, "bin");
    const cliPath = path.join(binDir, "agent-mockingbird");
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(
      path.join(appDir, "opencode.lock.json"),
      JSON.stringify({ packageVersion: "1.2.28" }),
      "utf8",
    );
    fs.writeFileSync(cliPath, "#!/usr/bin/env node\n", "utf8");

    try {
      const version = testing.readOpenCodePackageVersion({
        env: {},
        argv: ["node", cliPath],
        moduleDir: binDir,
      });

      expect(version).toBe("1.2.28");
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

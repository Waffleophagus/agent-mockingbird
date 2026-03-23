import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { testing } from "./agent-mockingbird.mjs";
import { testing as bootstrapTesting } from "../../../../bin/agent-mockingbird-bootstrap";

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

  test("keeps explicit next tag instead of replacing it with installed version", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mockingbird-cli-next-test-"));
    const binDir = path.join(tempRoot, "package", "bin");
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(
      path.join(tempRoot, "package", "package.json"),
      JSON.stringify({ version: "0.0.1" }),
      "utf8",
    );

    try {
      const args = testing.applyDefaultInstallTarget(
        {
          command: "update",
          positionals: ["update"],
          yes: false,
          json: false,
          dryRun: false,
          skipLinger: false,
          purgeData: false,
          keepData: false,
          registryUrl: "https://registry.npmjs.org/",
          scope: "waffleophagus",
          tag: "next",
          version: undefined,
          tagExplicit: true,
          versionExplicit: false,
          rootDir: "/tmp/agent-mockingbird",
          legacyImportFlags: [],
        },
        binDir,
      );

      expect(args.version).toBeUndefined();
      expect(args.tag).toBe("next");
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

describe("agent-mockingbird CLI packaged executor runtime", () => {
  test("rejects embedded-patched executor when bundled web assets are missing", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mockingbird-executor-missing-assets-"));
    const appDir = path.join(tempRoot, "agent-mockingbird");
    const entrypoint = path.join(
      appDir,
      "vendor",
      "executor",
      "apps",
      "executor",
      "src",
      "cli",
      "main.ts",
    );
    const nodeModulesDir = path.join(appDir, "vendor", "executor", "node_modules");

    fs.mkdirSync(path.dirname(entrypoint), { recursive: true });
    fs.mkdirSync(nodeModulesDir, { recursive: true });
    fs.writeFileSync(entrypoint, 'console.log("executor");\n', "utf8");

    try {
      expect(() =>
        testing.resolveExecutorRuntimeCommand(
          appDir,
          {
            executorBinGlobal: path.join(tempRoot, "missing-executor-global"),
            executorBinLocal: path.join(tempRoot, "missing-executor-local"),
          },
          "/tmp/bun",
        ))
        .toThrow(/embedded executor web assets missing/);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("wires explicit web assets dir into embedded executor systemd unit", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mockingbird-executor-assets-"));
    const appDir = path.join(tempRoot, "agent-mockingbird");
    const entrypoint = path.join(
      appDir,
      "vendor",
      "executor",
      "apps",
      "executor",
      "src",
      "cli",
      "main.ts",
    );
    const nodeModulesDir = path.join(appDir, "vendor", "executor", "node_modules");
    const webIndex = path.join(
      appDir,
      "vendor",
      "executor",
      "apps",
      "web",
      "dist",
      "index.html",
    );

    fs.mkdirSync(path.dirname(entrypoint), { recursive: true });
    fs.mkdirSync(nodeModulesDir, { recursive: true });
    fs.mkdirSync(path.dirname(webIndex), { recursive: true });
    fs.writeFileSync(entrypoint, 'console.log("executor");\n', "utf8");
    fs.writeFileSync(webIndex, "<!doctype html>\n", "utf8");

    try {
      const runtime = testing.resolveExecutorRuntimeCommand(
        appDir,
        {
          executorBinGlobal: path.join(tempRoot, "missing-executor-global"),
          executorBinLocal: path.join(tempRoot, "missing-executor-local"),
        },
        "/tmp/bun",
      );
      expect(runtime).not.toBeNull();
      const units = testing.unitContents(
        {
          rootDir: "/tmp/agent-mockingbird",
          dataDir: "/tmp/agent-mockingbird/data",
          workspaceDir: "/tmp/agent-mockingbird/workspace",
          executorWorkspaceDir: "/tmp/agent-mockingbird/executor-workspace",
          executorDataDir: "/tmp/agent-mockingbird/data/executor",
          executorLocalDataDir: "/tmp/agent-mockingbird/data/executor/control-plane",
          executorRunDir: "/tmp/agent-mockingbird/data/executor/run",
          opencodeConfigDir: "/tmp/agent-mockingbird/data/opencode-config",
        },
        runtime!.execStart,
        runtime!.mode,
        runtime!.webAssetsDir,
        "/tmp/opencode",
        "/tmp/agent-mockingbird",
        "source",
      );

      expect(runtime!.mode).toBe("embedded-patched");
      expect(runtime!.webAssetsDir).toBe(path.dirname(webIndex));
      expect(units.executor).toContain(
        `Environment=EXECUTOR_WEB_ASSETS_DIR=${path.dirname(webIndex)}`,
      );
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

describe("agent-mockingbird CLI delegation", () => {
  test("delegates from a shadowing global install to the managed root CLI", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mockingbird-delegate-"));
    const managedCli = path.join(
      tempRoot,
      "npm",
      "lib",
      "node_modules",
      "agent-mockingbird",
      "bin",
      "agent-mockingbird-managed",
    );
    const globalCli = path.join(tempRoot, "global", "bin", "agent-mockingbird");
    fs.mkdirSync(path.dirname(managedCli), { recursive: true });
    fs.mkdirSync(path.dirname(globalCli), { recursive: true });
    fs.writeFileSync(managedCli, "#!/usr/bin/env bash\n", "utf8");
    fs.writeFileSync(globalCli, "#!/usr/bin/env bash\n", "utf8");

    try {
      const target = testing.resolveManagedCliDelegationTarget({
        argv: ["node", globalCli, "update", "--next", "--root-dir", tempRoot],
        env: {},
        modulePath: globalCli,
      });

      expect(target).toBe(managedCli);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("does not delegate when already running from the managed root CLI", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mockingbird-own-managed-"));
    const managedCli = path.join(
      tempRoot,
      "npm",
      "lib",
      "node_modules",
      "agent-mockingbird",
      "bin",
      "agent-mockingbird-managed",
    );
    const bootstrapCli = path.join(
      tempRoot,
      "npm",
      "lib",
      "node_modules",
      "agent-mockingbird",
      "bin",
      "agent-mockingbird",
    );
    fs.mkdirSync(path.dirname(managedCli), { recursive: true });
    fs.writeFileSync(managedCli, "#!/usr/bin/env bash\n", "utf8");
    fs.writeFileSync(bootstrapCli, "#!/usr/bin/env node\n", "utf8");

    try {
      expect(
        bootstrapTesting.currentPackageOwnsManagedCli(tempRoot, bootstrapCli),
      ).toBe(true);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("bootstrap wrapper resolves the managed CLI under the default install root", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mockingbird-bootstrap-root-"));
    const managedCli = path.join(
      tempRoot,
      ".agent-mockingbird",
      "npm",
      "lib",
      "node_modules",
      "agent-mockingbird",
      "bin",
      "agent-mockingbird-managed",
    );
    fs.mkdirSync(path.dirname(managedCli), { recursive: true });
    fs.writeFileSync(managedCli, "#!/usr/bin/env node\n", "utf8");

    try {
      const resolved = bootstrapTesting.resolveManagedCliPath(
        path.join(tempRoot, ".agent-mockingbird"),
      );
      expect(resolved).toBe(managedCli);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("bootstrap wrapper respects custom root-dir when resolving the managed CLI", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-mockingbird-custom-root-"));
    const customRoot = path.join(tempRoot, "custom-root");
    const managedCli = path.join(
      customRoot,
      "npm",
      "lib",
      "node_modules",
      "agent-mockingbird",
      "bin",
      "agent-mockingbird-managed",
    );
    fs.mkdirSync(path.dirname(managedCli), { recursive: true });
    fs.writeFileSync(managedCli, "#!/usr/bin/env node\n", "utf8");

    try {
      const resolved = testing.resolveManagedCliDelegationTarget({
        argv: ["node", "/tmp/global-agent-mockingbird", "update", "--root-dir", customRoot],
        env: {},
      });
      expect(resolved).toBe(managedCli);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

describe("agent-mockingbird CLI embedded executor verification", () => {
  test("accepts embedded executor HTML without a local stylesheet asset", async () => {
    const responses = new Map([
      [
        "http://127.0.0.1:3001/executor",
        new Response(
          `<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans" />
    <script type="module" crossorigin src="/executor/assets/index-HC_ohraG.js"></script>
    <link rel="modulepreload" crossorigin href="/executor/assets/index-DkZ8Vi7-.js">
  </head>
  <body></body>
</html>`,
          { status: 200, headers: { "content-type": "text/html" } },
        ),
      ],
      [
        "http://127.0.0.1:3001/executor/assets/index-HC_ohraG.js",
        new Response("console.log('ok');", {
          status: 200,
          headers: { "content-type": "text/javascript" },
        }),
      ],
    ]);
    const fetchImpl = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        const response = responses.get(url);
        if (!response) {
          throw new Error(`unexpected fetch: ${url} ${init?.method ?? "GET"}`);
        }
        return response.clone();
      },
      { preconnect: globalThis.fetch.preconnect },
    );

    const result = await testing.verifyEmbeddedExecutorGateway(
      "http://127.0.0.1:3001/executor",
      fetchImpl,
    );

    expect(result.ok).toBe(true);
    expect(result.pageOk).toBe(true);
    expect(result.scriptOk).toBe(true);
    expect(result.cssOk).toBe(true);
    expect(result.cssUrl).toBe("");
    expect(result.scriptUrl).toBe(
      "http://127.0.0.1:3001/executor/assets/index-HC_ohraG.js",
    );
  });

  test("rejects embedded executor HTML that still leaks root assets", async () => {
    const responses = new Map([
      [
        "http://127.0.0.1:3001/executor",
        new Response(
          `<!doctype html>
<html>
  <head>
    <script type="module" crossorigin src="/executor/assets/index-HC_ohraG.js"></script>
    <img src="/assets/leak.png" />
  </head>
  <body></body>
</html>`,
          { status: 200, headers: { "content-type": "text/html" } },
        ),
      ],
      [
        "http://127.0.0.1:3001/executor/assets/index-HC_ohraG.js",
        new Response("console.log('ok');", {
          status: 200,
          headers: { "content-type": "text/javascript" },
        }),
      ],
    ]);
    const fetchImpl = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        const response = responses.get(url);
        if (!response) {
          throw new Error(`unexpected fetch: ${url} ${init?.method ?? "GET"}`);
        }
        return response.clone();
      },
      { preconnect: globalThis.fetch.preconnect },
    );

    const result = await testing.verifyEmbeddedExecutorGateway(
      "http://127.0.0.1:3001/executor",
      fetchImpl,
    );

    expect(result.ok).toBe(false);
    expect(result.rootAssetLeakage).toBe(true);
    expect(result.error).toBe("executor HTML still references root /assets/");
  });
});

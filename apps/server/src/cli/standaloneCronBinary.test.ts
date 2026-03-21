import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

async function waitForJson(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response.json();
      }
      lastError = new Error(`Unexpected status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await Bun.sleep(250);
  }
  throw lastError instanceof Error ? lastError : new Error(`Timed out waiting for ${url}`);
}

async function waitForInstance(baseUrl: string, jobId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/mockingbird/cron/instances?jobId=${encodeURIComponent(jobId)}&limit=1`);
    const payload = (await response.json()) as {
      instances?: Array<{ state?: string; error?: { message?: string } | null }>;
    };
    const instance = payload.instances?.[0];
    if (instance?.state === "completed" || instance?.state === "failed" || instance?.state === "dead") {
      return instance;
    }
    await Bun.sleep(250);
  }
  throw new Error(`Timed out waiting for cron instance ${jobId}`);
}

function buildCandidatePorts(count: number) {
  const start = 20_000;
  const span = 30_000;
  const seed = (Date.now() ^ process.pid) >>> 0;
  const ports: number[] = [];
  const seen = new Set<number>();

  for (let attempt = 0; ports.length < count && attempt < count * 8; attempt += 1) {
    const sidecarPort = start + ((seed + attempt * 7919) % span);
    const apiPort = sidecarPort + 1;
    if (seen.has(sidecarPort) || seen.has(apiPort)) continue;
    seen.add(sidecarPort);
    seen.add(apiPort);
    ports.push(sidecarPort);
  }

  return ports;
}

test(
  "compiled binary runs module-backed background cron jobs without worker ModuleNotFound",
  async () => {
    const repoRoot = path.resolve(import.meta.dir, "../../../..");
    const build = Bun.spawnSync({
      cmd: ["bun", "run", "build:bin"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    expect(build.exitCode).toBe(0);

    const candidatePorts = buildCandidatePorts(24);
    let boundSidecar = false;

    for (const sidecarPort of candidatePorts) {
      const apiPort = sidecarPort + 1;
      const tempRoot = mkdtempSync(path.join(os.tmpdir(), "agent-mockingbird-bin-cron-"));
      const workspaceDir = path.join(tempRoot, "workspace");
      const configPath = path.join(tempRoot, "config.json");
      const dbPath = path.join(tempRoot, "agent-mockingbird.db");
      mkdirSync(path.join(workspaceDir, "cron"), { recursive: true });

      const config = JSON.parse(readFileSync(path.join(repoRoot, "agent-mockingbird.config.example.json"), "utf8")) as {
        workspace: { pinnedDirectory: string };
        runtime: {
          opencode: { baseUrl: string; directory: string };
          memory: { enabled: boolean; workspaceDir: string };
        };
      };
      config.workspace.pinnedDirectory = workspaceDir;
      config.runtime.opencode.baseUrl = `http://127.0.0.1:${sidecarPort}`;
      config.runtime.opencode.directory = workspaceDir;
      config.runtime.memory.enabled = false;
      config.runtime.memory.workspaceDir = workspaceDir;
      writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
      writeFileSync(
        path.join(workspaceDir, "cron", "compiled-background.ts"),
        [
          "export default async function run(ctx) {",
          "  return { status: 'ok', summary: `compiled check ${ctx.payload.symbol}` };",
          "}",
        ].join("\n"),
        "utf8",
      );

      let sessionCount = 0;
      let sidecar: Bun.Server<unknown> | null = null;
      let binary: ReturnType<typeof Bun.spawn> | null = null;
      try {
        sidecar = Bun.serve({
          hostname: "127.0.0.1",
          port: sidecarPort,
          fetch(req) {
            const url = new URL(req.url);
            if (url.pathname === "/config" && req.method === "GET") {
              return Response.json({ data: {} });
            }
            if (url.pathname === "/config" && req.method === "PUT") {
              return Response.json({ data: {} });
            }
            if (url.pathname === "/session" && req.method === "POST") {
              sessionCount += 1;
              return Response.json({
                data: {
                  id: `sess-${sessionCount}`,
                  title: sessionCount === 1 ? "main" : "Cron background",
                },
              });
            }
            return new Response("Not found", { status: 404 });
          },
        });
        boundSidecar = true;

        binary = Bun.spawn({
          cmd: [path.join(repoRoot, "dist", "agent-mockingbird")],
          cwd: repoRoot,
          stdout: "pipe",
          stderr: "pipe",
          env: {
            ...process.env,
            NODE_ENV: "production",
            PORT: String(apiPort),
            AGENT_MOCKINGBIRD_DB_PATH: dbPath,
            AGENT_MOCKINGBIRD_CONFIG_PATH: configPath,
            AGENT_MOCKINGBIRD_MEMORY_ENABLED: "false",
            AGENT_MOCKINGBIRD_MEMORY_EMBED_PROVIDER: "none",
          },
        });

        await waitForJson(`http://127.0.0.1:${apiPort}/api/mockingbird/cron/health`, 15_000);

        const createResponse = await fetch(`http://127.0.0.1:${apiPort}/api/mockingbird/cron/jobs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: "compiled-background-check",
            name: "Compiled Background Check",
            enabled: true,
            scheduleKind: "every",
            everyMs: 60_000,
            runMode: "background",
            conditionModulePath: "cron/compiled-background.ts",
            conditionDescription: "Compiled binary module smoke test",
            payload: { symbol: "AAPL" },
          }),
        });
        expect(createResponse.status).toBe(201);

        const runResponse = await fetch(`http://127.0.0.1:${apiPort}/api/mockingbird/cron/jobs/compiled-background-check/run`, {
          method: "POST",
        });
        expect(runResponse.status).toBe(202);

        const instance = await waitForInstance(`http://127.0.0.1:${apiPort}`, "compiled-background-check", 15_000);
        if (instance?.state !== "completed") {
          throw new Error(`Cron instance failed: ${JSON.stringify(instance)}`);
        }
        expect(instance.error ?? null).toBeNull();
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("EADDRINUSE") && !message.includes("in use")) {
          throw error;
        }
      } finally {
        binary?.kill();
        await binary?.exited;
        sidecar?.stop(true);
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }

    if (!boundSidecar) {
      console.warn("Skipping compiled binary cron smoke test because the environment could not bind a local Bun.serve port.");
      return;
    }

    throw new Error("Unable to bind any candidate port pair for compiled binary cron test");
  },
  60_000,
);

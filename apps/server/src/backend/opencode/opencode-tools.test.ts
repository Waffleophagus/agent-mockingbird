import { afterEach, describe, expect, test } from "bun:test";

// Relative paths from apps/server/src/backend/opencode/ to .opencode/tools/
// Path: opencode/ -> backend/ -> src/ -> server/ -> apps/ -> git/
import agentTypeManager from "../../../../../.opencode/tools/agent_type_manager";
import configManager from "../../../../../.opencode/tools/config_manager";
import cronManager from "../../../../../.opencode/tools/cron_manager";
import memoryGet from "../../../../../.opencode/tools/memory_get";
import memoryRemember from "../../../../../.opencode/tools/memory_remember";
import memorySearch from "../../../../../.opencode/tools/memory_search";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL;
  delete process.env.AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL;
  delete process.env.AGENT_MOCKINGBIRD_CRON_API_BASE_URL;
  delete process.env.AGENT_MOCKINGBIRD_PORT;
  delete process.env.PORT;
});

// ---------------------------------------------------------------------------
// agent_type_manager
// ---------------------------------------------------------------------------

describe("agent_type_manager", () => {
  test("list action calls /api/waffle/agents", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    process.env.AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = init?.method ?? "GET";
      return new Response(JSON.stringify({ agents: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await agentTypeManager.execute({ action: "list" }, {} as never);
    const parsed = JSON.parse(result ?? "{}") as { ok: boolean; agents: unknown[] };

    expect(capturedUrl).toBe("http://127.0.0.1:3001/api/waffle/agents");
    expect(capturedMethod).toBe("GET");
    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.agents)).toBe(true);
  });

  test("list action does NOT call /api/opencode/agents (old path)", async () => {
    let capturedUrl = "";
    process.env.AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ agents: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await agentTypeManager.execute({ action: "list" }, {} as never);

    expect(capturedUrl).not.toContain("/api/opencode/");
    expect(capturedUrl).toContain("/api/waffle/");
  });

  test("validate_patch action calls /api/waffle/agents/validate via POST", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedBody: unknown;
    process.env.AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = init?.method ?? "GET";
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({ valid: true, hash: "abc123" }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await agentTypeManager.execute(
      {
        action: "validate_patch",
        upserts: [{ id: "agent-1", name: "Test Agent" }],
        deletes: ["old-agent"],
      },
      {} as never,
    );
    const parsed = JSON.parse(result ?? "{}") as { ok: boolean; valid: boolean };

    expect(capturedUrl).toBe("http://127.0.0.1:3001/api/waffle/agents/validate");
    expect(capturedMethod).toBe("POST");
    expect(parsed.ok).toBe(true);
    expect(parsed.valid).toBe(true);
    const body = capturedBody as { upserts: unknown[]; deletes: string[] };
    expect(Array.isArray(body.upserts)).toBe(true);
    expect(Array.isArray(body.deletes)).toBe(true);
  });

  test("apply_patch action calls /api/waffle/agents via PATCH", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedBody: unknown;
    process.env.AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = init?.method ?? "GET";
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({ applied: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await agentTypeManager.execute(
      {
        action: "apply_patch",
        upserts: [{ id: "agent-1", name: "Test Agent" }],
        deletes: [],
        expectedHash: "abc123",
      },
      {} as never,
    );
    const parsed = JSON.parse(result ?? "{}") as { ok: boolean; applied: boolean };

    expect(capturedUrl).toBe("http://127.0.0.1:3001/api/waffle/agents");
    expect(capturedMethod).toBe("PATCH");
    expect(parsed.ok).toBe(true);
    expect(parsed.applied).toBe(true);
    const body = capturedBody as { expectedHash: string };
    expect(body.expectedHash).toBe("abc123");
  });

  test("resolves API base URL from AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL with trailing slash stripped", async () => {
    let capturedUrl = "";
    process.env.AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL = "http://127.0.0.1:3001/";

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ agents: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await agentTypeManager.execute({ action: "list" }, {} as never);

    expect(capturedUrl).toBe("http://127.0.0.1:3001/api/waffle/agents");
  });

  test("falls back to port-based default URL when no env var is set", async () => {
    let capturedUrl = "";
    process.env.AGENT_MOCKINGBIRD_PORT = "9999";

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ agents: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await agentTypeManager.execute({ action: "list" }, {} as never);

    expect(capturedUrl).toBe("http://127.0.0.1:9999/api/waffle/agents");
  });

  test("throws an error when the response is not ok", async () => {
    process.env.AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await expect(agentTypeManager.execute({ action: "list" }, {} as never)).rejects.toThrow("Unauthorized");
  });

  test("throws generic error message when error field is missing", async () => {
    process.env.AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ message: "Something went wrong" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await expect(agentTypeManager.execute({ action: "list" }, {} as never)).rejects.toThrow(
      "Request failed (500)",
    );
  });
});

// ---------------------------------------------------------------------------
// config_manager
// ---------------------------------------------------------------------------

describe("config_manager", () => {
  test("get_config calls /api/waffle/runtime/config via GET", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    process.env.AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = init?.method ?? "GET";
      return new Response(JSON.stringify({ config: { version: 2 } }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await configManager.execute({ action: "get_config" }, {} as never);
    const parsed = JSON.parse(result ?? "{}") as { ok: boolean; config: { version: number } };

    expect(capturedUrl).toBe("http://127.0.0.1:3001/api/waffle/runtime/config");
    expect(capturedMethod).toBe("GET");
    expect(parsed.ok).toBe(true);
    expect(parsed.config.version).toBe(2);
  });

  test("get_config does NOT call /api/config (old path)", async () => {
    let capturedUrl = "";
    process.env.AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ config: {} }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await configManager.execute({ action: "get_config" }, {} as never);

    expect(capturedUrl).not.toBe("http://127.0.0.1:3001/api/config");
    expect(capturedUrl).toContain("/api/waffle/");
  });

  test("patch_config calls /api/waffle/runtime/config via PATCH (not POST)", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedBody: unknown;
    process.env.AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = init?.method ?? "GET";
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({ patched: true, hash: "newHash" }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await configManager.execute(
      {
        action: "patch_config",
        patch: { "runtime.opencode.baseUrl": "http://127.0.0.1:9999" },
        expectedHash: "prevHash",
      },
      {} as never,
    );
    const parsed = JSON.parse(result ?? "{}") as { ok: boolean; patched: boolean };

    expect(capturedUrl).toBe("http://127.0.0.1:3001/api/waffle/runtime/config");
    expect(capturedMethod).toBe("PATCH");
    expect(parsed.ok).toBe(true);
    expect(parsed.patched).toBe(true);
  });

  test("patch_config does NOT call old /api/config/patch-safe endpoint", async () => {
    let capturedUrl = "";
    process.env.AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ patched: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await configManager.execute(
      { action: "patch_config", patch: {}, expectedHash: "abc" },
      {} as never,
    );

    expect(capturedUrl).not.toContain("/api/config/patch-safe");
    expect(capturedUrl).toContain("/api/waffle/");
  });

  test("patch_config body does NOT include runSmokeTest field", async () => {
    let capturedBody: unknown;
    process.env.AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({ patched: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await configManager.execute(
      {
        action: "patch_config",
        patch: { key: "value" },
        expectedHash: "hash123",
        runSmokeTest: true,
      },
      {} as never,
    );

    const body = capturedBody as Record<string, unknown>;
    expect(Object.keys(body)).not.toContain("runSmokeTest");
    expect(body.patch).toEqual({ key: "value" });
    expect(body.expectedHash).toBe("hash123");
  });

  test("replace_config calls /api/waffle/runtime/config/replace via POST", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedBody: unknown;
    process.env.AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = init?.method ?? "GET";
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({ replaced: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await configManager.execute(
      {
        action: "replace_config",
        config: { version: 2 },
        expectedHash: "prevHash",
      },
      {} as never,
    );
    const parsed = JSON.parse(result ?? "{}") as { ok: boolean; replaced: boolean };

    expect(capturedUrl).toBe("http://127.0.0.1:3001/api/waffle/runtime/config/replace");
    expect(capturedMethod).toBe("POST");
    expect(parsed.ok).toBe(true);
    expect(parsed.replaced).toBe(true);
    const body = capturedBody as { config: unknown; expectedHash: string };
    expect(body.config).toEqual({ version: 2 });
    expect(body.expectedHash).toBe("prevHash");
  });

  test("replace_config does NOT call old /api/config/replace-safe endpoint", async () => {
    let capturedUrl = "";
    process.env.AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ replaced: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await configManager.execute(
      { action: "replace_config", config: {}, expectedHash: "hash" },
      {} as never,
    );

    expect(capturedUrl).not.toContain("/api/config/replace-safe");
    expect(capturedUrl).toContain("/api/waffle/");
  });

  test("replace_config body does NOT include runSmokeTest field", async () => {
    let capturedBody: unknown;
    process.env.AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({ replaced: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await configManager.execute(
      {
        action: "replace_config",
        config: { version: 2 },
        expectedHash: "hash",
        runSmokeTest: true,
      },
      {} as never,
    );

    const body = capturedBody as Record<string, unknown>;
    expect(Object.keys(body)).not.toContain("runSmokeTest");
    expect(body.config).toEqual({ version: 2 });
  });

  test("resolves API base URL from AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL fallback", async () => {
    let capturedUrl = "";
    // Not setting AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL, only MEMORY alias
    process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL = "http://127.0.0.1:4444";

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ config: {} }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await configManager.execute({ action: "get_config" }, {} as never);

    expect(capturedUrl).toBe("http://127.0.0.1:4444/api/waffle/runtime/config");
  });

  test("resolves API base URL from AGENT_MOCKINGBIRD_CRON_API_BASE_URL as secondary fallback", async () => {
    let capturedUrl = "";
    // Only setting CRON alias (second fallback after MEMORY)
    process.env.AGENT_MOCKINGBIRD_CRON_API_BASE_URL = "http://127.0.0.1:5555";

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ config: {} }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await configManager.execute({ action: "get_config" }, {} as never);

    expect(capturedUrl).toBe("http://127.0.0.1:5555/api/waffle/runtime/config");
  });

  test("throws error when response is not ok", async () => {
    process.env.AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await expect(configManager.execute({ action: "get_config" }, {} as never)).rejects.toThrow("Forbidden");
  });
});

// ---------------------------------------------------------------------------
// cron_manager
// ---------------------------------------------------------------------------

describe("cron_manager", () => {
  test("all actions route through /api/waffle/cron/manage", async () => {
    let capturedUrl = "";
    process.env.AGENT_MOCKINGBIRD_CRON_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ jobs: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await cronManager.execute({ action: "list_jobs" }, {} as never);

    expect(capturedUrl).toBe("http://127.0.0.1:3001/api/waffle/cron/manage");
  });

  test("does NOT call /api/cron/manage (old path)", async () => {
    let capturedUrl = "";
    process.env.AGENT_MOCKINGBIRD_CRON_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ jobs: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await cronManager.execute({ action: "list_jobs" }, {} as never);

    expect(capturedUrl).not.toContain("/api/cron/manage");
    expect(capturedUrl).toContain("/api/waffle/");
  });

  test("list_jobs sends the full args object as POST body", async () => {
    let capturedBody: unknown;
    let capturedMethod = "";
    process.env.AGENT_MOCKINGBIRD_CRON_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedMethod = init?.method ?? "GET";
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({ jobs: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await cronManager.execute({ action: "list_jobs" }, {} as never);
    const parsed = JSON.parse(result ?? "{}") as { ok: boolean };

    expect(capturedMethod).toBe("POST");
    expect((capturedBody as { action: string }).action).toBe("list_jobs");
    expect(parsed.ok).toBe(true);
  });

  test("health action sends correct action in body", async () => {
    let capturedBody: unknown;
    process.env.AGENT_MOCKINGBIRD_CRON_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({ healthy: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await cronManager.execute({ action: "health" }, {} as never);

    expect((capturedBody as { action: string }).action).toBe("health");
  });

  test("get_job action includes jobId in POST body", async () => {
    let capturedBody: unknown;
    process.env.AGENT_MOCKINGBIRD_CRON_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({ job: { id: "job-1" } }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await cronManager.execute({ action: "get_job", jobId: "job-1" }, {} as never);

    const body = capturedBody as { action: string; jobId: string };
    expect(body.action).toBe("get_job");
    expect(body.jobId).toBe("job-1");
  });

  test("resolves API base from AGENT_MOCKINGBIRD_CRON_API_BASE_URL", async () => {
    let capturedUrl = "";
    process.env.AGENT_MOCKINGBIRD_CRON_API_BASE_URL = "http://my-host:8888";

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({}), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await cronManager.execute({ action: "health" }, {} as never);

    expect(capturedUrl).toBe("http://my-host:8888/api/waffle/cron/manage");
  });

  test("falls back to AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL when cron env not set", async () => {
    let capturedUrl = "";
    process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL = "http://127.0.0.1:7777";

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({}), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await cronManager.execute({ action: "health" }, {} as never);

    expect(capturedUrl).toBe("http://127.0.0.1:7777/api/waffle/cron/manage");
  });

  test("throws on error response", async () => {
    process.env.AGENT_MOCKINGBIRD_CRON_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ error: "Job not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await expect(cronManager.execute({ action: "get_job", jobId: "missing" }, {} as never)).rejects.toThrow(
      "Job not found",
    );
  });
});

// ---------------------------------------------------------------------------
// memory_get
// ---------------------------------------------------------------------------

describe("memory_get", () => {
  test("calls /api/waffle/memory/read via POST", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = init?.method ?? "GET";
      return new Response(JSON.stringify({ path: "MEMORY.md", text: "# Memory\nSome content" }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await memoryGet.execute({ path: "MEMORY.md" }, {} as never);
    const parsed = JSON.parse(result ?? "{}") as { ok: boolean; path: string; text: string };

    expect(capturedUrl).toBe("http://127.0.0.1:3001/api/waffle/memory/read");
    expect(capturedMethod).toBe("POST");
    expect(parsed.ok).toBe(true);
    expect(parsed.path).toBe("MEMORY.md");
    expect(parsed.text).toBe("# Memory\nSome content");
  });

  test("does NOT call /api/memory/read (old path)", async () => {
    let capturedUrl = "";
    process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ path: "MEMORY.md", text: "" }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await memoryGet.execute({ path: "MEMORY.md" }, {} as never);

    expect(capturedUrl).not.toContain("/api/memory/read");
    expect(capturedUrl).toContain("/api/waffle/");
  });

  test("sends path, from, and lines in POST body", async () => {
    let capturedBody: unknown;
    process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({ path: "memory/2026-01-01.md", text: "line 5" }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await memoryGet.execute({ path: "memory/2026-01-01.md", from: 5, lines: 10 }, {} as never);

    const body = capturedBody as { path: string; from: number; lines: number };
    expect(body.path).toBe("memory/2026-01-01.md");
    expect(body.from).toBe(5);
    expect(body.lines).toBe(10);
  });

  test("sends path only when from and lines are omitted", async () => {
    let capturedBody: unknown;
    process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({ path: "MEMORY.md", text: "full content" }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await memoryGet.execute({ path: "MEMORY.md" }, {} as never);

    const body = capturedBody as { path: string; from?: number; lines?: number };
    expect(body.path).toBe("MEMORY.md");
    expect(body.from).toBeUndefined();
    expect(body.lines).toBeUndefined();
  });

  test("returns only ok, path, and text fields from payload", async () => {
    process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({ path: "MEMORY.md", text: "content", totalLines: 100, extra: "ignored" }),
        { headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await memoryGet.execute({ path: "MEMORY.md" }, {} as never);
    const parsed = JSON.parse(result ?? "{}") as Record<string, unknown>;

    expect(Object.keys(parsed).sort()).toEqual(["ok", "path", "text"]);
    expect(parsed.ok).toBe(true);
  });

  test("throws on non-ok response", async () => {
    process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ error: "Memory path not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await expect(memoryGet.execute({ path: "nonexistent.md" }, {} as never)).rejects.toThrow(
      "Memory path not found",
    );
  });
});

// ---------------------------------------------------------------------------
// memory_remember
// ---------------------------------------------------------------------------

describe("memory_remember", () => {
  test("calls /api/waffle/memory/remember via POST", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = init?.method ?? "GET";
      return new Response(JSON.stringify({ accepted: true, reason: "accepted" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await memoryRemember.execute({ content: "Test memory entry" }, {} as never);
    const parsed = JSON.parse(result ?? "{}") as { ok: boolean; status: number };

    expect(capturedUrl).toBe("http://127.0.0.1:3001/api/waffle/memory/remember");
    expect(capturedMethod).toBe("POST");
    expect(parsed.ok).toBe(true);
    expect(parsed.status).toBe(201);
  });

  test("does NOT call /api/memory/remember (old path)", async () => {
    let capturedUrl = "";
    process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ accepted: true }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await memoryRemember.execute({ content: "Test" }, {} as never);

    expect(capturedUrl).not.toContain("/api/memory/remember");
    expect(capturedUrl).toContain("/api/waffle/");
  });

  test("defaults source to assistant when not provided", async () => {
    let capturedBody: unknown;
    process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({ accepted: true }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await memoryRemember.execute({ content: "Some memory" }, {} as never);

    const body = capturedBody as { source: string };
    expect(body.source).toBe("assistant");
  });

  test("passes provided source value through", async () => {
    let capturedBody: unknown;
    process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({ accepted: true }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await memoryRemember.execute({ content: "User said this", source: "user" }, {} as never);

    const body = capturedBody as { source: string };
    expect(body.source).toBe("user");
  });

  test("sends all optional fields when provided", async () => {
    let capturedBody: unknown;
    process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({ accepted: true }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await memoryRemember.execute(
      {
        content: "Project uses bun",
        confidence: 0.9,
        source: "assistant",
        entities: ["bun", "project"],
        supersedes: ["old-memory-id"],
        topic: "tooling",
      },
      {} as never,
    );

    const body = capturedBody as {
      content: string;
      confidence: number;
      entities: string[];
      supersedes: string[];
      topic: string;
    };
    expect(body.content).toBe("Project uses bun");
    expect(body.confidence).toBe(0.9);
    expect(body.entities).toEqual(["bun", "project"]);
    expect(body.supersedes).toEqual(["old-memory-id"]);
    expect(body.topic).toBe("tooling");
  });

  test("returns ok: false with status on 422 response without throwing", async () => {
    process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ accepted: false, reason: "duplicate" }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    // memory_remember does not throw on 422 (it's a special case)
    const result = await memoryRemember.execute({ content: "Duplicate memory" }, {} as never);
    const parsed = JSON.parse(result ?? "{}") as { ok: boolean; status: number };

    expect(parsed.ok).toBe(false);
    expect(parsed.status).toBe(422);
  });

  test("throws on 500 response", async () => {
    process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await expect(memoryRemember.execute({ content: "Test" }, {} as never)).rejects.toThrow(
      "Internal server error",
    );
  });

  test("result wraps payload in result field", async () => {
    process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ accepted: true, id: "mem-abc" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await memoryRemember.execute({ content: "Test" }, {} as never);
    const parsed = JSON.parse(result ?? "{}") as { ok: boolean; status: number; result: { accepted: boolean; id: string } };

    expect(parsed.result.accepted).toBe(true);
    expect(parsed.result.id).toBe("mem-abc");
  });
});

// ---------------------------------------------------------------------------
// memory_search
// ---------------------------------------------------------------------------

describe("memory_search", () => {
  test("calls /api/waffle/memory/retrieve via POST", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = init?.method ?? "GET";
      return new Response(JSON.stringify({ results: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await memorySearch.execute({ query: "test query" }, {} as never);
    const parsed = JSON.parse(result ?? "{}") as { ok: boolean; results: unknown[] };

    expect(capturedUrl).toBe("http://127.0.0.1:3001/api/waffle/memory/retrieve");
    expect(capturedMethod).toBe("POST");
    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.results)).toBe(true);
  });

  test("does NOT call /api/memory/retrieve (old path)", async () => {
    let capturedUrl = "";
    process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ results: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await memorySearch.execute({ query: "test" }, {} as never);

    expect(capturedUrl).not.toContain("/api/memory/retrieve");
    expect(capturedUrl).toContain("/api/waffle/");
  });

  test("sends query in POST body", async () => {
    let capturedBody: unknown;
    process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({ results: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await memorySearch.execute({ query: "bun project tooling" }, {} as never);

    const body = capturedBody as { query: string };
    expect(body.query).toBe("bun project tooling");
  });

  test("sends all optional fields when provided", async () => {
    let capturedBody: unknown;
    process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({ results: [], debug: { info: "details" } }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await memorySearch.execute(
      { query: "test", maxResults: 5, minScore: 0.7, debug: true },
      {} as never,
    );
    const parsed = JSON.parse(result ?? "{}") as { debug: unknown };

    const body = capturedBody as { query: string; maxResults: number; minScore: number; debug: boolean };
    expect(body.maxResults).toBe(5);
    expect(body.minScore).toBe(0.7);
    expect(body.debug).toBe(true);
    expect(parsed.debug).toEqual({ info: "details" });
  });

  test("omits debug from result when debug flag is not set", async () => {
    process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ results: [], debug: { info: "details" } }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await memorySearch.execute({ query: "test" }, {} as never);
    const parsed = JSON.parse(result ?? "{}") as { debug?: unknown };

    expect(parsed.debug).toBeUndefined();
  });

  test("returns count equal to number of results", async () => {
    process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          results: [
            { id: "m-1", score: 0.9, snippet: "snippet 1" },
            { id: "m-2", score: 0.8, snippet: "snippet 2" },
          ],
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await memorySearch.execute({ query: "test" }, {} as never);
    const parsed = JSON.parse(result ?? "{}") as { count: number; results: unknown[] };

    expect(parsed.count).toBe(2);
    expect(parsed.results).toHaveLength(2);
  });

  test("returns empty results and count 0 when results field is not an array", async () => {
    process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ results: null }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await memorySearch.execute({ query: "test" }, {} as never);
    const parsed = JSON.parse(result ?? "{}") as { count: number; results: unknown[] };

    expect(parsed.count).toBe(0);
    expect(parsed.results).toEqual([]);
  });

  test("echoes back the query in the result", async () => {
    process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ results: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await memorySearch.execute({ query: "my specific query" }, {} as never);
    const parsed = JSON.parse(result ?? "{}") as { query: string };

    expect(parsed.query).toBe("my specific query");
  });

  test("throws on non-ok response", async () => {
    process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ error: "Search unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await expect(memorySearch.execute({ query: "test" }, {} as never)).rejects.toThrow(
      "Search unavailable",
    );
  });

  test("falls back to PORT env var when no API base URLs are set", async () => {
    let capturedUrl = "";
    process.env.PORT = "6666";

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({ results: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await memorySearch.execute({ query: "test" }, {} as never);

    expect(capturedUrl).toBe("http://127.0.0.1:6666/api/waffle/memory/retrieve");
  });
});
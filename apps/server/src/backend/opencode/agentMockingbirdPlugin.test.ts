import { afterEach, describe, expect, test } from "bun:test";

import { AgentMockingbirdPlugin } from "../../../../../runtime-assets/workspace/.opencode/plugins/agent-mockingbird";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL;
});

describe("AgentMockingbirdPlugin", () => {
  test("registers the expected Agent Mockingbird tool surface", async () => {
    const hooks = await AgentMockingbirdPlugin({} as never);
    expect(Object.keys(hooks.tool ?? {}).sort()).toEqual([
      "agent_type_manager",
      "config_manager",
      "cron_manager",
      "memory_get",
      "memory_remember",
      "memory_search",
    ]);
  });

  test("memory_search calls the memory API and compacts snippets", async () => {
    process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input) => {
      expect(String(input)).toBe("http://127.0.0.1:3001/api/waffle/memory/retrieve");
      return new Response(
        JSON.stringify({
          results: [
            {
              id: "memory-1",
              score: 0.97,
              citation: "memory/2026-03-14.md#L1",
              path: "memory/2026-03-14.md",
              startLine: 1,
              endLine: 4,
              snippet: "### [memory:memory-1]\nmeta: thing\nStored detail",
            },
          ],
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }) as typeof fetch;

    const hooks = await AgentMockingbirdPlugin({} as never);
    const raw = await hooks.tool?.memory_search?.execute(
      {
        query: "stored detail",
      },
      {} as never,
    );
    const payload = JSON.parse(raw ?? "{}") as {
      ok: boolean;
      count: number;
      results: Array<{ id: string; preview: string; snippet: string }>;
    };

    expect(payload.ok).toBe(true);
    expect(payload.count).toBe(1);
    expect(payload.results[0]?.id).toBe("memory-1");
    expect(payload.results[0]?.preview).toBe("Stored detail");
    expect(payload.results[0]?.snippet).toBe("Stored detail");
  });
});

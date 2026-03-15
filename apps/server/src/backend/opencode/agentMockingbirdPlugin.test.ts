import { afterEach, describe, expect, test } from "bun:test";

import { AgentMockingbirdPlugin } from "../../../../../runtime-assets/workspace/.opencode/plugins/agent-mockingbird";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL;
  delete process.env.AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL;
  delete process.env.AGENT_MOCKINGBIRD_CRON_API_BASE_URL;
  delete process.env.AGENT_MOCKINGBIRD_PORT;
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

  test("system transform appends Agent Mockingbird prompt from the runtime API", async () => {
    process.env.AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input) => {
      expect(String(input)).toBe("http://127.0.0.1:3001/api/waffle/runtime/system-prompt");
      return new Response(JSON.stringify({ system: "Config policy:\n- Use config_manager." }), {
        headers: {
          "Content-Type": "application/json",
        },
      });
    }) as typeof fetch;

    const hooks = await AgentMockingbirdPlugin({} as never);
    const output = { system: ["existing"] };
    await hooks["experimental.chat.system.transform"]?.({ sessionID: "sess-1", model: {} as never }, output);
    expect(output.system).toEqual(["existing", "Config policy:\n- Use config_manager."]);
  });

  test("compaction hook appends Agent Mockingbird compaction context from the runtime API", async () => {
    process.env.AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input) => {
      expect(String(input)).toBe("http://127.0.0.1:3001/api/waffle/runtime/compaction-context");
      return new Response(JSON.stringify({ context: ["Agent Mockingbird continuation notes:\n- Mention config changes."] }), {
        headers: {
          "Content-Type": "application/json",
        },
      });
    }) as typeof fetch;

    const hooks = await AgentMockingbirdPlugin({} as never);
    const output = { context: ["existing"] };
    await hooks["experimental.session.compacting"]?.({ sessionID: "sess-1" }, output);
    expect(output.context).toEqual(["existing", "Agent Mockingbird continuation notes:\n- Mention config changes."]);
  });

  test("tool definition hook rewrites assistant-facing tool copy", async () => {
    const hooks = await AgentMockingbirdPlugin({} as never);
    const questionOutput = {
      description: "original question",
      parameters: {
        type: "object",
        properties: {
          questions: {
            type: "array",
            description: "original questions",
          },
        },
      },
    };

    await hooks["tool.definition"]?.({ toolID: "question" }, questionOutput);

    expect(questionOutput.description).toContain("Ask the user a short structured question");
    expect(questionOutput.parameters.properties.questions.description).toContain("structured clarification");

    const taskOutput = {
      description: "original task",
      parameters: {
        type: "object",
        properties: {
          description: { type: "string", description: "old" },
          prompt: { type: "string", description: "old" },
          subagent_type: { type: "string", description: "old" },
        },
      },
    };

    await hooks["tool.definition"]?.({ toolID: "task" }, taskOutput);

    expect(taskOutput.description).toContain("Delegate a bounded subtask");
    expect(taskOutput.parameters.properties.description.description).toBe(
      "A short summary of the delegated subtask.",
    );
    expect(taskOutput.parameters.properties.prompt.description).toBe(
      "Exact instructions for the specialized agent to complete.",
    );
    expect(taskOutput.parameters.properties.subagent_type.description).toBe(
      "The specialist agent type that should handle this delegated subtask.",
    );
  });

  test("shell env exposes Agent Mockingbird API base URLs", async () => {
    process.env.AGENT_MOCKINGBIRD_PORT = "3001";

    const hooks = await AgentMockingbirdPlugin({} as never);
    const output = { env: {} as Record<string, string> };
    await hooks["shell.env"]?.({ cwd: "/tmp" }, output);

    expect(output.env.AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL).toBe("http://127.0.0.1:3001");
    expect(output.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL).toBe("http://127.0.0.1:3001");
    expect(output.env.AGENT_MOCKINGBIRD_CRON_API_BASE_URL).toBe("http://127.0.0.1:3001");
    expect(output.env.AGENT_MOCKINGBIRD_PORT).toBe("3001");
  });
});

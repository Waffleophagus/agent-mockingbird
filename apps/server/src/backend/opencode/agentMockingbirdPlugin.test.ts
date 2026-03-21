import { afterEach, describe, expect, test } from "bun:test";

import { AgentMockingbirdPlugin } from "../../../../../runtime-assets/opencode-config/plugins/agent-mockingbird";

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
      "notify_main_thread",
    ]);
  });

  test("memory_search calls the memory API and compacts snippets", async () => {
    process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input) => {
      expect(String(input)).toBe("http://127.0.0.1:3001/api/mockingbird/memory/retrieve");
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
      const url = String(input);
      if (url === "http://127.0.0.1:3001/api/mockingbird/runtime/system-prompt") {
        return new Response(JSON.stringify({ system: "Config policy:\n- Use config_manager." }), {
          headers: {
            "Content-Type": "application/json",
          },
        });
      }
      if (url === "http://127.0.0.1:3001/api/mockingbird/runtime/session-scope?sessionId=sess-1") {
        return new Response(JSON.stringify({ localSessionId: "session-123", isMain: false, kind: "other", heartbeat: false }), {
          headers: {
            "Content-Type": "application/json",
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const hooks = await AgentMockingbirdPlugin({} as never);
    const output = { system: ["existing"] };
    await hooks["experimental.chat.system.transform"]?.({ sessionID: "sess-1", model: {} as never }, output);
    expect(output.system).toEqual(["existing", "Config policy:\n- Use config_manager."]);
  });

  test("system transform appends main-thread guidance for the rooted conversation", async () => {
    process.env.AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url === "http://127.0.0.1:3001/api/mockingbird/runtime/system-prompt") {
        return new Response(JSON.stringify({ system: "Config policy:\n- Use config_manager." }), {
          headers: {
            "Content-Type": "application/json",
          },
        });
      }
      if (url === "http://127.0.0.1:3001/api/mockingbird/runtime/session-scope?sessionId=sess-main") {
        return new Response(JSON.stringify({ localSessionId: "main", isMain: true, kind: "main", heartbeat: false }), {
          headers: {
            "Content-Type": "application/json",
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const hooks = await AgentMockingbirdPlugin({} as never);
    const output = { system: ["existing"] };
    await hooks["experimental.chat.system.transform"]?.({ sessionID: "sess-main", model: {} as never }, output);
    expect(output.system).toEqual([
      "existing",
      "Config policy:\n- Use config_manager.",
      "Thread policy:\n- This is the main/root conversation thread.\n- Prefer doing work directly in this thread unless delegation materially improves speed or focus.\n- Treat this thread as the primary durable context for the user.",
    ]);
  });

  test("system transform appends cron-thread guidance for cron worker sessions", async () => {
    process.env.AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url === "http://127.0.0.1:3001/api/mockingbird/runtime/system-prompt") {
        return new Response(JSON.stringify({ system: "Config policy:\n- Use config_manager." }), {
          headers: {
            "Content-Type": "application/json",
          },
        });
      }
      if (url === "http://127.0.0.1:3001/api/mockingbird/runtime/session-scope?sessionId=sess-cron") {
        return new Response(
          JSON.stringify({
            localSessionId: "session-cron-1",
            isMain: false,
            kind: "cron",
            heartbeat: false,
            cronJobId: "cron-stock",
            cronJobName: "stock-watch",
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const hooks = await AgentMockingbirdPlugin({} as never);
    const output = { system: ["existing"] };
    await hooks["experimental.chat.system.transform"]?.({ sessionID: "sess-cron", model: {} as never }, output);
    expect(output.system).toEqual([
      "existing",
      "Config policy:\n- Use config_manager.",
      "Thread policy:\n- This thread belongs to cron job stock-watch (cron-stock).\n- Keep work focused on this cron job's ongoing context and prior runs.\n- Do not act like this is the main user-facing conversation thread.\n- If user attention or a decision is needed, call notify_main_thread with a concise prompt for main.",
    ]);
  });

  test("system transform appends heartbeat-thread guidance for heartbeat worker sessions", async () => {
    process.env.AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url === "http://127.0.0.1:3001/api/mockingbird/runtime/system-prompt") {
        return new Response(JSON.stringify({ system: "Config policy:\n- Use config_manager." }), {
          headers: {
            "Content-Type": "application/json",
          },
        });
      }
      if (url === "http://127.0.0.1:3001/api/mockingbird/runtime/session-scope?sessionId=sess-heartbeat") {
        return new Response(
          JSON.stringify({
            localSessionId: "session-heartbeat-1",
            isMain: false,
            kind: "heartbeat",
            heartbeat: true,
            cronJobId: null,
            cronJobName: null,
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const hooks = await AgentMockingbirdPlugin({} as never);
    const output = { system: ["existing"] };
    await hooks["experimental.chat.system.transform"]?.({ sessionID: "sess-heartbeat", model: {} as never }, output);
    expect(output.system).toEqual([
      "existing",
      "Config policy:\n- Use config_manager.",
      "Thread policy:\n- This thread belongs to heartbeat.\n- Treat the main/root conversation as the durable source of user context.\n- The standard tool surface remains available in this thread.\n- Use any available tool when it materially helps the heartbeat do useful work.\n- Do not act like this is the main user-facing conversation thread.\n- If user attention or a decision is needed, call notify_main_thread with a concise prompt for main.",
    ]);
  });

  test("compaction hook prefers a replacement prompt from the runtime API", async () => {
    process.env.AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input) => {
      expect(String(input)).toBe("http://127.0.0.1:3001/api/mockingbird/runtime/compaction-context?sessionId=sess-1");
      return new Response(
        JSON.stringify({
          prompt: "You are generating a compact factual continuation summary.\n## Decisions",
          context: ["Agent Mockingbird continuation notes:\n- Mention config changes."],
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }) as typeof fetch;

    const hooks = await AgentMockingbirdPlugin({} as never);
    const output = { context: ["existing"], prompt: undefined as string | undefined };
    await hooks["experimental.session.compacting"]?.({ sessionID: "sess-1" }, output);
    expect(output.prompt).toContain("compact factual continuation summary");
    expect(output.context).toEqual(["existing"]);
  });

  test("compaction hook falls back to appended context when no replacement prompt is returned", async () => {
    process.env.AGENT_MOCKINGBIRD_CONFIG_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input) => {
      expect(String(input)).toBe("http://127.0.0.1:3001/api/mockingbird/runtime/compaction-context?sessionId=sess-1");
      return new Response(JSON.stringify({ context: ["Agent Mockingbird continuation notes:\n- Mention config changes."] }), {
        headers: {
          "Content-Type": "application/json",
        },
      });
    }) as typeof fetch;

    const hooks = await AgentMockingbirdPlugin({} as never);
    const output = { context: ["existing"], prompt: undefined as string | undefined };
    await hooks["experimental.session.compacting"]?.({ sessionID: "sess-1" }, output);
    expect(output.prompt).toBeUndefined();
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

  test("notify_main_thread sends an escalation request using the calling session", async () => {
    process.env.AGENT_MOCKINGBIRD_CRON_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input, init) => {
      expect(String(input)).toBe("http://127.0.0.1:3001/api/mockingbird/runtime/notify-main-thread");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ "Content-Type": "application/json" });
      expect(init?.body).toBe(
        JSON.stringify({
          sessionId: "sess-cron",
          prompt: "Please ask the user whether to place the trade.",
          severity: "warn",
        }),
      );
      return new Response(JSON.stringify({ delivered: true, cronJobId: "cron-stock", threadSessionId: "session-cron-1" }), {
        headers: {
          "Content-Type": "application/json",
        },
      });
    }) as typeof fetch;

    const hooks = await AgentMockingbirdPlugin({} as never);
    const raw = await hooks.tool?.notify_main_thread?.execute(
      {
        prompt: "Please ask the user whether to place the trade.",
        severity: "warn",
      },
      {
        sessionID: "sess-cron",
      } as never,
    );

    expect(JSON.parse(raw ?? "{}")).toEqual({
      ok: true,
      delivered: true,
      cronJobId: "cron-stock",
      threadSessionId: "session-cron-1",
    });
  });

  test("memory_remember forwards the calling session id", async () => {
    process.env.AGENT_MOCKINGBIRD_MEMORY_API_BASE_URL = "http://127.0.0.1:3001";

    globalThis.fetch = (async (input, init) => {
      expect(String(input)).toBe("http://127.0.0.1:3001/api/mockingbird/memory/remember");
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        content?: string;
        source?: string;
        sessionId?: string;
      };
      expect(body.content).toBe("Remember this.");
      expect(body.source).toBe("assistant");
      expect(body.sessionId).toBe("sess-heartbeat");
      return new Response(JSON.stringify({ accepted: true, reason: "accepted" }), {
        status: 201,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }) as typeof fetch;

    const hooks = await AgentMockingbirdPlugin({} as never);
    const raw = await hooks.tool?.memory_remember?.execute(
      {
        content: "Remember this.",
      },
      { sessionID: "sess-heartbeat" } as never,
    );
    const payload = JSON.parse(raw ?? "{}") as { ok: boolean; result: { accepted: boolean } };

    expect(payload.ok).toBe(true);
    expect(payload.result.accepted).toBe(true);
  });
});

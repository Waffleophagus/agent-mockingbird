import { afterEach, expect, mock, test } from "bun:test";

import agentTypeManager from "./agent_type_manager";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});

test("agent_type_manager validate_patch accepts and forwards queueMode", async () => {
  const fetchMock = mock(async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const requestUrl = typeof _input === "string" ? _input : _input.url;
    expect(requestUrl).toContain("/validate");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(
      JSON.stringify({
        upserts: [
          {
            id: "worker",
            queueMode: "replace",
          },
        ],
        deletes: [],
      }),
    );

    return new Response(JSON.stringify({ ok: true, normalized: { upserts: [], deletes: [] } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  await agentTypeManager.execute(
    {
      action: "validate_patch",
      upserts: [{ id: "worker", queueMode: "replace" }],
      deletes: [],
    },
    {} as never,
  );

  expect(fetchMock).toHaveBeenCalledTimes(1);
});

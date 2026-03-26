import { afterEach, expect, mock, test } from "bun:test";

import configManager from "../tools/config_manager";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});

test("config_manager patch_config uses safe endpoint and forwards runSmokeTest", async () => {
  const fetchMock = mock(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    expect(String(input)).toContain("/api/config/patch-safe");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(
      JSON.stringify({
        patch: { runtime: { queue: { enabled: true } } },
        expectedHash: "abc123",
        runSmokeTest: true,
      }),
    );

    return new Response(JSON.stringify({ hash: "next", config: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  await configManager.execute(
    {
      action: "patch_config",
      patch: { runtime: { queue: { enabled: true } } },
      expectedHash: "abc123",
      runSmokeTest: true,
    },
    {} as never,
  );

  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("config_manager replace_config uses safe endpoint and forwards runSmokeTest", async () => {
  const fetchMock = mock(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    expect(String(input)).toContain("/api/config/replace-safe");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(
      JSON.stringify({
        config: { version: 2 },
        expectedHash: "abc123",
        runSmokeTest: false,
      }),
    );

    return new Response(JSON.stringify({ hash: "next", config: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  await configManager.execute(
    {
      action: "replace_config",
      config: { version: 2 },
      expectedHash: "abc123",
      runSmokeTest: false,
    },
    {} as never,
  );

  expect(fetchMock).toHaveBeenCalledTimes(1);
});

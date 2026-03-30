import { afterEach, beforeEach, expect, test } from "bun:test";

import { proxyOpenCodeSidecar } from "./opencodeProxy";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("proxyOpenCodeSidecar sanitizes stale decoded representation headers", async () => {
  let requestedUrl = "";
  let forwardedHost = "missing";
  globalThis.fetch = ((async (input: RequestInfo | URL, init?: RequestInit) => {
    requestedUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    forwardedHost = new Headers(init?.headers).get("host") ?? "missing";
    return new Response('{"workspace":"ok"}', {
      status: 202,
      statusText: "Accepted",
      headers: {
        "content-encoding": "gzip",
        "content-length": "999",
        "content-type": "application/json; charset=utf-8",
        etag: '"upstream-etag"',
        vary: "accept-encoding, origin",
        "x-sidecar": "open",
      },
    });
  }) as unknown) as typeof fetch;

  const response = await proxyOpenCodeSidecar(
    new Request("http://127.0.0.1:3001/global/config?roots=true", {
      headers: {
        host: "127.0.0.1:3001",
        accept: "application/json",
      },
    }),
    "http://127.0.0.1:4096",
  );

  expect(requestedUrl).toBe("http://127.0.0.1:4096/global/config?roots=true");
  expect(forwardedHost).toBe("missing");
  expect(response.status).toBe(202);
  expect(response.statusText).toBe("Accepted");
  expect(response.headers.get("content-encoding")).toBeNull();
  expect(response.headers.get("content-length")).toBeNull();
  expect(response.headers.get("etag")).toBeNull();
  expect(response.headers.get("vary")).toBe("origin");
  expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
  expect(response.headers.get("x-sidecar")).toBe("open");
  expect(await response.text()).toBe('{"workspace":"ok"}');
});

test("proxyOpenCodeSidecar preserves request method and request body", async () => {
  let forwardedMethod = "";
  let forwardedBody = "";
  globalThis.fetch = ((async (_input: RequestInfo | URL, init?: RequestInit) => {
    forwardedMethod = init?.method ?? "";
    forwardedBody = init?.body ? await new Response(init.body).text() : "";
    return new Response('{"saved":true}', {
      headers: {
        "content-encoding": "gzip",
        "content-type": "application/json",
      },
    });
  }) as unknown) as typeof fetch;

  const response = await proxyOpenCodeSidecar(
    new Request("http://127.0.0.1:3001/session", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ id: "session-1" }),
    }),
    "http://127.0.0.1:4096",
  );

  expect(forwardedMethod).toBe("POST");
  expect(forwardedBody).toBe('{"id":"session-1"}');
  expect(response.headers.get("content-encoding")).toBeNull();
  expect(await response.text()).toBe('{"saved":true}');
});

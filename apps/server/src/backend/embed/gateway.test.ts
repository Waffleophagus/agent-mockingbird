import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { proxyEmbeddedExternalRequest, proxyEmbeddedServiceRequest, testing } from "./gateway";
import { parseConfig } from "../config/store";
import { resolveExampleConfigPath } from "../config/testFixtures";

function loadConfig() {
  return parseConfig(JSON.parse(readFileSync(resolveExampleConfigPath(), "utf8")));
}

function buildConfig(mode: "embedded-patched" | "upstream-fallback" = "embedded-patched") {
  const config = loadConfig();
  config.runtime.embeddedServices.executor.mode = mode;
  return config;
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("gateway strips mount prefixes for upstream fallback assets", () => {
  const config = buildConfig("upstream-fallback");
  const definition = testing.buildEmbeddedServiceDefinition(config, "executor");
  if (!definition) throw new Error("Missing executor definition");

  const target = testing.buildForwardTarget(
    new Request("http://127.0.0.1:3001/executor/assets/app.js?chunk=1"),
    definition,
  );

  expect(target.toString()).toBe("http://127.0.0.1:8788/assets/app.js?chunk=1");
});

test("gateway preserves mount path for embedded patched executor", () => {
  const config = buildConfig("embedded-patched");
  const definition = testing.buildEmbeddedServiceDefinition(config, "executor");
  if (!definition) throw new Error("Missing executor definition");

  const target = testing.buildForwardTarget(
    new Request("http://127.0.0.1:3001/executor/assets/app.js"),
    definition,
  );

  expect(target.toString()).toBe("http://127.0.0.1:8788/executor/assets/app.js");
});

test("gateway retries stripped asset paths when embedded-patched upstream still serves root assets", async () => {
  const config = buildConfig("embedded-patched");
  const requestedUrls: string[] = [];
  globalThis.fetch = ((async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requestedUrls.push(url);
    if (url.endsWith("/executor/assets/app.js")) {
      return new Response("Not found", { status: 404 });
    }
    return new Response("asset-body", {
      headers: {
        "content-type": "application/javascript",
      },
    });
  }) as unknown) as typeof fetch;

  const response = await proxyEmbeddedServiceRequest(
    new Request("http://127.0.0.1:3001/executor/assets/app.js"),
    config,
  );

  expect(requestedUrls).toEqual([
    "http://127.0.0.1:8788/executor/assets/app.js",
    "http://127.0.0.1:8788/assets/app.js",
  ]);
  expect(await response?.text()).toBe("asset-body");
});

test("gateway reuses buffered request bodies for fallback retries", async () => {
  const config = buildConfig("embedded-patched");
  const requestedBodies: string[] = [];
  globalThis.fetch = ((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requestedBodies.push(init?.body ? await new Response(init.body).text() : "");
    if (url.endsWith("/executor/api/submit")) {
      return new Response("Not found", { status: 404 });
    }
    return new Response("ok", {
      headers: {
        "content-type": "text/plain",
      },
    });
  }) as unknown) as typeof fetch;

  const response = await proxyEmbeddedServiceRequest(
    new Request("http://127.0.0.1:3001/executor/api/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ hello: "world" }),
    }),
    config,
  );

  expect(requestedBodies).toEqual([
    '{"hello":"world"}',
    '{"hello":"world"}',
  ]);
  expect(await response?.text()).toBe("ok");
});

test("gateway retries stripped mount root when embedded-patched upstream still serves root html", async () => {
  const config = buildConfig("embedded-patched");
  const requestedUrls: string[] = [];
  globalThis.fetch = ((async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requestedUrls.push(url);
    if (url.endsWith("/executor")) {
      return new Response("Not found", { status: 404 });
    }
    return new Response("<html>ok</html>", {
      headers: {
        "content-type": "text/html",
      },
    });
  }) as unknown) as typeof fetch;

  const response = await proxyEmbeddedServiceRequest(
    new Request("http://127.0.0.1:3001/executor", {
      headers: {
        accept: "text/html",
      },
    }),
    config,
  );

  expect(requestedUrls).toEqual([
    "http://127.0.0.1:8788/executor",
    "http://127.0.0.1:8788/",
  ]);
  expect(await response?.text()).toContain("<html>ok</html>");
});

test("gateway rewrites redirect locations under the mount path", () => {
  const config = buildConfig("upstream-fallback");
  const definition = testing.buildEmbeddedServiceDefinition(config, "executor");
  if (!definition) throw new Error("Missing executor definition");

  const response = new Response(null, {
    status: 302,
    headers: {
      location: "/secrets",
    },
  });

  const headers = testing.copyResponseHeaders(response, definition, new URL("http://127.0.0.1:3001/executor"));
  expect(headers.get("location")).toBe("http://127.0.0.1:3001/executor/secrets");
});

test("gateway strips hop-by-hop headers from embedded service responses", () => {
  const config = buildConfig("embedded-patched");
  const definition = testing.buildEmbeddedServiceDefinition(config, "executor");
  if (!definition) throw new Error("Missing executor definition");

  const response = new Response("ok", {
    headers: {
      connection: "keep-alive",
      "keep-alive": "timeout=5",
      "transfer-encoding": "chunked",
      upgrade: "websocket",
      "content-type": "text/plain",
      "x-custom-header": "present",
    },
  });

  const headers = testing.copyResponseHeaders(response, definition, new URL("http://127.0.0.1:3001/executor"));
  expect(headers.get("connection")).toBeNull();
  expect(headers.get("keep-alive")).toBeNull();
  expect(headers.get("transfer-encoding")).toBeNull();
  expect(headers.get("upgrade")).toBeNull();
  expect(headers.get("content-type")).toBe("text/plain");
  expect(headers.get("x-custom-header")).toBe("present");
});

test("gateway rewrites cookie paths under the mount path", () => {
  expect(testing.rewriteCookiePath("sid=abc; Path=/; HttpOnly", "/executor")).toBe(
    "sid=abc; Path=/executor; HttpOnly",
  );
});

test("gateway rewrites fallback html root-relative references", () => {
  const config = buildConfig("upstream-fallback");
  const definition = testing.buildEmbeddedServiceDefinition(config, "executor");
  if (!definition) throw new Error("Missing executor definition");

  const html = '<script src="/assets/app.js"></script><a href="/v1/status"></a>';
  expect(testing.rewriteRootRelativeContent(html, definition)).toContain('/executor/assets/app.js');
  expect(testing.rewriteRootRelativeContent(html, definition)).toContain('/executor/v1/status');
});

test("gateway rewrites root-relative js references in upstream fallback mode", async () => {
  const config = buildConfig("upstream-fallback");
  globalThis.fetch = ((async () =>
    new Response('fetch("/assets/app.js")', {
      headers: {
        "content-type": "application/javascript",
      },
    })) as unknown) as typeof fetch;

  const response = await proxyEmbeddedServiceRequest(
    new Request("http://127.0.0.1:3001/executor/assets/app.js"),
    config,
  );

  expect(response).not.toBeNull();
  expect(await response?.text()).toBe('fetch("/executor/assets/app.js")');
});

test("gateway strips stale encoding metadata after rewriting upstream text responses", async () => {
  const config = buildConfig("upstream-fallback");
  globalThis.fetch = ((async () =>
    new Response('<script src="/assets/app.js"></script>', {
      headers: {
        "content-encoding": "gzip",
        "content-length": "999",
        "content-type": "text/html",
        etag: 'W/"upstream-etag"',
        vary: "accept-encoding, origin",
      },
    })) as unknown) as typeof fetch;

  const response = await proxyEmbeddedServiceRequest(
    new Request("http://127.0.0.1:3001/executor"),
    config,
  );

  expect(response).not.toBeNull();
  expect(await response?.text()).toContain('/executor/assets/app.js');
  expect(response?.headers.get("content-encoding")).toBeNull();
  expect(response?.headers.get("content-length")).toBeNull();
  expect(response?.headers.get("etag")).toBeNull();
  expect(response?.headers.get("vary")).toBe("origin");
});

test("gateway leaves embedded-patched js assets untouched", async () => {
  const config = buildConfig("embedded-patched");
  globalThis.fetch = ((async () =>
    new Response('fetch("/executor/assets/app.js")', {
      headers: {
        "content-type": "application/javascript",
      },
    })) as unknown) as typeof fetch;

  const response = await proxyEmbeddedServiceRequest(
    new Request("http://127.0.0.1:3001/executor/assets/app.js"),
    config,
  );

  expect(response).not.toBeNull();
  expect(await response?.text()).toBe('fetch("/executor/assets/app.js")');
});

test("gateway does not rewrite json payloads", async () => {
  const config = buildConfig("upstream-fallback");
  globalThis.fetch = ((async () =>
    new Response('{"next":"/v1/local/installation"}', {
      headers: {
        "content-type": "application/json",
      },
    })) as unknown) as typeof fetch;

  const response = await proxyEmbeddedServiceRequest(
    new Request("http://127.0.0.1:3001/executor/v1/local/installation"),
    config,
  );

  expect(response).not.toBeNull();
  expect(await response?.text()).toBe('{"next":"/v1/local/installation"}');
});

test("gateway enforces the external allowlist", async () => {
  const config = buildConfig("embedded-patched");

  const blocked = await proxyEmbeddedExternalRequest(
    new Request("http://127.0.0.1:3001/api/embed/external/executor/npm-registry/-/package/not-executor"),
    config,
  );

  expect(blocked?.status).toBe(403);
});

test("gateway proxies approved external requests", async () => {
  const config = buildConfig("embedded-patched");
  let requestedUrl = "";
  globalThis.fetch = ((async (input: RequestInfo | URL) => {
    requestedUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return new Response('{"latest":"1.2.4"}', {
      headers: {
        "content-type": "application/json",
      },
    });
  }) as unknown) as typeof fetch;

  const response = await proxyEmbeddedExternalRequest(
    new Request("http://127.0.0.1:3001/api/embed/external/executor/npm-registry/-/package/executor/dist-tags"),
    config,
  );

  expect(response?.status).toBe(200);
  expect(requestedUrl).toBe("https://registry.npmjs.org/-/package/executor/dist-tags");
});

test("gateway rejects external targets that normalize outside the allowlist prefix", () => {
  const config = buildConfig("embedded-patched");
  const definition = testing.buildEmbeddedServiceDefinition(config, "executor");
  if (!definition) throw new Error("Missing executor definition");

  const target = testing.buildExternalTarget(
    definition,
    "npm-registry",
    "/-/package/executor/dist-tags/../versions",
  );

  expect(target).toBeNull();
});

test("gateway passes through streaming upstream responses", async () => {
  const config = buildConfig("embedded-patched");
  globalThis.fetch = ((async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("streamed-body"));
          controller.close();
        },
      }),
      {
        headers: {
          "content-type": "text/plain",
        },
      },
    )) as unknown) as typeof fetch;

  const response = await proxyEmbeddedServiceRequest(
    new Request("http://127.0.0.1:3001/executor/logs"),
    config,
  );

  expect(await response?.text()).toBe("streamed-body");
});

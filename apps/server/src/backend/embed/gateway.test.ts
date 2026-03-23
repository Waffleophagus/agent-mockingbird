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

test("gateway rewrites leaked root-relative js/css references even in embedded-patched mode", async () => {
  const config = buildConfig("embedded-patched");
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

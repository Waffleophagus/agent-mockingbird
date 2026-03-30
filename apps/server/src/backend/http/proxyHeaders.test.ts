import { expect, test } from "bun:test";

import { copyPassthroughProxyHeaders, stripDecodedRepresentationHeaders } from "./proxyHeaders";

test("copyPassthroughProxyHeaders preserves content headers and strips hop-by-hop headers", () => {
  const upstreamHeaders = new Headers();
  upstreamHeaders.set("connection", "keep-alive");
  upstreamHeaders.set("keep-alive", "timeout=5");
  upstreamHeaders.set("transfer-encoding", "chunked");
  upstreamHeaders.set("content-type", "application/json");
  upstreamHeaders.set("x-custom-header", "present");
  upstreamHeaders.append("set-cookie", "sid=abc; Path=/; HttpOnly");
  upstreamHeaders.append("set-cookie", "prefs=light; Path=/");

  const copied = copyPassthroughProxyHeaders(new Response('{"ok":true}', { headers: upstreamHeaders }));

  expect(copied.get("connection")).toBeNull();
  expect(copied.get("keep-alive")).toBeNull();
  expect(copied.get("transfer-encoding")).toBeNull();
  expect(copied.get("content-type")).toBe("application/json");
  expect(copied.get("x-custom-header")).toBe("present");
  expect(copied.getSetCookie?.()).toEqual([
    "sid=abc; Path=/; HttpOnly",
    "prefs=light; Path=/",
  ]);
});

test("stripDecodedRepresentationHeaders removes stale decoded representation metadata", () => {
  const headers = new Headers({
    "content-encoding": "gzip",
    "content-length": "999",
    etag: 'W/"etag"',
    vary: "accept-encoding, origin",
  });

  stripDecodedRepresentationHeaders(headers);

  expect(headers.get("content-encoding")).toBeNull();
  expect(headers.get("content-length")).toBeNull();
  expect(headers.get("etag")).toBeNull();
  expect(headers.get("vary")).toBe("origin");
});

test("stripDecodedRepresentationHeaders removes vary when only accept-encoding remains", () => {
  const headers = new Headers({
    vary: "accept-encoding",
  });

  stripDecodedRepresentationHeaders(headers);

  expect(headers.get("vary")).toBeNull();
});

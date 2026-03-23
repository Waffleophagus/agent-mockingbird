import type { AgentMockingbirdConfig } from "../config/schema";

export type EmbeddedServiceId = "executor";
export type EmbeddedServiceMode = "embedded-patched" | "upstream-fallback";
type ForwardedPrefixMode = "preserve" | "strip-known-prefixes";
type RewritePolicy = "none" | "root-relative";

interface EmbeddedExternalAllowlistEntry {
  id: string;
  origin: string;
  pathPrefixes: Array<string>;
}

interface EmbeddedServiceDefinition {
  id: EmbeddedServiceId;
  mode: EmbeddedServiceMode;
  mountPath: string;
  upstreamBaseUrl: string;
  healthcheckPath: string;
  forwardedPrefixMode: ForwardedPrefixMode;
  apiPrefixes: Array<string>;
  assetPrefixes: Array<string>;
  htmlRewrite: RewritePolicy;
  jsCssRewrite: RewritePolicy;
  rewriteCookies: boolean;
  rewriteRedirects: boolean;
  thirdPartyBrowserProxy: {
    enabled: boolean;
    allowlist: Array<EmbeddedExternalAllowlistEntry>;
  };
}

const EXTERNAL_PROXY_PREFIX = "/api/embed/external";
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const SAFE_EXTERNAL_REQUEST_HEADERS = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "cache-control",
  "content-type",
  "if-modified-since",
  "if-none-match",
  "pragma",
  "user-agent",
]);

function normalizeMountPath(pathname: string) {
  if (!pathname || pathname === "/") return "/";
  const withLeadingSlash = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return withLeadingSlash.replace(/\/+$/, "") || "/";
}

function isMountedPath(pathname: string, mountPath: string) {
  const normalizedMountPath = normalizeMountPath(mountPath);
  return pathname === normalizedMountPath || pathname.startsWith(`${normalizedMountPath}/`);
}

function normalizePrefix(prefix: string) {
  if (!prefix) return "/";
  return prefix.startsWith("/") ? prefix : `/${prefix}`;
}

function stripKnownEmbeddedPrefixes(pathname: string, mountPath: string, prefixes: Array<string>) {
  const normalizedMountPath = normalizeMountPath(mountPath);
  const suffix = pathname === normalizedMountPath ? "/" : pathname.slice(normalizedMountPath.length) || "/";
  for (const prefix of prefixes) {
    const normalizedPrefix = normalizePrefix(prefix);
    if (suffix === normalizedPrefix || suffix.startsWith(`${normalizedPrefix}/`)) {
      return suffix;
    }
  }
  return pathname;
}

function withMountPrefix(pathname: string, mountPath: string) {
  const normalizedMountPath = normalizeMountPath(mountPath);
  if (!pathname.startsWith("/")) return pathname;
  if (normalizedMountPath === "/" || pathname === normalizedMountPath || pathname.startsWith(`${normalizedMountPath}/`)) {
    return pathname;
  }
  return `${normalizedMountPath}${pathname === "/" ? "" : pathname}`;
}

function rewriteRootRelativeContent(content: string, definition: EmbeddedServiceDefinition) {
  const prefixes = [...definition.assetPrefixes, ...definition.apiPrefixes]
    .map(normalizePrefix)
    .sort((left, right) => right.length - left.length)
    .map(prefix => prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!prefixes.length) {
    return content;
  }
  const matcher = new RegExp(String.raw`(["'=(:\s])(${prefixes.join("|")})(?=[/?#'"\s<])`, "g");
  return content.replace(matcher, (_match, leading, prefix) => `${leading}${withMountPrefix(prefix, definition.mountPath)}`);
}

function rewriteLocationHeader(location: string, definition: EmbeddedServiceDefinition, requestUrl: URL) {
  if (!definition.rewriteRedirects) {
    return location;
  }
  try {
    if (location.startsWith("/")) {
      return new URL(withMountPrefix(location, definition.mountPath), requestUrl.origin).toString();
    }
    const parsed = new URL(location);
    const upstream = new URL(definition.upstreamBaseUrl);
    if (parsed.origin === upstream.origin) {
      return new URL(withMountPrefix(parsed.pathname, definition.mountPath) + parsed.search + parsed.hash, requestUrl.origin).toString();
    }
    return location;
  } catch {
    return location;
  }
}

function rewriteCookiePath(setCookie: string, mountPath: string) {
  const normalizedMountPath = normalizeMountPath(mountPath);
  if (normalizedMountPath === "/") {
    return setCookie;
  }
  return setCookie.replace(/;\s*Path=(\/[^;]*)/i, (_match, cookiePath) => {
    if (cookiePath === normalizedMountPath || cookiePath.startsWith(`${normalizedMountPath}/`)) {
      return `; Path=${cookiePath}`;
    }
    if (cookiePath === "/") {
      return `; Path=${normalizedMountPath}`;
    }
    return `; Path=${withMountPrefix(cookiePath, normalizedMountPath)}`;
  });
}

function copyResponseHeaders(response: Response, definition: EmbeddedServiceDefinition, requestUrl: URL) {
  const headers = new Headers();
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "location") {
      headers.set(key, rewriteLocationHeader(value, definition, requestUrl));
      return;
    }
    if (key.toLowerCase() === "set-cookie") {
      return;
    }
    headers.append(key, value);
  });

  const setCookies = response.headers.getSetCookie?.() ?? [];
  for (const cookie of setCookies) {
    headers.append("set-cookie", definition.rewriteCookies ? rewriteCookiePath(cookie, definition.mountPath) : cookie);
  }

  return headers;
}

function shouldRewriteTextResponse(response: Response, definition: EmbeddedServiceDefinition) {
  const contentType = response.headers.get("content-type") || "";
  if (definition.htmlRewrite === "root-relative" && contentType.includes("text/html")) {
    return true;
  }
  if (
    definition.jsCssRewrite === "root-relative" &&
    (contentType.includes("javascript") || contentType.includes("text/css") || contentType.includes("application/json"))
  ) {
    return true;
  }
  return false;
}

function buildEmbeddedServiceDefinition(config: AgentMockingbirdConfig, id: EmbeddedServiceId): EmbeddedServiceDefinition | null {
  if (id !== "executor") {
    return null;
  }
  const embeddedExecutor = config.runtime.embeddedServices.executor;
  if (!embeddedExecutor.enabled) {
    return null;
  }
  const mode = embeddedExecutor.mode;
  return {
    id,
    mode,
    mountPath: normalizeMountPath(embeddedExecutor.mountPath),
    upstreamBaseUrl: embeddedExecutor.baseUrl.replace(/\/+$/, ""),
    healthcheckPath: embeddedExecutor.healthcheckPath,
    forwardedPrefixMode: mode === "embedded-patched" ? "preserve" : "strip-known-prefixes",
    apiPrefixes: ["/v1", "/mcp"],
    assetPrefixes: ["/assets"],
    // Executor gets an explicit compatibility rewrite even in embedded-patched mode.
    // If a deployed host is accidentally still serving a root-relative build, we
    // normalize the leaked /assets, /v1, and /mcp references instead of hard-failing.
    htmlRewrite: "root-relative",
    jsCssRewrite: "root-relative",
    rewriteCookies: true,
    rewriteRedirects: true,
    thirdPartyBrowserProxy: {
      enabled: true,
      allowlist: [
        {
          id: "npm-registry",
          origin: "https://registry.npmjs.org",
          pathPrefixes: ["/-/package/executor/dist-tags"],
        },
      ],
    },
  };
}

function buildForwardTarget(req: Request, definition: EmbeddedServiceDefinition) {
  const incoming = new URL(req.url);
  const prefixes = [...definition.assetPrefixes, ...definition.apiPrefixes];
  const forwardedPath =
    definition.forwardedPrefixMode === "strip-known-prefixes"
      ? stripKnownEmbeddedPrefixes(incoming.pathname, definition.mountPath, prefixes)
      : incoming.pathname;
  return new URL(`${forwardedPath}${incoming.search}`, definition.upstreamBaseUrl);
}

function buildForwardHeaders(req: Request, definition: EmbeddedServiceDefinition) {
  const incoming = new URL(req.url);
  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.set("x-forwarded-host", incoming.host);
  headers.set("x-forwarded-proto", incoming.protocol.replace(/:$/, ""));
  headers.set("x-forwarded-prefix", definition.mountPath);
  return headers;
}

function findEmbeddedService(config: AgentMockingbirdConfig, pathname: string) {
  const executor = buildEmbeddedServiceDefinition(config, "executor");
  if (executor && isMountedPath(pathname, executor.mountPath)) {
    return executor;
  }
  return null;
}

function parseExternalProxyRequest(pathname: string) {
  if (!pathname.startsWith(`${EXTERNAL_PROXY_PREFIX}/`)) {
    return null;
  }
  const remainder = pathname.slice(EXTERNAL_PROXY_PREFIX.length + 1);
  const [serviceId, allowlistId, ...pathParts] = remainder.split("/");
  if (!serviceId || !allowlistId) {
    return null;
  }
  return {
    serviceId,
    allowlistId,
    targetPath: `/${pathParts.join("/")}`.replace(/\/+$/, "") || "/",
  };
}

function buildExternalTarget(definition: EmbeddedServiceDefinition, allowlistId: string, targetPath: string) {
  const allowlistEntry = definition.thirdPartyBrowserProxy.allowlist.find(entry => entry.id === allowlistId);
  if (!allowlistEntry) {
    return null;
  }
  if (!allowlistEntry.pathPrefixes.some(prefix => targetPath === prefix || targetPath.startsWith(`${prefix}/`))) {
    return null;
  }
  return new URL(targetPath, allowlistEntry.origin);
}

function filterExternalRequestHeaders(headers: Headers) {
  const filtered = new Headers();
  headers.forEach((value, key) => {
    const normalized = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(normalized) || !SAFE_EXTERNAL_REQUEST_HEADERS.has(normalized)) {
      return;
    }
    filtered.append(key, value);
  });
  return filtered;
}

function filterExternalResponseHeaders(headers: Headers) {
  const filtered = new Headers();
  headers.forEach((value, key) => {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      return;
    }
    filtered.append(key, value);
  });
  return filtered;
}

export async function proxyEmbeddedServiceRequest(req: Request, config: AgentMockingbirdConfig) {
  const pathname = decodeURIComponent(new URL(req.url).pathname);
  const definition = findEmbeddedService(config, pathname);
  if (!definition) {
    return null;
  }

  const upstream = await fetch(buildForwardTarget(req, definition), {
    method: req.method,
    headers: buildForwardHeaders(req, definition),
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
    redirect: "manual",
  });

  const headers = copyResponseHeaders(upstream, definition, new URL(req.url));
  if (!shouldRewriteTextResponse(upstream, definition)) {
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  }

  const content = await upstream.text();
  headers.delete("content-length");
  return new Response(rewriteRootRelativeContent(content, definition), {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export async function proxyEmbeddedExternalRequest(req: Request, config: AgentMockingbirdConfig) {
  const pathname = decodeURIComponent(new URL(req.url).pathname);
  const parsed = parseExternalProxyRequest(pathname);
  if (!parsed) {
    return null;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  const definition = buildEmbeddedServiceDefinition(config, parsed.serviceId as EmbeddedServiceId);
  if (!definition || !definition.thirdPartyBrowserProxy.enabled) {
    return new Response("Not found", { status: 404 });
  }

  const target = buildExternalTarget(definition, parsed.allowlistId, parsed.targetPath);
  if (!target) {
    return new Response("Forbidden", { status: 403 });
  }

  target.search = new URL(req.url).search;
  const upstream = await fetch(target, {
    method: req.method,
    headers: filterExternalRequestHeaders(new Headers(req.headers)),
    redirect: "manual",
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: filterExternalResponseHeaders(new Headers(upstream.headers)),
  });
}

export function getEmbeddedServiceStatus(config: AgentMockingbirdConfig, id: EmbeddedServiceId) {
  return buildEmbeddedServiceDefinition(config, id);
}

export const testing = {
  buildEmbeddedServiceDefinition,
  buildForwardTarget,
  copyResponseHeaders,
  parseExternalProxyRequest,
  rewriteCookiePath,
  rewriteRootRelativeContent,
  stripKnownEmbeddedPrefixes,
};

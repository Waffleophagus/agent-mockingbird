import type { AgentMockingbirdConfig } from "../config/schema";

export type EmbeddedServiceId = "executor";
export type EmbeddedServiceMode = "embedded-patched" | "upstream-fallback";
type ForwardedPrefixMode = "preserve" | "strip-mount-path";
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

function stripMountPath(pathname: string, mountPath: string) {
  const normalizedMountPath = normalizeMountPath(mountPath);
  if (pathname === normalizedMountPath) {
    return "/";
  }
  if (pathname.startsWith(`${normalizedMountPath}/`)) {
    return pathname.slice(normalizedMountPath.length) || "/";
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
    const normalizedKey = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(normalizedKey)) {
      return;
    }
    if (normalizedKey === "location") {
      headers.set(key, rewriteLocationHeader(value, definition, requestUrl));
      return;
    }
    if (normalizedKey === "set-cookie") {
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
    (contentType.includes("javascript") || contentType.includes("text/css"))
  ) {
    return true;
  }
  return false;
}

function stripRewrittenRepresentationHeaders(headers: Headers) {
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.delete("etag");

  const vary = headers.get("vary");
  if (!vary) {
    return;
  }

  const preservedValues = vary
    .split(",")
    .map(value => value.trim())
    .filter(value => value.length > 0 && value.toLowerCase() !== "accept-encoding");
  if (preservedValues.length === 0) {
    headers.delete("vary");
    return;
  }
  headers.set("vary", preservedValues.join(", "));
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
    forwardedPrefixMode: mode === "embedded-patched" ? "preserve" : "strip-mount-path",
    apiPrefixes: ["/v1", "/mcp"],
    assetPrefixes: ["/assets"],
    // Keep HTML compatibility rewriting on for mixed deployments. JS/CSS rewriting
    // stays fallback-only because mutating shipped bundles in embedded-patched mode
    // can corrupt otherwise valid assets.
    htmlRewrite: "root-relative",
    jsCssRewrite: mode === "upstream-fallback" ? "root-relative" : "none",
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

function buildForwardTarget(
  req: Request,
  definition: EmbeddedServiceDefinition,
  forwardedPrefixMode: ForwardedPrefixMode = definition.forwardedPrefixMode,
) {
  const incoming = new URL(req.url);
  const forwardedPath =
    forwardedPrefixMode === "strip-mount-path"
      ? stripMountPath(incoming.pathname, definition.mountPath)
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
  const target = new URL(targetPath, allowlistEntry.origin);
  const normalizedPath = target.pathname.replace(/\/+$/, "") || "/";
  if (target.origin !== new URL(allowlistEntry.origin).origin) {
    return null;
  }
  if (!allowlistEntry.pathPrefixes.some(prefix => normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`))) {
    return null;
  }
  target.pathname = normalizedPath;
  return target;
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
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url).pathname);
  } catch {
    return new Response("Malformed request URL", { status: 400 });
  }
  const definition = findEmbeddedService(config, pathname);
  if (!definition) {
    return null;
  }
  const bufferedBody =
    req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();

  let upstream = await fetch(buildForwardTarget(req, definition), {
    method: req.method,
    headers: buildForwardHeaders(req, definition),
    body: bufferedBody?.slice(0),
    redirect: "manual",
  });

  if (
    upstream.status === 404 &&
    definition.forwardedPrefixMode === "preserve" &&
    isMountedPath(pathname, definition.mountPath)
  ) {
    upstream = await fetch(buildForwardTarget(req, definition, "strip-mount-path"), {
      method: req.method,
      headers: buildForwardHeaders(req, definition),
      body: bufferedBody?.slice(0),
      redirect: "manual",
    });
  }

  const headers = copyResponseHeaders(upstream, definition, new URL(req.url));
  if (!shouldRewriteTextResponse(upstream, definition)) {
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  }

  const content = await upstream.text();
  stripRewrittenRepresentationHeaders(headers);
  return new Response(rewriteRootRelativeContent(content, definition), {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export async function proxyEmbeddedExternalRequest(req: Request, config: AgentMockingbirdConfig) {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url).pathname);
  } catch {
    return null;
  }
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
  buildExternalTarget,
  buildForwardTarget,
  copyResponseHeaders,
  parseExternalProxyRequest,
  rewriteCookiePath,
  rewriteRootRelativeContent,
  stripRewrittenRepresentationHeaders,
  stripMountPath,
};

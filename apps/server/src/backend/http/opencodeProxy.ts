import { copyPassthroughProxyHeaders, stripDecodedRepresentationHeaders } from "./proxyHeaders";

export async function proxyOpenCodeSidecar(req: Request, sidecarBaseUrl: string) {
  const incoming = new URL(req.url);
  const target = new URL(`${incoming.pathname}${incoming.search}`, sidecarBaseUrl);
  const headers = new Headers(req.headers);
  headers.delete("host");

  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
    redirect: "manual",
  });

  const responseHeaders = copyPassthroughProxyHeaders(upstream);
  stripDecodedRepresentationHeaders(responseHeaders);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

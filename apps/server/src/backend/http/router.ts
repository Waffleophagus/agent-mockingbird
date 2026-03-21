interface RouteRequest<TParams extends Record<string, string> = Record<string, string>>
  extends Request {
  params: TParams;
}

type RouteMethod<TParams extends Record<string, string> = Record<string, string>> = {
  bivarianceHack(req: RouteRequest<TParams>): Response | Promise<Response>;
}["bivarianceHack"];

interface RouteHandler {
  GET?: RouteMethod;
  POST?: RouteMethod;
  PUT?: RouteMethod;
  PATCH?: RouteMethod;
  DELETE?: RouteMethod;
  OPTIONS?: RouteMethod;
}

export type RouteEntry = RouteHandler | RouteMethod;

export type RouteTable = Record<string, RouteEntry>;

function matchPattern(pattern: string, pathname: string) {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const patternPart = patternParts[index]!;
    const pathPart = pathParts[index]!;
    if (patternPart.startsWith(":")) {
      try {
        params[patternPart.slice(1)] = decodeURIComponent(pathPart);
      } catch {
        params[patternPart.slice(1)] = pathPart;
      }
      continue;
    }
    if (patternPart !== pathPart) return null;
  }
  return params;
}

export async function dispatchRoute(table: RouteTable, req: Request) {
  const url = new URL(req.url);
  const pathname = url.pathname;
  const method = req.method.toUpperCase() as keyof RouteHandler;
  let matchedPatternWithoutMethod = false;

  for (const [pattern, handlers] of Object.entries(table)) {
    const params = matchPattern(pattern, pathname);
    if (!params) continue;
    const request = Object.assign(req, { params }) as RouteRequest;
    if (typeof handlers === "function") {
      return handlers(request);
    }
    const handler = handlers[method];
    if (!handler) {
      matchedPatternWithoutMethod = true;
      continue;
    }
    return handler(request);
  }

  if (matchedPatternWithoutMethod) {
    return new Response("Method not allowed", { status: 405 });
  }

  return null;
}

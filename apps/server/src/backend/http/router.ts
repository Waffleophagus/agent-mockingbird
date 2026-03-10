export interface RouteHandler {
  GET?: (req: Request & { params: any }) => Response | Promise<Response>;
  POST?: (req: Request & { params: any }) => Response | Promise<Response>;
  PUT?: (req: Request & { params: any }) => Response | Promise<Response>;
  PATCH?: (req: Request & { params: any }) => Response | Promise<Response>;
  DELETE?: (req: Request & { params: any }) => Response | Promise<Response>;
  OPTIONS?: (req: Request & { params: any }) => Response | Promise<Response>;
}

export type RouteTable = Record<string, RouteHandler>;

function matchPattern(pattern: string, pathname: string) {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const patternPart = patternParts[index]!;
    const pathPart = pathParts[index]!;
    if (patternPart.startsWith(":")) {
      params[patternPart.slice(1)] = decodeURIComponent(pathPart);
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

  for (const [pattern, handlers] of Object.entries(table)) {
    const params = matchPattern(pattern, pathname);
    if (!params) continue;
    const handler = handlers[method];
    if (!handler) {
      return new Response("Method not allowed", { status: 405 });
    }
    return handler(Object.assign(req, { params }));
  }

  return null;
}

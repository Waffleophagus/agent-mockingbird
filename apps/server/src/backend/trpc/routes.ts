import { createAppRouter } from "@agent-mockingbird/api/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { createAppApiServices } from "./services";
import type { RuntimeEngine } from "../contracts/runtime";

function withCors(response: Response) {
  const next = new Headers(response.headers);
  next.set("access-control-allow-origin", "*");
  next.set("access-control-allow-methods", "GET,POST,OPTIONS");
  next.set("access-control-allow-headers", "content-type,x-trpc-source");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: next,
  });
}

export function createTrpcRoutes(runtime: RuntimeEngine, getLatestSeq: () => number) {
  const router = createAppRouter();
  const services = createAppApiServices(runtime, getLatestSeq);

  const handler = async (req: Request) =>
    withCors(
      await fetchRequestHandler({
        endpoint: "/trpc",
        req,
        router,
        createContext: () => ({ services }),
        onError({ error, path }) {
          console.error("[trpc]", path, error);
        },
      }),
    );

  return {
    "/trpc": {
      GET: handler,
      POST: handler,
      OPTIONS: () => withCors(new Response(null, { status: 204 })),
    },
    "/trpc/:path": {
      GET: handler,
      POST: handler,
      OPTIONS: () => withCors(new Response(null, { status: 204 })),
    },
  };
}

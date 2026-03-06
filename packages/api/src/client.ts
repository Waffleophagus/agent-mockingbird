import { createTRPCClient, httpBatchLink } from "@trpc/client";

import type { AppRouter } from "./router";

export function createAppApiClient(baseUrl: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${baseUrl.replace(/\/$/, "")}/trpc`,
      }),
    ],
  });
}

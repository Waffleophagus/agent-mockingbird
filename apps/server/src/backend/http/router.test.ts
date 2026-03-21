import { describe, expect, test } from "bun:test";

import { dispatchRoute } from "./router";

describe("dispatchRoute", () => {
  test("continues past a path match that lacks the requested method", async () => {
    const response = await dispatchRoute(
      {
        "/api/items/:id": {
          POST: () => new Response("create"),
        },
        "/api/items/list": {
          GET: () => new Response("list"),
        },
      },
      new Request("http://localhost/api/items/list", {
        method: "GET",
      }),
    );

    expect(response).not.toBeNull();
    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe("list");
  });

  test("returns 405 only after checking all matching patterns", async () => {
    const response = await dispatchRoute(
      {
        "/api/items/:id": {
          POST: () => new Response("create"),
        },
        "/api/items/:name": {
          DELETE: () => new Response("delete"),
        },
      },
      new Request("http://localhost/api/items/list", {
        method: "GET",
      }),
    );

    expect(response?.status).toBe(405);
    expect(await response?.text()).toBe("Method not allowed");
  });
});

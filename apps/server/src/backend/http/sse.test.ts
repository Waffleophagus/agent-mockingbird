import type { DashboardRealtimeFrame, UsageSnapshot } from "@agent-mockingbird/contracts/dashboard";
import { serve } from "bun";
import { afterEach, describe, expect, test } from "bun:test";

import { createRuntimeEventStream, type MobileRealtimeSocketData } from "./sse";
import { createUsageUpdatedEvent } from "../contracts/events";

const servers = new Set<Bun.Server<MobileRealtimeSocketData>>();

afterEach(() => {
  for (const server of servers) {
    server.stop(true);
  }
  servers.clear();
});

function createRealtimeTestServer() {
  const eventStream = createRuntimeEventStream({
    getHeartbeatSnapshot: () => ({
      online: true,
      at: new Date().toISOString(),
    }),
    getUsageSnapshot: () => ({
      requestCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
    }),
  });

  const server = serve<MobileRealtimeSocketData>({
    port: 0,
    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === "/api/mobile/events/ws") {
        return eventStream.websocketRoute(req, server);
      }
      return new Response("Not found", { status: 404 });
    },
    websocket: eventStream.websocket,
  });
  servers.add(server);

  return {
    eventStream,
    server,
  };
}

function toWsUrl(serverUrl: string, afterSeq: string) {
  const url = new URL(`/api/mobile/events/ws?afterSeq=${afterSeq}`, serverUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function createFrameReader(socket: WebSocket) {
  const pending: DashboardRealtimeFrame[] = [];
  let resolver: ((frame: DashboardRealtimeFrame) => void) | null = null;

  socket.onmessage = event => {
    if (typeof event.data !== "string") return;
    const frame = JSON.parse(event.data) as DashboardRealtimeFrame;
    if (resolver) {
      const nextResolver = resolver;
      resolver = null;
      nextResolver(frame);
      return;
    }
    pending.push(frame);
  };

  return () =>
    new Promise<DashboardRealtimeFrame>(resolve => {
      const next = pending.shift();
      if (next) {
        resolve(next);
        return;
      }
      resolver = resolve;
    });
}

function buildUsageEvent(requestCount: number) {
  const payload: UsageSnapshot = {
    requestCount,
    inputTokens: requestCount * 10,
    outputTokens: requestCount * 20,
    estimatedCostUsd: requestCount * 0.001,
  };
  return createUsageUpdatedEvent(payload, "runtime");
}

describe("mobile websocket transport", () => {
  test("replays buffered frames after afterSeq", async () => {
    const { eventStream, server } = createRealtimeTestServer();
    eventStream.publish(buildUsageEvent(1));
    eventStream.publish(buildUsageEvent(2));

    const socket = new WebSocket(toWsUrl(server.url.toString(), "1"));
    const nextFrame = createFrameReader(socket);

    const hello = await nextFrame();
    expect(hello.type).toBe("hello");

    const replayed = await nextFrame();
    expect(replayed.type).toBe("event");
    if (replayed.type !== "event") return;
    expect(replayed.seq).toBe(2);
    expect(replayed.event).toBe("usage");

    socket.close();
  });

  test("requests resync when afterSeq is ahead of server state", async () => {
    const { server } = createRealtimeTestServer();
    const socket = new WebSocket(toWsUrl(server.url.toString(), "99"));
    const nextFrame = createFrameReader(socket);

    const hello = await nextFrame();
    expect(hello.type).toBe("hello");

    const resync = await nextFrame();
    expect(resync.type).toBe("resync_required");
    if (resync.type !== "resync_required") return;
    expect(resync.reason).toBe("server_restart");

    socket.close();
  });
});

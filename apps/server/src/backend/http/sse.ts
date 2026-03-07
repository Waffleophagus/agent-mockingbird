import type {
  DashboardEvent,
  DashboardRealtimeEventFrame,
  DashboardRealtimeFrame,
  DashboardRealtimeHelloFrame,
  DashboardRealtimeResyncRequiredFrame,
  HeartbeatSnapshot,
  UsageSnapshot,
} from "@agent-mockingbird/contracts/dashboard";

import {
  createHeartbeatUpdatedEvent,
  createUsageUpdatedEvent,
  type RuntimeEvent,
} from "../contracts/events";

type Controller = ReadableStreamDefaultController<string>;
type MobileRealtimeWebSocket = Bun.ServerWebSocket<MobileRealtimeSocketData>;

interface BufferedRealtimeEvent extends DashboardRealtimeEventFrame {
  publishedAtMs: number;
}

export interface MobileRealtimeSocketData {
  afterSeq: number | null;
}

export interface RuntimeEventStream {
  publish: (event: RuntimeEvent) => void;
  getLatestSeq: () => number;
  websocketRoute: (req: Request, server: Bun.Server<MobileRealtimeSocketData>) => Response | undefined;
  websocket: Bun.WebSocketHandler<MobileRealtimeSocketData>;
  route: {
    GET: () => Response;
  };
}

const MOBILE_REPLAY_WINDOW_SIZE = 5_000;
const MOBILE_REPLAY_WINDOW_TTL_MS = 15 * 60_000;

function toMobileDashboardEvent(event: RuntimeEvent): DashboardEvent | null {
  switch (event.type) {
    case "heartbeat.updated":
      return { event: "heartbeat", payload: event.payload };
    case "usage.updated":
      return { event: "usage", payload: event.payload };
    case "session.state.updated":
      return { event: "session-updated", payload: event.payload };
    case "session.message.created":
      return { event: "session-message", payload: event.payload };
    case "session.message.part.updated":
      return { event: "session-message-part", payload: event.payload };
    case "session.message.delta":
      return { event: "session-message-delta", payload: event.payload };
    case "session.run.status.updated":
      return { event: "session-status", payload: event.payload };
    case "session.compacted":
      return { event: "session-compacted", payload: event.payload };
    case "session.run.error":
      return { event: "session-error", payload: event.payload };
    case "session.permission.requested":
      return { event: "permission-requested", payload: event.payload };
    case "session.permission.resolved":
      return { event: "permission-resolved", payload: event.payload };
    case "session.question.requested":
      return { event: "question-requested", payload: event.payload };
    case "session.question.resolved":
      return { event: "question-resolved", payload: event.payload };
    case "background.run.updated":
      return { event: "background-run", payload: event.payload };
    case "skills.catalog.updated":
      return { event: "skills-catalog-updated", payload: event.payload };
    default:
      return null;
  }
}

function toSseEventName(event: RuntimeEvent): string {
  switch (event.type) {
    case "heartbeat.updated":
      return "heartbeat";
    case "usage.updated":
      return "usage";
    case "session.state.updated":
      return "session-updated";
    case "session.message.created":
      return "session-message";
    case "session.message.part.updated":
      return "session-message-part";
    case "session.message.delta":
      return "session-message-delta";
    case "session.run.status.updated":
      return "session-status";
    case "session.compacted":
      return "session-compacted";
    case "session.run.error":
      return "session-error";
    case "session.permission.requested":
      return "permission-requested";
    case "session.permission.resolved":
      return "permission-resolved";
    case "session.question.requested":
      return "question-requested";
    case "session.question.resolved":
      return "question-resolved";
    case "background.run.updated":
      return "background-run";
    case "config.updated":
      return "config-updated";
    case "config.update.failed":
      return "config-error";
    case "config.update.rolled_back":
      return "config-rollback";
    case "skills.catalog.updated":
      return "skills-catalog-updated";
    case "channel.signal.status.updated":
      return "signal-status";
    case "channel.signal.pairing.requested":
      return "signal-pairing";
    case "channel.signal.message.received":
      return "signal-message-received";
    case "channel.signal.message.sent":
      return "signal-message-sent";
    case "channel.signal.error":
      return "signal-error";
    default:
      return "runtime-event";
  }
}

export function toSseFrame(event: RuntimeEvent): string {
  return `event: ${toSseEventName(event)}\ndata: ${JSON.stringify(event.payload)}\n\n`;
}

function toRealtimeFrameJson(frame: DashboardRealtimeFrame): string {
  return JSON.stringify(frame);
}

function trimReplayBuffer(buffer: BufferedRealtimeEvent[], latestSeq: number) {
  const minPublishedAtMs = Date.now() - MOBILE_REPLAY_WINDOW_TTL_MS;
  while (buffer.length > 0) {
    const first = buffer[0];
    if (!first) break;
    const exceedsSize = buffer.length > MOBILE_REPLAY_WINDOW_SIZE;
    const exceedsTtl = first.publishedAtMs < minPublishedAtMs && latestSeq > first.seq;
    if (!exceedsSize && !exceedsTtl) break;
    buffer.shift();
  }
}

function parseAfterSeq(req: Request): number | null {
  const raw = new URL(req.url).searchParams.get("afterSeq");
  if (raw == null || raw.trim() === "") return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return Number.NaN;
  return parsed;
}

export function createRuntimeEventStream(input: {
  getHeartbeatSnapshot: () => HeartbeatSnapshot;
  getUsageSnapshot: () => UsageSnapshot;
}): RuntimeEventStream {
  const controllers = new Set<Controller>();
  const sockets = new Set<MobileRealtimeWebSocket>();
  const replayBuffer: BufferedRealtimeEvent[] = [];
  let latestSeq = 0;

  const publish = (event: RuntimeEvent) => {
    latestSeq += 1;
    const frame = toSseFrame(event);
    const realtimeEvent = toMobileDashboardEvent(event);
    if (realtimeEvent) {
      const realtimeFrame: DashboardRealtimeEventFrame = {
        type: "event",
        seq: latestSeq,
        event: realtimeEvent.event,
        payload: realtimeEvent.payload,
      };
      replayBuffer.push({
        ...realtimeFrame,
        publishedAtMs: Date.now(),
      });
      trimReplayBuffer(replayBuffer, latestSeq);

      const encodedRealtimeFrame = toRealtimeFrameJson(realtimeFrame);
      for (const socket of sockets) {
        try {
          socket.send(encodedRealtimeFrame);
        } catch {
          sockets.delete(socket);
        }
      }
    }

    for (const controller of controllers) {
      try {
        controller.enqueue(frame);
      } catch {
        controllers.delete(controller);
      }
    }
  };

  function getLatestSeq() {
    return latestSeq;
  }

  function resolveReplayPlan(afterSeq: number | null):
    | { kind: "live" }
    | { kind: "replay"; frames: BufferedRealtimeEvent[]; snapshotLatestSeq: number }
    | { kind: "resync"; reason: DashboardRealtimeResyncRequiredFrame["reason"] } {
    if (afterSeq == null) {
      return { kind: "live" };
    }
    if (!Number.isInteger(afterSeq) || afterSeq < 0) {
      return { kind: "resync", reason: "invalid_cursor" };
    }
    if (afterSeq > latestSeq) {
      return { kind: "resync", reason: "server_restart" };
    }
    if (afterSeq === latestSeq) {
      return { kind: "replay", frames: [], snapshotLatestSeq: latestSeq };
    }

    const firstBufferedSeq = replayBuffer[0]?.seq ?? latestSeq;
    if (afterSeq < firstBufferedSeq) {
      return { kind: "resync", reason: "gap" };
    }

    return {
      kind: "replay",
      frames: replayBuffer.filter(frame => frame.seq > afterSeq),
      snapshotLatestSeq: latestSeq,
    };
  }

  function sendHello(ws: MobileRealtimeWebSocket) {
    const helloFrame: DashboardRealtimeHelloFrame = {
      type: "hello",
      latestSeq,
      replayWindowSize: MOBILE_REPLAY_WINDOW_SIZE,
    };
    ws.send(toRealtimeFrameJson(helloFrame));
  }

  return {
    publish,
    getLatestSeq,
    websocketRoute: (req, server) => {
      const afterSeq = parseAfterSeq(req);
      const upgraded = server.upgrade(req, {
        data: {
          afterSeq,
        },
      });
      if (!upgraded) {
        return new Response("Upgrade failed", { status: 400 });
      }
      return undefined;
    },
    websocket: {
      data: {} as MobileRealtimeSocketData,
      open(ws) {
        sendHello(ws);
        const replayPlan = resolveReplayPlan(ws.data.afterSeq);
        if (replayPlan.kind === "resync") {
          const resyncFrame: DashboardRealtimeResyncRequiredFrame = {
            type: "resync_required",
            latestSeq,
            reason: replayPlan.reason,
          };
          ws.send(toRealtimeFrameJson(resyncFrame));
          ws.close(4001, replayPlan.reason);
          return;
        }

        if (replayPlan.kind === "replay") {
          for (const replayFrame of replayPlan.frames) {
            ws.send(toRealtimeFrameJson(replayFrame));
          }
          sockets.add(ws);
          const latestAfterSubscription = latestSeq;
          if (latestAfterSubscription > replayPlan.snapshotLatestSeq) {
            const catchupFrames = replayBuffer.filter(
              frame => frame.seq > replayPlan.snapshotLatestSeq && frame.seq <= latestAfterSubscription,
            );
            for (const catchupFrame of catchupFrames) {
              ws.send(toRealtimeFrameJson(catchupFrame));
            }
          }
          return;
        }

        sockets.add(ws);
      },
      close(ws) {
        sockets.delete(ws);
      },
      message() {
        // Mobile transport is server-push only for now.
      },
    },
    route: {
      GET: () => {
        let streamController: Controller | null = null;

        const stream = new ReadableStream<string>({
          start(controller) {
            streamController = controller;
            controllers.add(controller);
            controller.enqueue(
              toSseFrame(createHeartbeatUpdatedEvent(input.getHeartbeatSnapshot(), "system")),
            );
            controller.enqueue(
              toSseFrame(createUsageUpdatedEvent(input.getUsageSnapshot(), "system")),
            );
          },
          cancel() {
            if (streamController) {
              controllers.delete(streamController);
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        });
      },
    },
  };
}

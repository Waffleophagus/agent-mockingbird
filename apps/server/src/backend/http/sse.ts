import type { HeartbeatSnapshot, UsageSnapshot } from "@agent-mockingbird/contracts/dashboard";

import { createBoundedQueue, type BoundedQueue } from "./boundedQueue";
import {
  createHeartbeatUpdatedEvent,
  createUsageUpdatedEvent,
  type RuntimeEvent,
} from "../contracts/events";

type Controller = ReadableStreamDefaultController<string>;

export interface RuntimeEventStream {
  publish: (event: RuntimeEvent) => void;
  route: {
    GET: () => Response;
  };
}

const SSE_MAX_QUEUED_FRAMES = 256;
const STREAM_DRAIN_DELAY_MS = 25;

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
    case "config.invalidated":
      return "config-invalidated";
    case "config.update.failed":
      return "config-error";
    case "config.update.rolled_back":
      return "config-rollback";
    case "skills.catalog.updated":
      return "skills-catalog-updated";
    default:
      return "runtime-event";
  }
}

function toSseFrame(event: RuntimeEvent): string {
  return `event: ${toSseEventName(event)}\ndata: ${JSON.stringify(event.payload)}\n\n`;
}

export function createRuntimeEventStream(input: {
  getHeartbeatSnapshot: () => HeartbeatSnapshot;
  getUsageSnapshot: () => UsageSnapshot;
}): RuntimeEventStream {
  const controllerQueues = new Map<Controller, BoundedQueue<string>>();

  const publish = (event: RuntimeEvent) => {
    const frame = toSseFrame(event);
    for (const queue of controllerQueues.values()) {
      queue.enqueue(frame);
    }
  };

  return {
    publish,
    route: {
      GET: () => {
        let queue: BoundedQueue<string> | null = null;
        let activeController: Controller | null = null;

        return new Response(
          new ReadableStream<string>({
            start(controller) {
              activeController = controller;
              const cleanup = () => {
                queue?.close();
                controllerQueues.delete(controller);
                activeController = null;
                queue = null;
              };

              queue = createBoundedQueue<string>({
                maxSize: SSE_MAX_QUEUED_FRAMES,
                drainDelayMs: STREAM_DRAIN_DELAY_MS,
                tryWrite(frame) {
                  controller.enqueue(frame);
                  return true;
                },
                onOverflow() {
                  cleanup();
                  controller.error(new Error("SSE client fell behind"));
                },
                onWriteError() {
                  cleanup();
                },
              });
              controllerQueues.set(controller, queue);

              queue.enqueue(
                toSseFrame(createHeartbeatUpdatedEvent(input.getHeartbeatSnapshot(), "api")),
              );
              queue.enqueue(
                toSseFrame(createUsageUpdatedEvent(input.getUsageSnapshot(), "api")),
              );
            },
            cancel() {
              queue?.close();
              if (activeController) {
                controllerQueues.delete(activeController);
              }
              activeController = null;
              queue = null;
            },
          }),
          {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache, no-transform",
              Connection: "keep-alive",
            },
          },
        );
      },
    },
  };
}

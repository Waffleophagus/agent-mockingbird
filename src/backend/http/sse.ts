import type { HeartbeatSnapshot, UsageSnapshot } from "../../types/dashboard";
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
    case "session.run.status.updated":
      return "session-status";
    case "session.compacted":
      return "session-compacted";
    case "session.run.error":
      return "session-error";
    case "background.run.updated":
      return "background-run";
    case "config.updated":
      return "config-updated";
    case "config.update.failed":
      return "config-error";
    case "config.update.rolled_back":
      return "config-rollback";
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

export function createRuntimeEventStream(input: {
  getHeartbeatSnapshot: () => HeartbeatSnapshot;
  getUsageSnapshot: () => UsageSnapshot;
}): RuntimeEventStream {
  const controllers = new Set<Controller>();

  const publish = (event: RuntimeEvent) => {
    const frame = toSseFrame(event);
    for (const controller of controllers) {
      try {
        controller.enqueue(frame);
      } catch {
        controllers.delete(controller);
      }
    }
  };

  return {
    publish,
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

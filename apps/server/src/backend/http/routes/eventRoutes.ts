import type { RuntimeEventStream } from "../sse";

export function createEventRoutes(eventStream: RuntimeEventStream) {
  return {
    "/api/events": eventStream.route,
  };
}

import type { MobileRealtimeSocketData, RuntimeEventStream } from "../sse";

export function createEventRoutes(eventStream: RuntimeEventStream) {
  return {
    "/api/events": eventStream.route,
    "/api/mobile/events/ws": (req: Request, server: Bun.Server<MobileRealtimeSocketData>) =>
      eventStream.websocketRoute(req, server),
  };
}

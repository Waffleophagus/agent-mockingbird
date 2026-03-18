import type { HeartbeatRuntimeService } from "../../heartbeat/runtimeService";

export function createHeartbeatRoutes(heartbeatService: HeartbeatRuntimeService) {
  return {
    "/api/waffle/heartbeat": {
      GET: async () => {
        try {
          return Response.json({ heartbeat: heartbeatService.getStatus() });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to load heartbeat status";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },

    "/api/waffle/heartbeat/run": {
      POST: async () => {
        try {
          const heartbeat = await heartbeatService.runNow();
          return Response.json({ heartbeat }, { status: 202 });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to run heartbeat";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  };
}

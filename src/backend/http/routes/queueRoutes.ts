import { getLaneQueue } from "../../queue/service";

export function createQueueRoutes() {
  return {
    "/api/queue/stats": {
      GET: () => {
        try {
          const queue = getLaneQueue();
          return Response.json({
            enabled: true,
            lanes: queue.stats(),
          });
        } catch {
          return Response.json({
            enabled: false,
            lanes: [],
          });
        }
      },
    },

    "/api/queue/:sessionId/mode": {
      POST: async (req: Request & { params: { sessionId: string } }) => {
        const { sessionId } = req.params;
        let body: { mode?: string };
        try {
          body = await req.json();
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        const { mode } = body;
        if (!mode || !["collect", "followup", "replace"].includes(mode)) {
          return Response.json({ error: "Invalid mode. Must be 'collect', 'followup', or 'replace'" }, { status: 400 });
        }

        try {
          const queue = getLaneQueue();
          queue.setMode(sessionId, mode as "collect" | "followup" | "replace");
          return Response.json({ sessionId, mode });
        } catch {
          return Response.json({ error: "Queue not initialized" }, { status: 500 });
        }
      },
    },

    "/api/queue/:sessionId": {
      DELETE: (req: Request & { params: { sessionId: string } }) => {
        const { sessionId } = req.params;
        try {
          const queue = getLaneQueue();
          const cleared = queue.clear(sessionId);
          return Response.json({ sessionId, cleared });
        } catch {
          return Response.json({ error: "Queue not initialized" }, { status: 500 });
        }
      },
    },
  };
}

import { describe, expect, test } from "bun:test";

import { createHeartbeatRoutes } from "./heartbeatRoutes";

describe("heartbeat routes", () => {
  test("GET /api/mockingbird/heartbeat returns session metadata", async () => {
    const routes = createHeartbeatRoutes({
      getStatus: () => ({
        config: {
          enabled: true,
          interval: "30m",
          agentId: "build",
          model: "opencode/big-pickle",
          prompt: "Read HEARTBEAT.md",
          ackMaxChars: 300,
          activeHours: null,
        },
        state: {
          sessionId: "session-heartbeat",
          running: false,
          lastRunAt: "2026-03-20T00:00:00.000Z",
          lastResult: "acknowledged",
          lastResponse: null,
          lastError: null,
          updatedAt: "2026-03-20T00:00:00.000Z",
        },
        sessionTitle: "Heartbeat",
        nextDueAt: "2026-03-20T00:30:00.000Z",
      }),
    } as never);

    const response = await routes["/api/mockingbird/heartbeat"].GET();
    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      heartbeat: { state: { sessionId: string | null }; sessionTitle: string | null };
    };
    expect(payload.heartbeat.state.sessionId).toBe("session-heartbeat");
    expect(payload.heartbeat.sessionTitle).toBe("Heartbeat");
  });
});

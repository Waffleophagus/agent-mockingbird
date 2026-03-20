import { deleteLegacyHeartbeatJobs } from "./defaultJob";
import { executeHeartbeat, parseInterval } from "./service";
import { getHeartbeatRuntimeState, patchHeartbeatRuntimeState } from "./state";
import type { HeartbeatRuntimeConfig, HeartbeatStatus } from "./types";
import { getConfigSnapshot } from "../config/service";
import { getSessionById, setSessionModel, setSessionTitle } from "../db/repository";
import { getRuntime } from "../runtime";

const HEARTBEAT_SESSION_TITLE = "Heartbeat";
const TICK_MS = 1_000;

function nowMs() {
  return Date.now();
}

function toIso(value: number | null) {
  return value == null ? null : new Date(value).toISOString();
}

function loadHeartbeatConfig(): HeartbeatRuntimeConfig {
  return getConfigSnapshot().config.runtime.heartbeat;
}

export class HeartbeatRuntimeService {
  private timer: Timer | null = null;
  private inFlight: Promise<HeartbeatStatus> | null = null;

  start() {
    deleteLegacyHeartbeatJobs();
    void this.ensureHeartbeatSession();
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_MS);
    void this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getStatus(): HeartbeatStatus {
    const config = loadHeartbeatConfig();
    const state = getHeartbeatRuntimeState();
    const sessionTitle = state.sessionId ? getSessionById(state.sessionId)?.title ?? null : null;
    return {
      config,
      state,
      sessionTitle,
      nextDueAt: this.computeNextDueAt(config.interval, state.lastRunAt, state.running, config.enabled),
    };
  }

  async runNow() {
    return this.runHeartbeat({ manual: true });
  }

  private async tick() {
    const config = loadHeartbeatConfig();
    if (!config.enabled) return;
    const state = getHeartbeatRuntimeState();
    const nextDueAt = this.computeNextDueAt(config.interval, state.lastRunAt, state.running, config.enabled);
    if (!nextDueAt) {
      await this.runHeartbeat();
      return;
    }
    if (Date.parse(nextDueAt) <= nowMs()) {
      await this.runHeartbeat();
    }
  }

  private computeNextDueAt(
    interval: string,
    lastRunAtIso: string | null,
    running: boolean,
    enabled: boolean,
  ) {
    if (!enabled || running) return null;
    if (!lastRunAtIso) return null;
    const lastRunAt = Date.parse(lastRunAtIso);
    if (!Number.isFinite(lastRunAt)) return null;
    return toIso(lastRunAt + parseInterval(interval));
  }

  private async ensureHeartbeatSession() {
    const config = loadHeartbeatConfig();
    const state = getHeartbeatRuntimeState();
    let session = state.sessionId ? getSessionById(state.sessionId) : null;
    if (!session) {
      const mainSession = getSessionById("main");
      if (!mainSession) {
        throw new Error("Main session not available");
      }
      const runtime = getRuntime();
      if (!runtime?.spawnBackgroundSession) {
        throw new Error("Runtime does not support heartbeat child sessions");
      }
      const spawned = await runtime.spawnBackgroundSession({
        parentSessionId: "main",
        title: HEARTBEAT_SESSION_TITLE,
        requestedBy: "heartbeat",
        prompt: "",
      });
      const sessionId = spawned.childSessionId?.trim();
      if (!sessionId) {
        throw new Error("Failed to create heartbeat child session");
      }
      session = getSessionById(sessionId);
      if (!session) {
        throw new Error(`Failed to load heartbeat child session ${sessionId}`);
      }
      patchHeartbeatRuntimeState({
        sessionId,
        backgroundRunId: spawned.runId,
        parentSessionId: spawned.parentSessionId,
        externalSessionId: spawned.childExternalSessionId,
      });
    }

    if (session.title !== HEARTBEAT_SESSION_TITLE) {
      setSessionTitle(session.id, HEARTBEAT_SESSION_TITLE);
    }
    if (session.model !== config.model) {
      setSessionModel(session.id, config.model);
    }

    return getSessionById(session.id) ?? session;
  }

  private async runHeartbeat(input?: { manual?: boolean }) {
    if (this.inFlight) return this.inFlight;

    const run = (async () => {
      let sessionIdForState: string | null = getHeartbeatRuntimeState().sessionId;
      try {
        const config = loadHeartbeatConfig();
        const session = await this.ensureHeartbeatSession();
        sessionIdForState = session.id;
        patchHeartbeatRuntimeState({
          sessionId: session.id,
          running: true,
          lastError: null,
        });

        const result = await executeHeartbeat(this.resolveAgentId(config), session.id, {
          enabled: input?.manual ? true : config.enabled,
          interval: config.interval,
          activeHours: config.activeHours,
          prompt: config.prompt,
          ackMaxChars: config.ackMaxChars,
        });

        patchHeartbeatRuntimeState({
          sessionId: session.id,
          running: false,
          lastRunAt: nowMs(),
          lastResult: result.error
            ? "error"
            : result.skipped
              ? "skipped"
              : result.acknowledged
                ? "acknowledged"
                : "attention",
          lastResponse: result.response ?? null,
          lastError: result.error ?? null,
        });
      } catch (error) {
        patchHeartbeatRuntimeState({
          sessionId: sessionIdForState,
          running: false,
          lastRunAt: nowMs(),
          lastResult: "error",
          lastResponse: null,
          lastError: error instanceof Error ? error.message : "Unknown heartbeat error",
        });
      }
      return this.getStatus();
    })().finally(() => {
      this.inFlight = null;
    });

    this.inFlight = run;
    return run;
  }

  private resolveAgentId(config: HeartbeatRuntimeConfig) {
    const requested = config.agentId.trim();
    return requested || "build";
  }
}

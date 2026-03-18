import { deleteLegacyHeartbeatJobs } from "./defaultJob";
import { executeHeartbeat, parseInterval } from "./service";
import { getHeartbeatRuntimeState, patchHeartbeatRuntimeState } from "./state";
import type { HeartbeatRuntimeConfig, HeartbeatStatus } from "./types";
import { getConfigSnapshot } from "../config/service";
import { createSession, getSessionById, setSessionModel, setSessionTitle } from "../db/repository";

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
    return {
      config,
      state,
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
      session = createSession({
        title: HEARTBEAT_SESSION_TITLE,
        model: config.model,
      });
      patchHeartbeatRuntimeState({
        sessionId: session.id,
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
      const config = loadHeartbeatConfig();
      const session = await this.ensureHeartbeatSession();
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

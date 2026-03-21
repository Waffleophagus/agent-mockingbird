import type { CronJobDefinition } from "../cron/types";
import { getLocalSessionIdByRuntimeBinding } from "../db/repository";
import { isActiveHeartbeatSession } from "../heartbeat/state";

const OPENCODE_RUNTIME_ID = "opencode";

export interface SessionScopeResolver {
  getJobByThreadSessionId(sessionId: string): CronJobDefinition | null;
}

export interface RuntimeSessionScope {
  sessionId: string;
  localSessionId: string | null;
  isMain: boolean;
  kind: "main" | "cron" | "heartbeat" | "other";
  heartbeat: boolean;
  cronJobId: string | null;
  cronJobName: string | null;
  mayNotifyMain: boolean;
}

export function resolveRuntimeSessionScope(
  externalSessionId: string,
  resolver: SessionScopeResolver,
): RuntimeSessionScope {
  const sessionId = externalSessionId.trim();
  const localSessionId = sessionId
    ? getLocalSessionIdByRuntimeBinding(OPENCODE_RUNTIME_ID, sessionId)
    : null;
  const isMain = localSessionId === "main";
  const heartbeat = localSessionId ? isActiveHeartbeatSession(localSessionId) : false;
  const cronJob = localSessionId ? resolver.getJobByThreadSessionId(localSessionId) : null;
  const kind = isMain ? "main" : heartbeat ? "heartbeat" : cronJob ? "cron" : "other";

  return {
    sessionId,
    localSessionId,
    isMain,
    kind,
    heartbeat,
    cronJobId: cronJob?.id ?? null,
    cronJobName: cronJob?.name ?? null,
    mayNotifyMain: kind === "cron" || kind === "heartbeat",
  };
}

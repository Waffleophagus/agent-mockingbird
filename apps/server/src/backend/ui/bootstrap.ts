import type { SessionScreenBootstrapResponse } from "@agent-mockingbird/contracts/dashboard";

import { buildWorkspaceBootstrapPromptContext } from "../agents/bootstrapContext";
import type { RuntimeEngine } from "../contracts/runtime";
import { getHeartbeatSnapshot, getSessionById, getUsageSnapshot, listMessagesForSession, listSessions } from "../db/repository";
import { listOpencodeModelOptions } from "../opencode/models";
import { listPendingPrompts } from "../prompts/service";

export async function createRuntimeSessionBootstrap(
  runtime: RuntimeEngine,
  requestedSessionId?: string,
): Promise<SessionScreenBootstrapResponse> {
  const sessions = listSessions();
  const activeSessionId = requestedSessionId?.trim() || sessions[0]?.id || "";

  if (activeSessionId && runtime.syncSessionMessages) {
    await runtime.syncSessionMessages(activeSessionId).catch(() => undefined);
  }

  const activeSession = activeSessionId ? getSessionById(activeSessionId) : null;
  const messages = activeSessionId ? listMessagesForSession(activeSessionId) : [];
  const usage = getUsageSnapshot();
  const heartbeat = getHeartbeatSnapshot();
  const [models, pendingPrompts, backgroundRuns] = await Promise.all([
    listOpencodeModelOptions().catch(() => []),
    listPendingPrompts().catch(() => ({ pendingPermissions: [], pendingQuestions: [] })),
    runtime.listBackgroundRuns
      ? runtime.listBackgroundRuns({ parentSessionId: activeSessionId || undefined, limit: 250 }).catch(() => [])
      : Promise.resolve([]),
  ]);
  const workspaceBootstrap = buildWorkspaceBootstrapPromptContext();

  return {
    sessions,
    activeSessionId,
    activeSession,
    messages,
    usage,
    heartbeat,
    models,
    pendingPermissions: pendingPrompts.pendingPermissions,
    pendingQuestions: pendingPrompts.pendingQuestions,
    backgroundRuns: backgroundRuns.map(run => ({
      runId: run.runId,
      parentSessionId: run.parentSessionId,
      parentExternalSessionId: run.parentExternalSessionId,
      childExternalSessionId: run.childExternalSessionId,
      childSessionId: run.childSessionId,
      requestedBy: run.requestedBy,
      prompt: run.prompt,
      status: run.status,
      resultSummary: run.resultSummary,
      error: run.error,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
    })),
    workspaceBootstrap: {
      mode: workspaceBootstrap.mode,
      identity: workspaceBootstrap.identity ?? undefined,
      files: workspaceBootstrap.files.map(file => ({
        name: file.name,
        missing: file.missing,
        truncated: file.truncated,
      })),
    },
    featureFlags: {
      reviewEnabled: false,
    },
  };
}

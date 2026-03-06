import { buildWorkspaceBootstrapPromptContext } from "../../agents/bootstrapContext";
import type { RuntimeEngine } from "../../contracts/runtime";
import {
  getHeartbeatSnapshot,
  getSessionById,
  getUsageSnapshot,
  listMessagesForSession,
  listSessions,
} from "../../db/repository";
import { listOpencodeModelOptions } from "../../opencode/models";
import { listPendingPrompts } from "../../prompts/service";

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function estimateContextBreakdown(messages: ReturnType<typeof listMessagesForSession>) {
  const userChars = messages.filter(msg => msg.role === "user").reduce((sum, msg) => sum + msg.content.length, 0);
  const assistantChars = messages.filter(msg => msg.role === "assistant").reduce((sum, msg) => sum + msg.content.length, 0);
  const toolCount = messages
    .filter(msg => msg.role === "assistant")
    .flatMap(msg => msg.parts ?? [])
    .filter(part => part.type === "tool_call").length;
  const thinkingCount = messages
    .filter(msg => msg.role === "assistant")
    .flatMap(msg => msg.parts ?? [])
    .filter(part => part.type === "thinking").length;

  const weightedUser = userChars;
  const weightedAssistant = assistantChars;
  const weightedTools = toolCount * 320;
  const weightedOther = thinkingCount * 120;
  const weightedSystem = Math.max(800, Math.floor((weightedUser + weightedAssistant) * 0.06));
  const total = Math.max(1, weightedUser + weightedAssistant + weightedTools + weightedOther + weightedSystem);

  return {
    system: clampPercent((weightedSystem / total) * 100),
    user: clampPercent((weightedUser / total) * 100),
    assistant: clampPercent((weightedAssistant / total) * 100),
    tools: clampPercent((weightedTools / total) * 100),
    other: clampPercent((weightedOther / total) * 100),
  };
}

export function createUiRoutes(runtime: RuntimeEngine) {
  return {
    "/api/ui/session-screen/bootstrap": {
      GET: async (req: Request) => {
        const url = new URL(req.url);
        const requestedSessionId = url.searchParams.get("sessionId")?.trim() ?? "";
        const sessions = listSessions();
        const activeSessionId = requestedSessionId || sessions[0]?.id || "";

        if (activeSessionId && runtime.syncSessionMessages) {
          try {
            await runtime.syncSessionMessages(activeSessionId);
          } catch {
            // Best effort sync only.
          }
        }

        const activeSession = activeSessionId ? getSessionById(activeSessionId) : null;
        const messages = activeSessionId ? listMessagesForSession(activeSessionId) : [];
        const usage = getUsageSnapshot();
        const heartbeat = getHeartbeatSnapshot();
        const modelsPayload = await listOpencodeModelOptions().catch(() => []);
        const pendingPrompts = await listPendingPrompts().catch(() => ({
          pendingPermissions: [],
          pendingQuestions: [],
        }));
        const backgroundRuns = runtime.listBackgroundRuns
          ? await runtime.listBackgroundRuns({ parentSessionId: activeSessionId || undefined, limit: 250 }).catch(() => [])
          : [];
        const workspaceBootstrap = buildWorkspaceBootstrapPromptContext();

        return Response.json({
          sessions,
          activeSessionId,
          activeSession,
          messages,
          usage,
          heartbeat,
          models: modelsPayload,
          pendingPermissions: pendingPrompts.pendingPermissions,
          pendingQuestions: pendingPrompts.pendingQuestions,
          backgroundRuns,
          workspaceBootstrap: {
            mode: workspaceBootstrap.mode,
            identity: workspaceBootstrap.identity,
            files: workspaceBootstrap.files.map(file => ({
              name: file.name,
              missing: file.missing,
              truncated: file.truncated,
            })),
          },
          featureFlags: {
            reviewEnabled: false,
          },
        });
      },
    },

    "/api/ui/sessions/:id/context": {
      GET: async (req: Request & { params: { id: string } }) => {
        const sessionId = req.params.id;
        const session = getSessionById(sessionId);
        if (!session) {
          return Response.json({ error: "Unknown session" }, { status: 404 });
        }
        if (runtime.syncSessionMessages) {
          try {
            await runtime.syncSessionMessages(sessionId);
          } catch {
            // Best effort sync only.
          }
        }

        const messages = listMessagesForSession(sessionId);
        const usage = getUsageSnapshot();
        const bootstrap = buildWorkspaceBootstrapPromptContext();
        const userMessages = messages.filter(msg => msg.role === "user");
        const assistantMessages = messages.filter(msg => msg.role === "assistant");
        const breakdown = estimateContextBreakdown(messages);

        return Response.json({
          session: {
            id: session.id,
            title: session.title,
            model: session.model,
            status: session.status,
            createdAt: session.lastActiveAt,
            lastActiveAt: session.lastActiveAt,
            messageCount: session.messageCount,
          },
          metrics: {
            userMessages: userMessages.length,
            assistantMessages: assistantMessages.length,
            totalMessages: messages.length,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.inputTokens + usage.outputTokens,
            estimatedCostUsd: usage.estimatedCostUsd,
          },
          contextBreakdown: breakdown,
          bootstrap: {
            mode: bootstrap.mode,
            files: bootstrap.files.map(file => ({
              name: file.name,
              path: file.path,
              missing: file.missing,
              truncated: file.truncated,
            })),
          },
        });
      },
    },

    "/api/ui/sessions/:id/review": {
      GET: (req: Request & { params: { id: string } }) => {
        const session = getSessionById(req.params.id);
        if (!session) {
          return Response.json({ error: "Unknown session" }, { status: 404 });
        }
        return Response.json({
          enabled: false,
          reason: "review_not_yet_mapped",
          sessionId: session.id,
        });
      },
    },
  };
}

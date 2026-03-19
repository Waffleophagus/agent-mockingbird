import {
  type QuestionInfo,
  type QuestionRequest,
  type PermissionRequest,
} from "@opencode-ai/sdk/v2/client";

import { getConfigSnapshot } from "../config/service";
import { getLocalSessionIdByRuntimeBinding } from "../db/repository";
import { createOpencodeV2ClientFromConnection, unwrapSdkData } from "../opencode/client";

const OPENCODE_RUNTIME_ID = "opencode";

interface PendingPermissionPrompt {
  id: string;
  sessionId: string;
  permission: string;
  patterns: string[];
  metadata: Record<string, unknown>;
  always: string[];
}

interface PendingQuestionPrompt {
  id: string;
  sessionId: string;
  questions: QuestionInfo[];
}

interface PendingPromptsSnapshot {
  pendingPermissions: PendingPermissionPrompt[];
  pendingQuestions: PendingQuestionPrompt[];
}

function createPromptClient() {
  const config = getConfigSnapshot().config.runtime.opencode;
  return {
    client: createOpencodeV2ClientFromConnection({
      baseUrl: config.baseUrl,
      directory: config.directory,
    }),
    timeoutMs: config.timeoutMs,
  };
}

function toLocalSessionId(externalSessionId: string) {
  return getLocalSessionIdByRuntimeBinding(OPENCODE_RUNTIME_ID, externalSessionId);
}

function normalizePendingPermission(input: PermissionRequest): PendingPermissionPrompt | null {
  const localSessionId = toLocalSessionId(input.sessionID);
  if (!localSessionId) return null;
  return {
    id: input.id,
    sessionId: localSessionId,
    permission: input.permission,
    patterns: Array.isArray(input.patterns) ? input.patterns : [],
    metadata:
      input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
        ? input.metadata
        : {},
    always: Array.isArray(input.always) ? input.always : [],
  };
}

function normalizePendingQuestion(input: QuestionRequest): PendingQuestionPrompt | null {
  const localSessionId = toLocalSessionId(input.sessionID);
  if (!localSessionId) return null;
  return {
    id: input.id,
    sessionId: localSessionId,
    questions: Array.isArray(input.questions) ? input.questions : [],
  };
}

export async function listPendingPrompts(): Promise<PendingPromptsSnapshot> {
  const { client, timeoutMs } = createPromptClient();
  const options = {
    responseStyle: "data" as const,
    throwOnError: true as const,
    signal: AbortSignal.timeout(timeoutMs),
  };

  const [permissionListRaw, questionListRaw] = await Promise.all([
    client.permission.list(undefined, options),
    client.question.list(undefined, options),
  ]);

  const permissions = (unwrapSdkData<PermissionRequest[]>(permissionListRaw) ?? [])
    .map(normalizePendingPermission)
    .filter((item): item is PendingPermissionPrompt => Boolean(item))
    .sort((left, right) => left.id.localeCompare(right.id));
  const questions = (unwrapSdkData<QuestionRequest[]>(questionListRaw) ?? [])
    .map(normalizePendingQuestion)
    .filter((item): item is PendingQuestionPrompt => Boolean(item))
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    pendingPermissions: permissions,
    pendingQuestions: questions,
  };
}

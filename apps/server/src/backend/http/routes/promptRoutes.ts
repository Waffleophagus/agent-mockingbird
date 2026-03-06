import { getOpencodeErrorStatus } from "../../opencode/client";
import {
  listPendingPrompts,
  rejectQuestionPrompt,
  replyPermissionPrompt,
  replyQuestionPrompt,
} from "../../prompts/service";

function errorStatus(error: unknown) {
  const sdkStatus = getOpencodeErrorStatus(error);
  if (sdkStatus === 400) return 400;
  if (sdkStatus === 404) return 404;
  if (sdkStatus === 409) return 409;
  return 502;
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

function isQuestionAnswers(value: unknown): value is Array<Array<string>> {
  if (!Array.isArray(value)) return false;
  return value.every(item => Array.isArray(item) && item.every(entry => typeof entry === "string"));
}

export function createPromptRoutes() {
  return {
    "/api/ui/session-screen/prompts": {
      GET: async () => {
        try {
          return Response.json(await listPendingPrompts());
        } catch (error) {
          return Response.json(
            {
              error: errorMessage(error, "Failed to load pending prompts"),
              pendingPermissions: [],
              pendingQuestions: [],
            },
            { status: errorStatus(error) },
          );
        }
      },
    },
    "/api/ui/prompts/permission/:requestId/reply": {
      POST: async (req: Request & { params: { requestId: string } }) => {
        const requestId = req.params.requestId?.trim();
        if (!requestId) {
          return Response.json({ error: "requestId is required" }, { status: 400 });
        }

        const body = (await req.json()) as { reply?: string; message?: unknown };
        const reply = body.reply;
        if (reply !== "once" && reply !== "always" && reply !== "reject") {
          return Response.json({ error: "reply must be one of once, always, reject" }, { status: 400 });
        }
        const message = typeof body.message === "string" ? body.message : undefined;

        try {
          await replyPermissionPrompt({
            requestId,
            reply,
            message,
          });
          return Response.json({ ok: true });
        } catch (error) {
          return Response.json(
            { error: errorMessage(error, "Failed to reply to permission request") },
            { status: errorStatus(error) },
          );
        }
      },
    },
    "/api/ui/prompts/question/:requestId/reply": {
      POST: async (req: Request & { params: { requestId: string } }) => {
        const requestId = req.params.requestId?.trim();
        if (!requestId) {
          return Response.json({ error: "requestId is required" }, { status: 400 });
        }

        const body = (await req.json()) as { answers?: unknown };
        if (!isQuestionAnswers(body.answers)) {
          return Response.json({ error: "answers must be an array of string arrays" }, { status: 400 });
        }

        try {
          await replyQuestionPrompt({ requestId, answers: body.answers });
          return Response.json({ ok: true });
        } catch (error) {
          return Response.json(
            { error: errorMessage(error, "Failed to reply to question request") },
            { status: errorStatus(error) },
          );
        }
      },
    },
    "/api/ui/prompts/question/:requestId/reject": {
      POST: async (req: Request & { params: { requestId: string } }) => {
        const requestId = req.params.requestId?.trim();
        if (!requestId) {
          return Response.json({ error: "requestId is required" }, { status: 400 });
        }
        try {
          await rejectQuestionPrompt({ requestId });
          return Response.json({ ok: true });
        } catch (error) {
          return Response.json(
            { error: errorMessage(error, "Failed to reject question request") },
            { status: errorStatus(error) },
          );
        }
      },
    },
  };
}

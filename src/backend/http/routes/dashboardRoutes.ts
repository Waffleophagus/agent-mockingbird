import { buildWorkspaceBootstrapPromptContext } from "../../agents/bootstrapContext";
import { getOpencodeAgentStorageInfo } from "../../agents/opencodeConfig";
import { applyConfigPatch, ConfigApplyError, getConfigSnapshot } from "../../config/service";
import type { RuntimeEngine } from "../../contracts/runtime";
import {
  createSession,
  getDashboardBootstrap,
  getSessionById,
  listMessagesForSession,
  listSessions,
  setSessionModel,
} from "../../db/repository";
import { listOpencodeModelOptions } from "../../opencode/models";
import { getRuntimeStartupInfo } from "../../runtime";

function parseModelSelection(model: string, defaultProviderId: string) {
  const trimmed = model.trim();
  if (!trimmed) return null;
  if (!trimmed.includes("/")) {
    const providerId = defaultProviderId.trim();
    if (!providerId) return null;
    return { providerId, modelId: trimmed };
  }
  const [providerPart = "", ...rest] = trimmed.split("/");
  const providerId = providerPart.trim();
  const modelId = rest.join("/").trim();
  if (!providerId || !modelId) return null;
  return { providerId, modelId };
}

function toQualifiedModel(providerId: string, modelId: string) {
  const provider = providerId.trim();
  const model = modelId.trim();
  if (!provider || !model) return "";
  return `${provider}/${model}`;
}

function toConfigErrorResponse(error: unknown) {
  if (error instanceof ConfigApplyError) {
    if (error.stage === "conflict") {
      return {
        status: 409,
        body: { error: error.message, stage: error.stage },
      };
    }
    if (error.stage === "request" || error.stage === "schema") {
      return {
        status: 400,
        body: { error: error.message, stage: error.stage, details: error.details },
      };
    }
    if (error.stage === "semantic" || error.stage === "smoke" || error.stage === "policy") {
      return {
        status: 422,
        body: { error: error.message, stage: error.stage, details: error.details },
      };
    }
    return {
      status: 500,
      body: { error: error.message, stage: error.stage },
    };
  }

  return {
    status: 500,
    body: {
      error: error instanceof Error ? error.message : "Failed to update runtime model defaults",
      stage: "unknown",
    },
  };
}

export function createDashboardRoutes(runtime: RuntimeEngine) {
  return {
    "/api/health": () =>
      Response.json({
        status: "ok",
        now: new Date().toISOString(),
      }),

    "/api/dashboard/bootstrap": () => Response.json(getDashboardBootstrap()),

    "/api/runtime/health": {
      GET: async (req: Request) => {
        if (!runtime.checkHealth) {
          return Response.json({ error: "Runtime health checks are not supported by this runtime" }, { status: 501 });
        }

        const force = (() => {
          const value = new URL(req.url).searchParams.get("force");
          if (!value) return false;
          const normalized = value.trim().toLowerCase();
          return normalized === "1" || normalized === "true" || normalized === "yes";
        })();

        try {
          const health = await runtime.checkHealth({ force });
          return Response.json({ health }, { status: health.ok ? 200 : 503 });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Runtime health check failed";
          return Response.json({ error: message }, { status: 503 });
        }
      },
    },

    "/api/runtime/info": {
      GET: () => {
        const runtimeInfo = getRuntimeStartupInfo();
        const storage = getOpencodeAgentStorageInfo();
        const bootstrap = buildWorkspaceBootstrapPromptContext();
        return Response.json({
          opencode: {
            ...runtimeInfo.opencode,
            directory: storage.directory,
            effectiveConfigPath: storage.configFilePath,
            persistenceMode: storage.persistenceMode,
            identity: bootstrap.identity,
            bootstrap: {
              mode: bootstrap.mode,
              files: bootstrap.files.map(file => ({
                name: file.name,
                path: file.path,
                missing: file.missing,
                truncated: file.truncated,
                originalLength: file.originalLength,
                injectedLength: file.content.length,
              })),
            },
          },
        });
      },
    },

    "/api/sessions": {
      GET: () => Response.json({ sessions: listSessions() }),
      POST: async (req: Request) => {
        const body = (await req.json()) as { title?: string; model?: string } | null;
        const session = createSession({
          title: body?.title,
          model: body?.model,
        });
        return Response.json({ session }, { status: 201 });
      },
    },

    "/api/sessions/:id/messages": (req: Request & { params: { id: string } }) => {
      const sessionId = req.params.id;
      const session = getSessionById(sessionId);
      if (!session) {
        return Response.json({ error: "Unknown session" }, { status: 404 });
      }
      return (async () => {
        if (runtime.syncSessionMessages) {
          try {
            await runtime.syncSessionMessages(sessionId);
          } catch {
            // degrade gracefully; return best-effort local transcript
          }
        }
        return Response.json({
          sessionId,
          messages: listMessagesForSession(sessionId),
        });
      })();
    },

    "/api/sessions/:id/model": {
      PUT: async (req: Request & { params: { id: string } }) => {
        const sessionId = req.params.id;
        const body = (await req.json()) as { model?: string };
        const model = body.model?.trim();
        if (!model) {
          return Response.json({ error: "model is required" }, { status: 400 });
        }
        if (!getSessionById(sessionId)) {
          return Response.json({ error: "Unknown session" }, { status: 404 });
        }

        const session = setSessionModel(sessionId, model);
        if (!session) {
          return Response.json({ error: "Unknown session" }, { status: 404 });
        }

        const snapshot = getConfigSnapshot();
        const currentRuntimeDefaultModel = toQualifiedModel(
          snapshot.config.runtime.opencode.providerId,
          snapshot.config.runtime.opencode.modelId,
        );
        const parsed = parseModelSelection(model, snapshot.config.runtime.opencode.providerId);
        if (!parsed) {
          return Response.json({
            session,
            runtimeDefaultModel: currentRuntimeDefaultModel,
            sessionMatchesRuntimeDefault: session.model === currentRuntimeDefaultModel,
          });
        }

        try {
          const configResult = await applyConfigPatch({
            expectedHash: snapshot.hash,
            runSmokeTest: false,
            patch: {
              runtime: {
                opencode: {
                  providerId: parsed.providerId,
                  modelId: parsed.modelId,
                },
              },
            },
          });

          const runtimeDefaultModel = toQualifiedModel(parsed.providerId, parsed.modelId);
          return Response.json({
            session,
            configHash: configResult.snapshot.hash,
            runtimeDefaultModel,
            sessionMatchesRuntimeDefault: session.model === runtimeDefaultModel,
          });
        } catch (error) {
          const details = toConfigErrorResponse(error);
          return Response.json({
            session,
            configError: details.body.error,
            configStage: details.body.stage,
            runtimeDefaultModel: currentRuntimeDefaultModel,
            sessionMatchesRuntimeDefault: session.model === currentRuntimeDefaultModel,
          });
        }
      },
    },

    "/api/runtime/default-model": {
      PUT: async (req: Request) => {
        const body = (await req.json()) as { model?: string };
        const model = body.model?.trim();
        if (!model) {
          return Response.json({ error: "model is required" }, { status: 400 });
        }
        const snapshot = getConfigSnapshot();
        const parsed = parseModelSelection(model, snapshot.config.runtime.opencode.providerId);
        if (!parsed) {
          return Response.json({ error: "Invalid model format" }, { status: 400 });
        }
        try {
          const configResult = await applyConfigPatch({
            expectedHash: snapshot.hash,
            runSmokeTest: false,
            patch: {
              runtime: {
                opencode: {
                  providerId: parsed.providerId,
                  modelId: parsed.modelId,
                },
              },
            },
          });
          const runtimeDefaultModel = toQualifiedModel(parsed.providerId, parsed.modelId);
          return Response.json({
            runtimeDefaultModel,
            configHash: configResult.snapshot.hash,
          });
        } catch (error) {
          const details = toConfigErrorResponse(error);
          return Response.json(
            { error: details.body.error, stage: details.body.stage },
            { status: details.status },
          );
        }
      },
    },

    "/api/opencode/models": {
      GET: async () => {
        try {
          const models = await listOpencodeModelOptions();
          return Response.json({ models });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to load models";
          return Response.json({ models: [], error: message }, { status: 502 });
        }
      },
    },
  };
}

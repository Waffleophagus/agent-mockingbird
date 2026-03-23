import { z } from "zod";

import { migrateOpenclawWorkspace } from "../../agents/openclawImport";
import {
  getOpencodeAgentStorageInfo,
  listOpencodeAgentTypes,
  patchOpencodeAgentTypes,
  validateOpencodeAgentPatch,
} from "../../agents/opencodeConfig";
import {
  getEnabledSkillsFromCatalog,
  importManagedSkillWithConfigUpdate,
  loadRuntimeMcpCatalog,
  loadRuntimeSkillCatalog,
  runRuntimeMcpActionForCurrentConfig,
  setEnabledSkillsFromCatalog,
} from "../../config/orchestration";
import { configuredMcpServerSchema } from "../../config/schema";
import {
  applyConfigPatch,
  applyConfigPatchSafe,
  ConfigApplyError,
  getConfigSnapshot,
  replaceConfig,
  replaceConfigSafe,
  type ApplyConfigResult,
} from "../../config/service";
import { assertExpectedHashMatches } from "../../config/store";
import {
  createConfigRolledBackEvent,
  createConfigUpdateFailedEvent,
  createConfigUpdatedEvent,
  createSkillsCatalogUpdatedEvent,
} from "../../contracts/events";
import {
  loadEffectiveMcpConfig,
  normalizeMcpIds,
  serializeConfiguredMcpServersToOpencodeConfig,
} from "../../mcp/service";
import { syncMemoryIndex } from "../../memory/service";
import { patchManagedOpencodeConfig } from "../../opencode/managedConfig";
import { parseJsonWithSchema, parseStringListBody } from "../parsers";
import type { RuntimeEventStream } from "../sse";

const configPatchRequestSchema = z
  .object({
    patch: z.unknown().optional(),
    expectedHash: z.unknown().optional(),
    runSmokeTest: z.boolean().optional(),
  })
  .strict();

const configReplaceRequestSchema = z
  .object({
    config: z.unknown().optional(),
    expectedHash: z.unknown().optional(),
    runSmokeTest: z.boolean().optional(),
  })
  .passthrough();

const configSkillsBodySchema = z
  .object({
    skills: z.array(z.string()),
    expectedHash: z.unknown().optional(),
  })
  .strict();

const configManagedSkillImportBodySchema = z
  .object({
    id: z.string().optional(),
    content: z.string().optional(),
    enable: z.boolean().optional(),
    expectedHash: z.unknown().optional(),
  })
  .strict();

const configOpenCodeAgentsBodySchema = z
  .object({
    upserts: z.unknown().optional(),
    deletes: z.unknown().optional(),
    expectedHash: z.unknown().optional(),
  })
  .strict();

const configMcpsBodySchema = z
  .object({
    servers: z.array(z.unknown()).optional(),
    mcps: z.array(z.string()).optional(),
    expectedHash: z.unknown().optional(),
  })
  .strict();

function toErrorResponse(error: unknown) {
  if (error instanceof ConfigApplyError) {
    if (error.stage === "conflict") {
      return {
        status: 409,
        body: {
          error: error.message,
          stage: error.stage,
        },
      };
    }
    if (error.stage === "request" || error.stage === "schema") {
      return {
        status: 400,
        body: {
          error: error.message,
          stage: error.stage,
          details: error.details,
        },
      };
    }
    if (error.stage === "semantic" || error.stage === "smoke" || error.stage === "policy") {
      return {
        status: 422,
        body: {
          error: error.message,
          stage: error.stage,
          details: error.details,
        },
      };
    }
    return {
      status: 500,
      body: {
        error: error.message,
        stage: error.stage,
      },
    };
  }

  return {
    status: 500,
    body: {
      error: error instanceof Error ? error.message : "Config update failed",
      stage: "unknown",
    },
  };
}

function configErrorResponse(eventStream: RuntimeEventStream, error: unknown) {
  publishConfigRollbackEvent(eventStream, error);
  publishConfigFailedEvent(eventStream, error);
  const details = toErrorResponse(error);
  return Response.json(details.body, { status: details.status });
}

function publishConfigUpdatedEvent(eventStream: RuntimeEventStream, result: ApplyConfigResult) {
  eventStream.publish(
    createConfigUpdatedEvent(
      {
        hash: result.snapshot.hash,
        path: result.snapshot.path,
        providerCount: result.semantic.providerCount,
        modelCount: result.semantic.modelCount,
        smokeTestSessionId: result.smokeTest?.sessionId ?? null,
        smokeTestResponse: result.smokeTest?.responseText ?? null,
      },
      "api",
    ),
  );
}

function publishConfigFailedEvent(eventStream: RuntimeEventStream, error: unknown) {
  const details = toErrorResponse(error);
  eventStream.publish(
    createConfigUpdateFailedEvent(
      {
        stage: String((details.body as { stage?: unknown }).stage ?? "unknown"),
        message: String((details.body as { error?: unknown }).error ?? "Config update failed"),
      },
      "api",
    ),
  );
}

function publishConfigRollbackEvent(eventStream: RuntimeEventStream, error: unknown) {
  if (!(error instanceof ConfigApplyError)) return;
  if (error.stage !== "smoke" && error.stage !== "rollback") return;
  const details = (error.details ?? {}) as Record<string, unknown>;
  if (details.rolledBack !== true && error.stage !== "rollback") return;
  eventStream.publish(
    createConfigRolledBackEvent(
      {
        attemptedHash: typeof details.attemptedHash === "string" ? details.attemptedHash : null,
        restoredHash: typeof details.restoredHash === "string" ? details.restoredHash : null,
        message: error.message,
      },
      "api",
    ),
  );
}

async function respondWithConfigMutation(
  eventStream: RuntimeEventStream,
  run: () => Promise<ApplyConfigResult>,
  onSuccess: (result: ApplyConfigResult) => Response,
) {
  try {
    const result = await run();
    publishConfigUpdatedEvent(eventStream, result);
    return onSuccess(result);
  } catch (error) {
    return configErrorResponse(eventStream, error);
  }
}

function publishSkillsCatalogUpdated(eventStream: RuntimeEventStream, revision: string) {
  eventStream.publish(createSkillsCatalogUpdatedEvent({ revision }, "api"));
}

async function buildConfigPayload() {
  const snapshot = getConfigSnapshot();
  return {
    ...snapshot,
    effective: {
      mcp: await loadEffectiveMcpConfig(snapshot.config, { includeStatus: true }),
    },
  };
}

async function applyMcpConfigUpdate(eventStream: RuntimeEventStream, req: Request) {
  const parsedBody = await parseJsonWithSchema(req, configMcpsBodySchema);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }
  const body = parsedBody.body;
  const parsedServers = z.array(configuredMcpServerSchema).safeParse(body.servers);
  if (parsedServers.success) {
    const servers = parsedServers.data;
    const snapshot = getConfigSnapshot();
    try {
      assertExpectedHashMatches(
        snapshot.hash,
        typeof body.expectedHash === "string" ? body.expectedHash : undefined,
      );
      await patchManagedOpencodeConfig(snapshot.config, {
        mcp: serializeConfiguredMcpServersToOpencodeConfig(servers),
      });
      const effective = await loadEffectiveMcpConfig(snapshot.config, { includeStatus: true });
      return Response.json({
        mcps: effective.enabled,
        servers: effective.servers,
        status: effective.status ?? [],
        source: effective.source,
        ...(effective.statusError ? { statusError: effective.statusError } : {}),
        hash: snapshot.hash,
      });
    } catch (error) {
      return configErrorResponse(eventStream, error);
    }
  }

  const values = parseStringListBody(body, "mcps");
  if (!values) {
    return Response.json({ error: "mcps must be a string array or servers must be a valid MCP config array" }, { status: 400 });
  }

  const current = getConfigSnapshot();
  try {
    assertExpectedHashMatches(
      current.hash,
      typeof body.expectedHash === "string" ? body.expectedHash : undefined,
    );
    const effective = await loadEffectiveMcpConfig(current.config);
    const enabled = new Set(normalizeMcpIds(values));
    const updatedServers = effective.servers.map(server => ({
      ...server,
      enabled: enabled.has(server.id),
    }));
    await patchManagedOpencodeConfig(current.config, {
      mcp: serializeConfiguredMcpServersToOpencodeConfig(updatedServers),
    });
    const nextEffective = await loadEffectiveMcpConfig(current.config, { includeStatus: true });
    return Response.json({
      mcps: nextEffective.enabled,
      servers: nextEffective.servers,
      status: nextEffective.status ?? [],
      source: nextEffective.source,
      ...(nextEffective.statusError ? { statusError: nextEffective.statusError } : {}),
      hash: current.hash,
    });
  } catch (error) {
    return configErrorResponse(eventStream, error);
  }
}

async function getOpencodeAgents() {
  try {
    const payload = await listOpencodeAgentTypes();
    return Response.json({
      agentTypes: payload.agentTypes,
      hash: payload.hash,
      storage: payload.storage,
      source: "opencode",
    });
  } catch (error) {
    const storage = getOpencodeAgentStorageInfo();
    const message = error instanceof Error ? error.message : "Failed to load OpenCode agent definitions";
    return Response.json(
      {
        agentTypes: [],
        hash: "",
        storage,
        source: "opencode",
        error: message,
      },
      { status: 502 },
    );
  }
}

async function runMcpAction(
  req: Request & { params: { id: string } },
  action: "connect" | "disconnect" | "authStart" | "authRemove",
) {
  const id = req.params.id.trim();
  if (!id) {
    return Response.json({ error: "MCP id is required" }, { status: 400 });
  }

  try {
    const result = await runRuntimeMcpActionForCurrentConfig(id, action);
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : `Failed to ${action} MCP server ${id}` },
      { status: 502 },
    );
  }
}

async function importManagedSkill(eventStream: RuntimeEventStream, req: Request) {
  const parsedBody = await parseJsonWithSchema(req, configManagedSkillImportBodySchema);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }
  const body = parsedBody.body;
  const rawId = typeof body.id === "string" ? body.id : "";
  const content = typeof body.content === "string" ? body.content : "";
  const enable = typeof body.enable === "boolean" ? body.enable : true;

  try {
    const imported = await importManagedSkillWithConfigUpdate({
      rawId,
      content,
      enable,
      expectedHash: typeof body.expectedHash === "string" ? body.expectedHash : undefined,
    });
    publishSkillsCatalogUpdated(eventStream, imported.hash);

    return Response.json({
      imported: {
        id: imported.imported.id,
        filePath: imported.imported.filePath,
      },
      skills: imported.skills,
      hash: imported.hash,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("catalog has changed")) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof Error && error.message.includes("already exists")) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof Error && error.message.includes("skill id")) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return configErrorResponse(eventStream, error);
  }
}

const openclawImportSchema = z.object({
  source: z.discriminatedUnion("mode", [
    z.object({
      mode: z.literal("local"),
      path: z.string().min(1),
    }),
    z.object({
      mode: z.literal("git"),
      url: z.string().min(1),
      ref: z.string().optional(),
    }),
  ]),
  targetDirectory: z.string().optional(),
});

async function importOpenclawBootstrap(req: Request) {
  const parsedBody = await parseJsonWithSchema(req, z.record(z.string(), z.unknown()));
  if (!parsedBody.ok) {
    return parsedBody.response;
  }
  const body = parsedBody.body;
  let source: { mode: "local"; path: string } | { mode: "git"; url: string; ref?: string };
  let targetDirectory: string | undefined;

  if (body.source && typeof body.source === "object") {
    const parsed = openclawImportSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        {
          error: "Invalid import request",
          issues: parsed.error.issues.map(issue => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 },
      );
    }
    source = parsed.data.source;
    targetDirectory = parsed.data.targetDirectory;
  } else {
    const sourceDirectory = typeof body.sourceDirectory === "string" ? body.sourceDirectory.trim() : "";
    if (!sourceDirectory) {
      return Response.json({ error: "source.path or sourceDirectory is required" }, { status: 400 });
    }
    source = { mode: "local", path: sourceDirectory };
  }

  try {
    const migration = await migrateOpenclawWorkspace({
      source:
        source.mode === "local"
          ? { mode: "local", path: source.path }
          : { mode: "git", url: source.url, ref: source.ref },
      targetDirectory,
    });
    let memorySync: { attempted: boolean; completed: boolean; error?: string | null } = {
      attempted: false,
      completed: false,
      error: null,
    };
    try {
      await syncMemoryIndex();
      memorySync = { attempted: true, completed: true, error: null };
    } catch (error) {
      memorySync = {
        attempted: true,
        completed: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    return Response.json({ migration, memorySync });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to import OpenClaw workspace files";
    return Response.json({ error: message }, { status: 422 });
  }
}

export function createConfigRoutes(eventStream: RuntimeEventStream) {
  return {
    "/api/config": {
      GET: async () => Response.json(await buildConfigPayload()),
      PATCH: async (req: Request) => {
        const parsedBody = await parseJsonWithSchema(req, configPatchRequestSchema);
        if (!parsedBody.ok) {
          return parsedBody.response;
        }
        const body = parsedBody.body;
        return respondWithConfigMutation(
          eventStream,
          () =>
            applyConfigPatch({
              patch: body.patch,
              expectedHash: typeof body.expectedHash === "string" ? body.expectedHash : undefined,
              runSmokeTest: typeof body.runSmokeTest === "boolean" ? body.runSmokeTest : true,
            }),
          result => Response.json(result),
        );
      },
      PUT: async (req: Request) => {
        const parsedBody = await parseJsonWithSchema(req, configReplaceRequestSchema);
        if (!parsedBody.ok) {
          return parsedBody.response;
        }
        const body = parsedBody.body;
        return respondWithConfigMutation(
          eventStream,
          () =>
            replaceConfig({
              config: typeof body === "object" && body !== null && "config" in body ? body.config : body,
              expectedHash: typeof body.expectedHash === "string" ? body.expectedHash : undefined,
              runSmokeTest: typeof body.runSmokeTest === "boolean" ? body.runSmokeTest : true,
            }),
          result => Response.json(result),
        );
      },
    },

    "/api/config/patch-safe": {
      POST: async (req: Request) => {
        const parsedBody = await parseJsonWithSchema(req, configPatchRequestSchema);
        if (!parsedBody.ok) {
          return parsedBody.response;
        }
        const body = parsedBody.body;
        return respondWithConfigMutation(
          eventStream,
          () =>
            applyConfigPatchSafe({
              patch: body.patch,
              expectedHash: typeof body.expectedHash === "string" ? body.expectedHash : undefined,
              runSmokeTest: typeof body.runSmokeTest === "boolean" ? body.runSmokeTest : true,
            }),
          result => Response.json(result),
        );
      },
    },

    "/api/config/replace-safe": {
      POST: async (req: Request) => {
        const parsedBody = await parseJsonWithSchema(req, configReplaceRequestSchema);
        if (!parsedBody.ok) {
          return parsedBody.response;
        }
        const body = parsedBody.body;
        return respondWithConfigMutation(
          eventStream,
          () =>
            replaceConfigSafe({
              config: body.config,
              expectedHash: typeof body.expectedHash === "string" ? body.expectedHash : undefined,
              runSmokeTest: typeof body.runSmokeTest === "boolean" ? body.runSmokeTest : true,
            }),
          result => Response.json(result),
        );
      },
    },

    "/api/config/skills": {
      GET: () => {
        const current = getEnabledSkillsFromCatalog();
        return Response.json({
          skills: current.skills,
          hash: current.hash,
          managedPath: current.managedPath,
          disabledPath: current.disabledPath,
        });
      },
      PUT: async (req: Request) => {
        const parsedBody = await parseJsonWithSchema(req, configSkillsBodySchema);
        if (!parsedBody.ok) {
          return parsedBody.response;
        }
        const body = parsedBody.body;
        try {
          const result = await setEnabledSkillsFromCatalog({
            skills: body.skills,
            expectedHash: typeof body.expectedHash === "string" ? body.expectedHash : undefined,
          });
          publishSkillsCatalogUpdated(eventStream, result.hash);
          return Response.json(result);
        } catch (error) {
          if (error instanceof Error && error.message.includes("catalog has changed")) {
            return Response.json({ error: error.message }, { status: 409 });
          }
          return Response.json({ error: error instanceof Error ? error.message : "Failed to update skills" }, { status: 500 });
        }
      },
    },

    "/api/config/skills/catalog": {
      GET: async () => {
        const result = await loadRuntimeSkillCatalog();
        return Response.json(result.payload, { status: result.status });
      },
    },

    "/api/config/skills/import": {
      POST: async (req: Request) => importManagedSkill(eventStream, req),
    },

    "/api/config/opencode/bootstrap/import-openclaw": {
      POST: async (req: Request) => importOpenclawBootstrap(req),
    },

    "/api/config/mcps": {
      GET: async () => {
        const snapshot = getConfigSnapshot();
        const effective = await loadEffectiveMcpConfig(snapshot.config, { includeStatus: true });
        return Response.json({
          mcps: effective.enabled,
          servers: effective.servers,
          status: effective.status ?? [],
          source: effective.source,
          ...(effective.statusError ? { statusError: effective.statusError } : {}),
          hash: snapshot.hash,
        });
      },
      PUT: async (req: Request) => applyMcpConfigUpdate(eventStream, req),
    },

    "/api/config/mcps/catalog": {
      GET: async () => {
        const result = await loadRuntimeMcpCatalog();
        return Response.json(result.payload, { status: result.status });
      },
    },

    "/api/config/mcps/:id/connect": {
      POST: async (req: Request & { params: { id: string } }) => runMcpAction(req, "connect"),
    },

    "/api/config/mcps/:id/disconnect": {
      POST: async (req: Request & { params: { id: string } }) => runMcpAction(req, "disconnect"),
    },

    "/api/config/mcps/:id/auth/start": {
      POST: async (req: Request & { params: { id: string } }) => runMcpAction(req, "authStart"),
    },

    "/api/config/mcps/:id/auth/remove": {
      POST: async (req: Request & { params: { id: string } }) => runMcpAction(req, "authRemove"),
    },

    "/api/opencode/agents": {
      GET: async () => getOpencodeAgents(),
      PATCH: async (req: Request) => {
        const parsedBody = await parseJsonWithSchema(req, configOpenCodeAgentsBodySchema);
        if (!parsedBody.ok) {
          return parsedBody.response;
        }
        const body = parsedBody.body;
        const expectedHash = typeof body.expectedHash === "string" ? body.expectedHash.trim() : "";
        if (!expectedHash) {
          return Response.json({ error: "expectedHash is required" }, { status: 400 });
        }
        const validation = await validateOpencodeAgentPatch({
          upserts: body.upserts,
          deletes: body.deletes,
        });
        if (!validation.ok) {
          return Response.json(
            {
              error: "Agent patch validation failed",
              issues: validation.issues,
              warnings: validation.warnings,
            },
            { status: 400 },
          );
        }
        try {
          const result = await patchOpencodeAgentTypes({
            upserts: validation.normalized.upserts,
            deletes: validation.normalized.deletes,
            expectedHash,
          });
          if (!result.ok) {
            return Response.json(
              {
                error: result.error,
                hash: result.currentHash,
              },
              { status: result.status },
            );
          }
          return Response.json({
            agentTypes: result.agentTypes,
            hash: result.hash,
            storage: result.storage,
            applied: result.applied,
          });
        } catch (error) {
          return Response.json(
            {
              error: error instanceof Error ? error.message : "Failed to update OpenCode agent definitions",
            },
            { status: 502 },
          );
        }
      },
    },

    "/api/opencode/agents/validate": {
      POST: async (req: Request) => {
        const parsedBody = await parseJsonWithSchema(req, configOpenCodeAgentsBodySchema);
        if (!parsedBody.ok) {
          return parsedBody.response;
        }
        const body = parsedBody.body;
        const validation = await validateOpencodeAgentPatch({
          upserts: body.upserts,
          deletes: body.deletes,
        });
        return Response.json(validation);
      },
    },
  };
}

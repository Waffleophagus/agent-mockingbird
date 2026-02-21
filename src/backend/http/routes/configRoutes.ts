import { z } from "zod";

import {
  listRuntimeAgents,
  normalizeConfiguredAgentTypes,
  resolveConfiguredAgentIds,
  resolveConfiguredAgentTypesFromLegacyAgents,
  toLegacySpecialistAgent,
} from "../../agents/service";
import { agentTypeDefinitionSchema, configuredMcpServerSchema, specialistAgentSchema } from "../../config/schema";
import {
  applyConfigPatch,
  applyConfigPatchSafe,
  ConfigApplyError,
  getConfigSnapshot,
  replaceConfig,
  replaceConfigSafe,
  type ApplyConfigResult,
} from "../../config/service";
import {
  createConfigRolledBackEvent,
  createConfigUpdateFailedEvent,
  createConfigUpdatedEvent,
} from "../../contracts/events";
import {
  connectRuntimeMcp,
  disconnectRuntimeMcp,
  listRuntimeMcps,
  normalizeMcpIds,
  removeRuntimeMcpAuth,
  resolveConfiguredMcpIds,
  resolveConfiguredMcpServers,
  startRuntimeMcpAuth,
} from "../../mcp/service";
import {
  getManagedSkillsRootPath,
  listRuntimeSkills,
  normalizeSkillId,
  removeManagedSkill,
  writeManagedSkill,
} from "../../skills/service";
import { parseStringListBody } from "../parsers";
import type { RuntimeEventStream } from "../sse";

type ConfigStringListField = "skills" | "mcps";

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

async function applyStringListUpdate(
  eventStream: RuntimeEventStream,
  req: Request,
  field: ConfigStringListField,
) {
  const body = (await req.json()) as Record<string, unknown>;
  const values = parseStringListBody(body, field);
  if (!values) {
    return Response.json({ error: `${field} must be a string array` }, { status: 400 });
  }

  try {
    const result = await applyConfigPatch({
      patch: { ui: { [field]: values } },
      expectedHash: typeof body.expectedHash === "string" ? body.expectedHash : undefined,
      runSmokeTest: true,
    });
    publishConfigUpdatedEvent(eventStream, result);
    return Response.json({
      [field]: result.snapshot.config.ui[field],
      hash: result.snapshot.hash,
      smokeTest: result.smokeTest,
    });
  } catch (error) {
    return configErrorResponse(eventStream, error);
  }
}

async function applyMcpConfigUpdate(eventStream: RuntimeEventStream, req: Request) {
  const body = (await req.json()) as Record<string, unknown>;
  const parsedServers = z.array(configuredMcpServerSchema).safeParse(body.servers);
  if (parsedServers.success) {
    const servers = parsedServers.data;
    const enabledIds = normalizeMcpIds(servers.filter(server => server.enabled).map(server => server.id));
    try {
      const result = await applyConfigPatch({
        patch: { ui: { mcpServers: servers, mcps: enabledIds } },
        expectedHash: typeof body.expectedHash === "string" ? body.expectedHash : undefined,
        runSmokeTest: true,
      });
      publishConfigUpdatedEvent(eventStream, result);
      return Response.json({
        mcps: resolveConfiguredMcpIds(result.snapshot.config),
        servers: resolveConfiguredMcpServers(result.snapshot.config),
        hash: result.snapshot.hash,
        smokeTest: result.smokeTest,
      });
    } catch (error) {
      return configErrorResponse(eventStream, error);
    }
  }

  const values = parseStringListBody(body, "mcps");
  if (!values) {
    return Response.json({ error: "mcps must be a string array or servers must be a valid MCP config array" }, { status: 400 });
  }

  try {
    const current = getConfigSnapshot();
    const enabled = new Set(values);
    const updatedServers = current.config.ui.mcpServers.map(server => ({
      ...server,
      enabled: enabled.has(server.id),
    }));
    const result = await applyConfigPatch({
      patch: { ui: { mcps: values, mcpServers: updatedServers } },
      expectedHash: typeof body.expectedHash === "string" ? body.expectedHash : undefined,
      runSmokeTest: true,
    });
    publishConfigUpdatedEvent(eventStream, result);
    return Response.json({
      mcps: resolveConfiguredMcpIds(result.snapshot.config),
      servers: resolveConfiguredMcpServers(result.snapshot.config),
      hash: result.snapshot.hash,
      smokeTest: result.smokeTest,
    });
  } catch (error) {
    return configErrorResponse(eventStream, error);
  }
}

async function applyAgentsUpdate(eventStream: RuntimeEventStream, req: Request) {
  const body = (await req.json()) as Record<string, unknown>;
  const parsedAgents = z.array(specialistAgentSchema).safeParse(body.agents);
  if (!parsedAgents.success) {
    return Response.json(
      {
        error: "agents must be a valid agent config array",
        details: parsedAgents.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    const agentTypes = resolveConfiguredAgentTypesFromLegacyAgents(parsedAgents.data);
    const result = await applyConfigPatch({
      patch: { ui: { agents: parsedAgents.data, agentTypes } },
      expectedHash: typeof body.expectedHash === "string" ? body.expectedHash : undefined,
      runSmokeTest: typeof body.runSmokeTest === "boolean" ? body.runSmokeTest : true,
    });
    publishConfigUpdatedEvent(eventStream, result);
    return Response.json({
      agents: result.snapshot.config.ui.agents,
      hash: result.snapshot.hash,
      smokeTest: result.smokeTest,
    });
  } catch (error) {
    return configErrorResponse(eventStream, error);
  }
}

async function applyAgentTypesUpdate(eventStream: RuntimeEventStream, req: Request) {
  const body = (await req.json()) as Record<string, unknown>;
  const parsedAgentTypes = z.array(agentTypeDefinitionSchema).safeParse(body.agentTypes);
  if (!parsedAgentTypes.success) {
    return Response.json(
      {
        error: "agentTypes must be a valid agent type config array",
        details: parsedAgentTypes.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    const normalized = normalizeConfiguredAgentTypes(parsedAgentTypes.data);
    const result = await applyConfigPatch({
      patch: { ui: { agentTypes: normalized } },
      expectedHash: typeof body.expectedHash === "string" ? body.expectedHash : undefined,
      runSmokeTest: typeof body.runSmokeTest === "boolean" ? body.runSmokeTest : true,
    });
    publishConfigUpdatedEvent(eventStream, result);
    return Response.json({
      agentTypes: result.snapshot.config.ui.agentTypes,
      hash: result.snapshot.hash,
      smokeTest: result.smokeTest,
    });
  } catch (error) {
    return configErrorResponse(eventStream, error);
  }
}

function toLegacyAgentsForResponse() {
  const snapshot = getConfigSnapshot();
  const hasLegacyConfiguredAgents = snapshot.config.ui.agents.length > 0;
  const legacyAgents = hasLegacyConfiguredAgents
    ? snapshot.config.ui.agents
    : snapshot.config.ui.agentTypes.map(toLegacySpecialistAgent);
  return { agents: legacyAgents, hash: snapshot.hash };
}

async function getSkillCatalog() {
  const snapshot = getConfigSnapshot();
  try {
    const skills = await listRuntimeSkills(snapshot.config, snapshot.config.ui.skills);
    return Response.json({
      skills,
      enabled: snapshot.config.ui.skills,
      hash: snapshot.hash,
      managedPath: getManagedSkillsRootPath(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load runtime skills";
    return Response.json(
      {
        skills: [],
        enabled: snapshot.config.ui.skills,
        hash: snapshot.hash,
        managedPath: getManagedSkillsRootPath(),
        error: message,
      },
      { status: 502 },
    );
  }
}

async function getMcpCatalog() {
  const snapshot = getConfigSnapshot();
  try {
    const mcps = await listRuntimeMcps(snapshot.config);
    return Response.json({
      mcps,
      enabled: resolveConfiguredMcpIds(snapshot.config),
      servers: resolveConfiguredMcpServers(snapshot.config),
      hash: snapshot.hash,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load runtime MCP servers";
    return Response.json(
      {
        mcps: resolveConfiguredMcpIds(snapshot.config).map(id => ({
          id,
          enabled: true,
          status: "unknown",
        })),
        enabled: resolveConfiguredMcpIds(snapshot.config),
        servers: resolveConfiguredMcpServers(snapshot.config),
        hash: snapshot.hash,
        error: message,
      },
      { status: 502 },
    );
  }
}

async function getAgentCatalog() {
  const snapshot = getConfigSnapshot();
  try {
    const agents = await listRuntimeAgents(snapshot.config);
    return Response.json({
      agents,
      configured: resolveConfiguredAgentIds(snapshot.config),
      hash: snapshot.hash,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load runtime agents";
    return Response.json(
      {
        agents: [],
        configured: resolveConfiguredAgentIds(snapshot.config),
        hash: snapshot.hash,
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

  const snapshot = getConfigSnapshot();
  try {
    if (action === "connect") {
      const connected = await connectRuntimeMcp(snapshot.config, id);
      const mcps = await listRuntimeMcps(snapshot.config);
      return Response.json({ id, connected, mcps, hash: snapshot.hash });
    }
    if (action === "disconnect") {
      const disconnected = await disconnectRuntimeMcp(snapshot.config, id);
      const mcps = await listRuntimeMcps(snapshot.config);
      return Response.json({ id, disconnected, mcps, hash: snapshot.hash });
    }
    if (action === "authStart") {
      const authorizationUrl = await startRuntimeMcpAuth(snapshot.config, id);
      const mcps = await listRuntimeMcps(snapshot.config);
      return Response.json({ id, authorizationUrl, mcps, hash: snapshot.hash });
    }
    const authRemoved = await removeRuntimeMcpAuth(snapshot.config, id);
    const mcps = await listRuntimeMcps(snapshot.config);
    return Response.json({ id, authRemoved, mcps, hash: snapshot.hash });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : `Failed to ${action} MCP server ${id}` },
      { status: 502 },
    );
  }
}

async function importManagedSkill(eventStream: RuntimeEventStream, req: Request) {
  const body = (await req.json()) as Record<string, unknown>;
  const rawId = typeof body.id === "string" ? body.id : "";
  const content = typeof body.content === "string" ? body.content : "";
  const enable = typeof body.enable === "boolean" ? body.enable : true;
  const runSmokeTest = typeof body.runSmokeTest === "boolean" ? body.runSmokeTest : true;

  let id = "";
  try {
    id = normalizeSkillId(rawId);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "invalid skill id" }, { status: 400 });
  }
  if (!content.trim()) {
    return Response.json({ error: "skill content is required" }, { status: 400 });
  }

  let created = false;
  let filePath = "";
  try {
    const writeResult = writeManagedSkill({
      id,
      content,
      overwrite: false,
    });
    created = writeResult.created;
    filePath = writeResult.filePath;

    const current = getConfigSnapshot();
    const enabledSkills = new Set(current.config.ui.skills);
    if (enable) {
      enabledSkills.add(id);
    }

    const result = await applyConfigPatch({
      patch: {
        ui: {
          skills: [...enabledSkills],
        },
      },
      expectedHash: typeof body.expectedHash === "string" ? body.expectedHash : undefined,
      runSmokeTest,
    });
    publishConfigUpdatedEvent(eventStream, result);

    return Response.json({
      imported: {
        id,
        filePath,
      },
      skills: result.snapshot.config.ui.skills,
      hash: result.snapshot.hash,
      smokeTest: result.smokeTest,
    });
  } catch (error) {
    if (created) {
      removeManagedSkill(id);
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

export function createConfigRoutes(eventStream: RuntimeEventStream) {
  return {
    "/api/config": {
      GET: () => {
        const snapshot = getConfigSnapshot();
        return Response.json(snapshot);
      },
      PATCH: async (req: Request) => {
        const body = (await req.json()) as {
          patch?: unknown;
          expectedHash?: unknown;
          runSmokeTest?: unknown;
        };
        try {
          const result = await applyConfigPatch({
            patch: body.patch,
            expectedHash: typeof body.expectedHash === "string" ? body.expectedHash : undefined,
            runSmokeTest: typeof body.runSmokeTest === "boolean" ? body.runSmokeTest : true,
          });
          publishConfigUpdatedEvent(eventStream, result);
          return Response.json(result);
        } catch (error) {
          return configErrorResponse(eventStream, error);
        }
      },
      PUT: async (req: Request) => {
        const body = (await req.json()) as {
          config?: unknown;
          expectedHash?: unknown;
          runSmokeTest?: unknown;
        };
        try {
          const result = await replaceConfig({
            config: typeof body === "object" && body !== null && "config" in body ? body.config : body,
            expectedHash: typeof body.expectedHash === "string" ? body.expectedHash : undefined,
            runSmokeTest: typeof body.runSmokeTest === "boolean" ? body.runSmokeTest : true,
          });
          publishConfigUpdatedEvent(eventStream, result);
          return Response.json(result);
        } catch (error) {
          return configErrorResponse(eventStream, error);
        }
      },
    },

    "/api/config/patch-safe": {
      POST: async (req: Request) => {
        const body = (await req.json()) as {
          patch?: unknown;
          expectedHash?: unknown;
          runSmokeTest?: unknown;
        };
        try {
          const result = await applyConfigPatchSafe({
            patch: body.patch,
            expectedHash: typeof body.expectedHash === "string" ? body.expectedHash : undefined,
            runSmokeTest: typeof body.runSmokeTest === "boolean" ? body.runSmokeTest : true,
          });
          publishConfigUpdatedEvent(eventStream, result);
          return Response.json(result);
        } catch (error) {
          return configErrorResponse(eventStream, error);
        }
      },
    },

    "/api/config/replace-safe": {
      POST: async (req: Request) => {
        const body = (await req.json()) as {
          config?: unknown;
          expectedHash?: unknown;
          runSmokeTest?: unknown;
        };
        try {
          const result = await replaceConfigSafe({
            config: body.config,
            expectedHash: typeof body.expectedHash === "string" ? body.expectedHash : undefined,
            runSmokeTest: typeof body.runSmokeTest === "boolean" ? body.runSmokeTest : true,
          });
          publishConfigUpdatedEvent(eventStream, result);
          return Response.json(result);
        } catch (error) {
          return configErrorResponse(eventStream, error);
        }
      },
    },

    "/api/config/skills": {
      GET: () => {
        const snapshot = getConfigSnapshot();
        return Response.json({ skills: snapshot.config.ui.skills, hash: snapshot.hash });
      },
      PUT: async (req: Request) => applyStringListUpdate(eventStream, req, "skills"),
    },

    "/api/config/skills/catalog": {
      GET: async () => getSkillCatalog(),
    },

    "/api/config/skills/import": {
      POST: async (req: Request) => importManagedSkill(eventStream, req),
    },

    "/api/config/mcps": {
      GET: () => {
        const snapshot = getConfigSnapshot();
        return Response.json({
          mcps: resolveConfiguredMcpIds(snapshot.config),
          servers: resolveConfiguredMcpServers(snapshot.config),
          hash: snapshot.hash,
        });
      },
      PUT: async (req: Request) => applyMcpConfigUpdate(eventStream, req),
    },

    "/api/config/mcps/catalog": {
      GET: async () => getMcpCatalog(),
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

    "/api/config/agents": {
      GET: () => Response.json(toLegacyAgentsForResponse()),
      PUT: async (req: Request) => applyAgentsUpdate(eventStream, req),
    },

    "/api/config/agents/catalog": {
      GET: async () => getAgentCatalog(),
    },

    "/api/config/agent-types": {
      GET: () => {
        const snapshot = getConfigSnapshot();
        return Response.json({ agentTypes: snapshot.config.ui.agentTypes, hash: snapshot.hash });
      },
      PUT: async (req: Request) => applyAgentTypesUpdate(eventStream, req),
    },

    "/api/config/agent-types/catalog": {
      GET: async () => getAgentCatalog(),
    },
  };
}

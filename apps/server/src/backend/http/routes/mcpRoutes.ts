import type { Config as OpencodeConfig } from "@opencode-ai/sdk/client";
import { z } from "zod";

import { configuredMcpServerSchema } from "../../config/schema";
import { getConfigSnapshot } from "../../config/service";
import {
  readConfiguredMcpServersFromOpencodeConfig,
  serializeConfiguredMcpServersToOpencodeConfig,
} from "../../mcp/service";
import {
  createOpencodeClientFromConnection,
  createOpencodeV2ClientFromConnection,
  unwrapSdkData,
} from "../../opencode/client";
import { patchManagedOpencodeConfig } from "../../opencode/managedConfig";
import { resolveOpencodeConfigDir } from "../../workspace/resolve";
import { parseJsonWithSchema } from "../parsers";

const mcpServersBodySchema = z
  .object({
    servers: z.array(z.unknown()),
  })
  .strict();

function getConnectionConfig() {
  const snapshot = getConfigSnapshot();
  let directory: string | undefined;
  try {
    directory = resolveOpencodeConfigDir(snapshot.config);
  } catch {
    directory =
      snapshot.config.runtime.opencode.directory || snapshot.config.workspace.pinnedDirectory;
  }
  return {
    baseUrl: snapshot.config.runtime.opencode.baseUrl,
    directory,
    timeoutMs: snapshot.config.runtime.opencode.timeoutMs,
  };
}

async function loadOpencodeConfig() {
  const connection = getConnectionConfig();
  const client = createOpencodeClientFromConnection(connection);
  return unwrapSdkData<OpencodeConfig>(
    await client.config.get({
      responseStyle: "data",
      throwOnError: true,
      signal: AbortSignal.timeout(connection.timeoutMs),
    }),
  );
}

export async function persistMcpServers(servers: Array<ReturnType<typeof configuredMcpServerSchema.parse>>) {
  const snapshot = getConfigSnapshot();
  await patchManagedOpencodeConfig(snapshot.config, {
    mcp: serializeConfiguredMcpServersToOpencodeConfig(servers),
  });
}

function normalizeServers(config: OpencodeConfig) {
  return readConfiguredMcpServersFromOpencodeConfig(config);
}

async function loadStatuses() {
  const connection = getConnectionConfig();
  const client = createOpencodeV2ClientFromConnection(connection);
  return unwrapSdkData<Record<string, unknown>>(
    await client.mcp.status(undefined, {
      responseStyle: "data",
      throwOnError: true,
      signal: AbortSignal.timeout(connection.timeoutMs),
    }),
  );
}

export function createMcpRoutes() {
  return {
    "/api/mockingbird/mcp": {
      GET: async () => {
        try {
          const config = await loadOpencodeConfig();
          const servers = normalizeServers(config);
          const status = await loadStatuses().catch(() => ({}));
          return Response.json({ servers, status });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to load MCP config";
          return Response.json({ error: message }, { status: 502 });
        }
      },
      PUT: async (req: Request) => {
        const parsedBody = await parseJsonWithSchema(req, mcpServersBodySchema);
        if (!parsedBody.ok) {
          return parsedBody.response;
        }
        const body = parsedBody.body;
        const parsedServers = [];
        for (const server of body.servers) {
          const parsed = configuredMcpServerSchema.safeParse(server);
          if (!parsed.success) {
            return Response.json(
              { error: parsed.error.issues[0]?.message ?? "Invalid MCP server definition" },
              { status: 400 },
            );
          }
          parsedServers.push(parsed.data);
        }
        try {
          await persistMcpServers(parsedServers);
          const config = await loadOpencodeConfig();
          return Response.json({ servers: normalizeServers(config), status: await loadStatuses().catch(() => ({})) });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to persist MCP config";
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },

    "/api/mockingbird/mcp/:id/connect": {
      POST: async (req: Request & { params: { id: string } }) => {
        try {
          const connection = getConnectionConfig();
          const client = createOpencodeV2ClientFromConnection(connection);
          const connected = unwrapSdkData<boolean>(
            await client.mcp.connect(
              { name: req.params.id },
              {
                responseStyle: "data",
                throwOnError: true,
                signal: AbortSignal.timeout(connection.timeoutMs),
              },
            ),
          );
          return Response.json({ connected, status: await loadStatuses().catch(() => ({})) });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to connect MCP server";
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },

    "/api/mockingbird/mcp/:id/disconnect": {
      POST: async (req: Request & { params: { id: string } }) => {
        try {
          const connection = getConnectionConfig();
          const client = createOpencodeV2ClientFromConnection(connection);
          const disconnected = unwrapSdkData<boolean>(
            await client.mcp.disconnect(
              { name: req.params.id },
              {
                responseStyle: "data",
                throwOnError: true,
                signal: AbortSignal.timeout(connection.timeoutMs),
              },
            ),
          );
          return Response.json({ disconnected, status: await loadStatuses().catch(() => ({})) });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to disconnect MCP server";
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },

    "/api/mockingbird/mcp/:id/auth/start": {
      POST: async (req: Request & { params: { id: string } }) => {
        try {
          const connection = getConnectionConfig();
          const client = createOpencodeV2ClientFromConnection(connection);
          const authorization = unwrapSdkData<{ authorizationUrl: string }>(
            await client.mcp.auth.start(
              { name: req.params.id },
              {
                responseStyle: "data",
                throwOnError: true,
                signal: AbortSignal.timeout(connection.timeoutMs),
              },
            ),
          );
          return Response.json(authorization);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to start MCP auth";
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },

    "/api/mockingbird/mcp/:id/auth/remove": {
      POST: async (req: Request & { params: { id: string } }) => {
        try {
          const connection = getConnectionConfig();
          const client = createOpencodeV2ClientFromConnection(connection);
          const result = unwrapSdkData<{ success: true }>(
            await client.mcp.auth.remove(
              { name: req.params.id },
              {
                responseStyle: "data",
                throwOnError: true,
                signal: AbortSignal.timeout(connection.timeoutMs),
              },
            ),
          );
          return Response.json(result);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to remove MCP auth";
          return Response.json({ error: message }, { status: 502 });
        }
      },
    },
  };
}

import type { Config as OpencodeConfig } from "@opencode-ai/sdk/client";

import { configuredMcpServerSchema } from "../../config/schema";
import { getConfigSnapshot } from "../../config/service";
import {
  createOpencodeClientFromConnection,
  createOpencodeV2ClientFromConnection,
  unwrapSdkData,
} from "../../opencode/client";

function getConnectionConfig() {
  const snapshot = getConfigSnapshot();
  return {
    baseUrl: snapshot.config.runtime.opencode.baseUrl,
    directory: snapshot.config.workspace.pinnedDirectory,
    timeoutMs: snapshot.config.runtime.opencode.timeoutMs,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

async function persistMcpServers(servers: Array<ReturnType<typeof configuredMcpServerSchema.parse>>) {
  const connection = getConnectionConfig();
  const client = createOpencodeClientFromConnection(connection);
  const current = await loadOpencodeConfig();
  const nextMcp = Object.fromEntries(
    servers.map(server => [
      server.id,
      server.type === "remote"
        ? {
            type: "remote",
            url: server.url,
            enabled: server.enabled,
            headers: server.headers,
            ...(server.oauth === "off" ? { oauth: false } : {}),
            ...(typeof server.timeoutMs === "number" ? { timeout: server.timeoutMs } : {}),
          }
        : {
            type: "local",
            command: server.command,
            enabled: server.enabled,
            environment: server.environment,
            ...(typeof server.timeoutMs === "number" ? { timeout: server.timeoutMs } : {}),
          },
    ]),
  );
  const nextConfig = {
    ...(current as Record<string, unknown>),
    mcp: nextMcp,
  } as OpencodeConfig;

  await client.config.update({
    body: nextConfig,
    responseStyle: "data",
    throwOnError: true,
    signal: AbortSignal.timeout(connection.timeoutMs),
  });
  await client.instance.dispose({
    responseStyle: "data",
    throwOnError: false,
    signal: AbortSignal.timeout(connection.timeoutMs),
  }).catch(() => undefined);
}

function normalizeServers(config: OpencodeConfig) {
  const raw = (config as Record<string, unknown>).mcp;
  if (!isPlainObject(raw)) return [];
  const servers = [];
  for (const [id, value] of Object.entries(raw)) {
    if (!isPlainObject(value) || typeof value.type !== "string") continue;
    const candidate = configuredMcpServerSchema.safeParse({ id, ...value });
    if (candidate.success) {
      servers.push(candidate.data);
    }
  }
  return servers.sort((left, right) => left.id.localeCompare(right.id));
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
        const body = (await req.json()) as { servers?: unknown };
        if (!Array.isArray(body.servers)) {
          return Response.json({ error: "servers must be an array" }, { status: 400 });
        }
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
        await persistMcpServers(parsedServers);
        const config = await loadOpencodeConfig();
        return Response.json({ servers: normalizeServers(config), status: await loadStatuses().catch(() => ({})) });
      },
    },

    "/api/mockingbird/mcp/:id/connect": {
      POST: async (req: Request & { params: { id: string } }) => {
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
        return Response.json({ connected, status: await loadStatuses() });
      },
    },

    "/api/mockingbird/mcp/:id/disconnect": {
      POST: async (req: Request & { params: { id: string } }) => {
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
        return Response.json({ disconnected, status: await loadStatuses() });
      },
    },

    "/api/mockingbird/mcp/:id/auth/start": {
      POST: async (req: Request & { params: { id: string } }) => {
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
      },
    },

    "/api/mockingbird/mcp/:id/auth/remove": {
      POST: async (req: Request & { params: { id: string } }) => {
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
      },
    },
  };
}

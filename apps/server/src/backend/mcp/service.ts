import type { RuntimeMcp, RuntimeMcpStatus } from "@agent-mockingbird/contracts/dashboard";

import type { ConfiguredMcpServer, AgentMockingbirdConfig } from "../config/schema";
import { createOpencodeV2ClientFromConnection, unwrapSdkData } from "../opencode/client";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeMcpIds(ids: Array<string>) {
  const normalized = ids.map(id => id.trim()).filter(Boolean);
  return [...new Set(normalized)].sort((a, b) => a.localeCompare(b));
}

export function normalizeMcpServerDefinitions(servers: Array<ConfiguredMcpServer>) {
  const deduped = new Map<string, ConfiguredMcpServer>();
  for (const server of servers) {
    deduped.set(server.id.trim(), server);
  }
  return [...deduped.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function resolveConfiguredMcpServers(config: AgentMockingbirdConfig) {
  return normalizeMcpServerDefinitions(config.ui.mcpServers ?? []);
}

export function resolveConfiguredMcpIds(config: AgentMockingbirdConfig) {
  const configuredServers = resolveConfiguredMcpServers(config);
  if (configuredServers.length > 0) {
    return normalizeMcpIds(configuredServers.filter(server => server.enabled).map(server => server.id));
  }
  return normalizeMcpIds(config.ui.mcps);
}

function createMcpClient(config: AgentMockingbirdConfig) {
  return createOpencodeV2ClientFromConnection({
    baseUrl: config.runtime.opencode.baseUrl,
    directory: config.runtime.opencode.directory,
  });
}

function normalizeMcpStatus(value: unknown): RuntimeMcpStatus {
  if (value === "connected") return value;
  if (value === "disabled") return value;
  if (value === "failed") return value;
  if (value === "needs_auth") return value;
  if (value === "needs_client_registration") return value;
  return "unknown";
}

function extractMcpError(value: unknown) {
  if (!isPlainObject(value)) return undefined;
  const error = value.error;
  if (typeof error !== "string") return undefined;
  const trimmed = error.trim();
  return trimmed || undefined;
}

export async function listRuntimeMcps(config: AgentMockingbirdConfig): Promise<RuntimeMcp[]> {
  const enabled = new Set(resolveConfiguredMcpIds(config));
  const client = createMcpClient(config);
  const payload = unwrapSdkData<Record<string, unknown>>(
    await client.mcp.status(undefined, {
      responseStyle: "data",
      throwOnError: true,
      signal: AbortSignal.timeout(config.runtime.opencode.timeoutMs),
    }),
  );

  const discoveredIds = Object.keys(isPlainObject(payload) ? payload : {}).map(id => id.trim()).filter(Boolean);
  const allIds = new Set([...discoveredIds, ...enabled]);

  return [...allIds]
    .sort((a, b) => a.localeCompare(b))
    .map(id => {
      const rawStatus = isPlainObject(payload) ? payload[id] : undefined;
      const statusRecord = isPlainObject(rawStatus) ? rawStatus : {};
      return {
        id,
        enabled: enabled.has(id),
        status: normalizeMcpStatus(statusRecord.status),
        error: extractMcpError(statusRecord),
      } satisfies RuntimeMcp;
    });
}

export function normalizeRuntimeMcpConfigMap(value: unknown): Record<string, Record<string, unknown>> {
  if (!isPlainObject(value)) return {};
  const normalized: Record<string, Record<string, unknown>> = {};
  for (const [rawName, rawConfig] of Object.entries(value)) {
    const name = rawName.trim();
    if (!name) continue;
    if (isPlainObject(rawConfig)) {
      normalized[name] = { ...rawConfig };
      continue;
    }
    normalized[name] = {};
  }
  return normalized;
}

function toRuntimeMcpConfig(server: ConfiguredMcpServer): Record<string, unknown> {
  if (server.type === "remote") {
    return {
      type: "remote",
      url: server.url,
      enabled: server.enabled,
      headers: server.headers,
      ...(server.oauth === "off" ? { oauth: false } : {}),
      ...(typeof server.timeoutMs === "number" ? { timeout: server.timeoutMs } : {}),
    };
  }
  return {
    type: "local",
    command: server.command,
    enabled: server.enabled,
    environment: server.environment,
    ...(typeof server.timeoutMs === "number" ? { timeout: server.timeoutMs } : {}),
  };
}

export function buildDesiredRuntimeMcpConfigMap(input: {
  currentMcpConfig: unknown;
  configuredServers: Array<ConfiguredMcpServer>;
  legacyEnabledIds: Array<string>;
}) {
  const currentMap = normalizeRuntimeMcpConfigMap(input.currentMcpConfig);
  const configuredMap = new Map(input.configuredServers.map(server => [server.id, server]));
  const legacyEnabled = new Set(normalizeMcpIds(input.legacyEnabledIds));
  const keys = new Set([...Object.keys(currentMap), ...configuredMap.keys(), ...legacyEnabled]);
  const desired: Record<string, Record<string, unknown>> = {};

  for (const key of [...keys].sort((a, b) => a.localeCompare(b))) {
    const configured = configuredMap.get(key);
    if (configured) {
      desired[key] = toRuntimeMcpConfig(configured);
      continue;
    }
    desired[key] = {
      ...(currentMap[key] ?? {}),
      enabled: legacyEnabled.has(key),
    };
  }
  return desired;
}

export async function connectRuntimeMcp(config: AgentMockingbirdConfig, id: string) {
  const client = createMcpClient(config);
  return unwrapSdkData<boolean>(
    await client.mcp.connect(
      { name: id },
      {
        responseStyle: "data",
        throwOnError: true,
        signal: AbortSignal.timeout(config.runtime.opencode.timeoutMs),
      },
    ),
  );
}

export async function disconnectRuntimeMcp(config: AgentMockingbirdConfig, id: string) {
  const client = createMcpClient(config);
  return unwrapSdkData<boolean>(
    await client.mcp.disconnect(
      { name: id },
      {
        responseStyle: "data",
        throwOnError: true,
        signal: AbortSignal.timeout(config.runtime.opencode.timeoutMs),
      },
    ),
  );
}

export async function startRuntimeMcpAuth(config: AgentMockingbirdConfig, id: string) {
  const client = createMcpClient(config);
  const response = unwrapSdkData<{ authorizationUrl: string }>(
    await client.mcp.auth.start(
      { name: id },
      {
        responseStyle: "data",
        throwOnError: true,
        signal: AbortSignal.timeout(config.runtime.opencode.timeoutMs),
      },
    ),
  );
  return response.authorizationUrl;
}

export async function removeRuntimeMcpAuth(config: AgentMockingbirdConfig, id: string) {
  const client = createMcpClient(config);
  return unwrapSdkData<{ success: true }>(
    await client.mcp.auth.remove(
      { name: id },
      {
        responseStyle: "data",
        throwOnError: true,
        signal: AbortSignal.timeout(config.runtime.opencode.timeoutMs),
      },
    ),
  );
}

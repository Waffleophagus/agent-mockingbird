import type { Config } from "@opencode-ai/sdk/client";
import { parse as parseJsonc } from "jsonc-parser";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import type { AgentMockingbirdConfig, ConfiguredMcpServer } from "../config/schema";
import { createOpencodeClientFromConnection, createOpencodeV2ClientFromConnection, unwrapSdkData } from "../opencode/client";
import { resolveOpencodeWorkspaceDir } from "../workspace/resolve";

export type RuntimeMcpStatus =
  | "connected"
  | "disabled"
  | "failed"
  | "needs_auth"
  | "needs_client_registration"
  | "unknown";

export interface RuntimeMcp {
  id: string;
  enabled: boolean;
  status: RuntimeMcpStatus;
  error?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableSerialize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => stableSerialize(item)).join(",")}]`;
  }
  if (!isPlainObject(value)) return JSON.stringify(value);
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`).join(",")}}`;
}

function hashConfiguredMcpServers(servers: Array<ConfiguredMcpServer>) {
  return createHash("sha256").update(stableSerialize(servers)).digest("hex");
}

function createMcpClient(config: AgentMockingbirdConfig) {
  return createOpencodeV2ClientFromConnection({
    baseUrl: config.runtime.opencode.baseUrl,
    directory: config.workspace.pinnedDirectory,
  });
}

function createConfigClient(config: AgentMockingbirdConfig) {
  return createOpencodeClientFromConnection({
    baseUrl: config.runtime.opencode.baseUrl,
    directory: config.workspace.pinnedDirectory,
  });
}

function normalizeRecordStringMap(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([key, entry]) => [key, entry]),
  );
}

function fromOpencodeMcp(id: string, value: unknown): ConfiguredMcpServer | null {
  if (!isPlainObject(value)) return null;
  const enabled = value.enabled !== false;
  if (value.type === "remote" && typeof value.url === "string") {
    return {
      id,
      type: "remote",
      enabled,
      url: value.url,
      headers: normalizeRecordStringMap(value.headers),
      oauth: value.oauth === false ? "off" : "auto",
      timeoutMs: typeof value.timeout === "number" ? value.timeout : undefined,
    };
  }
  if (value.type === "local" && Array.isArray(value.command)) {
    return {
      id,
      type: "local",
      enabled,
      command: value.command.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0),
      environment: normalizeRecordStringMap(value.environment),
      timeoutMs: typeof value.timeout === "number" ? value.timeout : undefined,
    };
  }
  return null;
}

function toOpencodeMcp(server: ConfiguredMcpServer): Record<string, unknown> {
  if (server.type === "remote") {
    return {
      type: "remote",
      enabled: server.enabled,
      url: server.url,
      headers: server.headers,
      ...(server.oauth === "off" ? { oauth: false } : {}),
      ...(typeof server.timeoutMs === "number" ? { timeout: server.timeoutMs } : {}),
    };
  }
  return {
    type: "local",
    enabled: server.enabled,
    command: server.command,
    environment: server.environment,
    ...(typeof server.timeoutMs === "number" ? { timeout: server.timeoutMs } : {}),
  };
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

function opencodeConfigFilePath(config: AgentMockingbirdConfig) {
  return `${resolveOpencodeWorkspaceDir(config)}/.opencode/opencode.jsonc`;
}

export function readConfiguredMcpServersFromWorkspaceConfig(config: AgentMockingbirdConfig): Array<ConfiguredMcpServer> {
  try {
    const raw = readFileSync(opencodeConfigFilePath(config), "utf8");
    const parsed = parseJsonc(raw);
    if (!isPlainObject(parsed) || !isPlainObject(parsed.mcp)) return [];
    return Object.entries(parsed.mcp)
      .map(([id, value]) => fromOpencodeMcp(id.trim(), value))
      .filter((server): server is ConfiguredMcpServer => Boolean(server))
      .sort((left, right) => left.id.localeCompare(right.id));
  } catch {
    return [];
  }
}

export function normalizeMcpIds(ids: Array<string>) {
  const normalized = ids.map(id => id.trim()).filter(Boolean);
  return [...new Set(normalized)].sort((a, b) => a.localeCompare(b));
}

export function normalizeMcpServerDefinitions(servers: Array<ConfiguredMcpServer>) {
  const deduped = new Map<string, ConfiguredMcpServer>();
  for (const server of servers) {
    const parsed = fromOpencodeMcp(server.id, toOpencodeMcp(server));
    if (!parsed) continue;
    deduped.set(parsed.id, parsed);
  }
  return [...deduped.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function resolveConfiguredMcpServers(config: AgentMockingbirdConfig) {
  return normalizeMcpServerDefinitions(readConfiguredMcpServersFromWorkspaceConfig(config));
}

export function resolveConfiguredMcpIds(config: AgentMockingbirdConfig) {
  return normalizeMcpIds(resolveConfiguredMcpServers(config).filter(server => server.enabled).map(server => server.id));
}

export async function getWorkspaceMcpConfig(config: AgentMockingbirdConfig) {
  const current = unwrapSdkData<Config>(
    await createConfigClient(config).config.get({
      responseStyle: "data",
      throwOnError: true,
      signal: AbortSignal.timeout(config.runtime.opencode.timeoutMs),
    }),
  );
  const servers = readConfiguredMcpServersFromWorkspaceConfig(config);
  return {
    config: current,
    servers,
    hash: hashConfiguredMcpServers(servers),
  };
}

export async function updateWorkspaceMcpConfig(input: {
  config: AgentMockingbirdConfig;
  servers: Array<ConfiguredMcpServer>;
  expectedHash?: string;
}) {
  const current = await getWorkspaceMcpConfig(input.config);
  if (input.expectedHash && input.expectedHash !== current.hash) {
    throw new Error("MCP config has changed; refresh and retry");
  }
  const nextServers = normalizeMcpServerDefinitions(input.servers);
  const nextConfig = {
    ...current.config,
    mcp: Object.fromEntries(nextServers.map(server => [server.id, toOpencodeMcp(server)])),
  } as Config;
  await createConfigClient(input.config).config.update({
    body: nextConfig,
    responseStyle: "data",
    throwOnError: true,
    signal: AbortSignal.timeout(input.config.runtime.opencode.timeoutMs),
  });
  return getWorkspaceMcpConfig(input.config);
}

export async function listRuntimeMcps(config: AgentMockingbirdConfig): Promise<RuntimeMcp[]> {
  const { servers } = await getWorkspaceMcpConfig(config);
  const enabled = new Set(servers.filter(server => server.enabled).map(server => server.id));
  const payload = unwrapSdkData<Record<string, unknown>>(
    await createMcpClient(config).mcp.status(undefined, {
      responseStyle: "data",
      throwOnError: true,
      signal: AbortSignal.timeout(config.runtime.opencode.timeoutMs),
    }),
  );

  const discoveredIds = Object.keys(isPlainObject(payload) ? payload : {}).map(id => id.trim()).filter(Boolean);
  const configuredIds = servers.map(server => server.id);
  const allIds = new Set([...configuredIds, ...discoveredIds]);

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

export async function connectRuntimeMcp(config: AgentMockingbirdConfig, id: string) {
  return unwrapSdkData<boolean>(
    await createMcpClient(config).mcp.connect(
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
  return unwrapSdkData<boolean>(
    await createMcpClient(config).mcp.disconnect(
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
  const response = unwrapSdkData<{ authorizationUrl: string }>(
    await createMcpClient(config).mcp.auth.start(
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
  return unwrapSdkData<{ success: true }>(
    await createMcpClient(config).mcp.auth.remove(
      { name: id },
      {
        responseStyle: "data",
        throwOnError: true,
        signal: AbortSignal.timeout(config.runtime.opencode.timeoutMs),
      },
    ),
  );
}

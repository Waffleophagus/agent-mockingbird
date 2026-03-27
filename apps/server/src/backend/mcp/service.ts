import type { Config } from "@opencode-ai/sdk/client";
import { parse as parseJsonc, printParseErrorCode, type ParseError } from "jsonc-parser";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import type {
  AgentMockingbirdConfig,
  ConfiguredMcpServer,
} from "../config/schema";
import { configuredMcpServerSchema } from "../config/schema";
import {
  createOpencodeClientFromConnection,
  createOpencodeV2ClientFromConnection,
  unwrapSdkData,
} from "../opencode/client";
import { resolveOpencodeConfigDir } from "../workspace/resolve";

type RuntimeMcpStatus =
  | "connected"
  | "disabled"
  | "failed"
  | "needs_auth"
  | "needs_client_registration"
  | "unknown";

interface RuntimeMcp {
  id: string;
  enabled: boolean;
  status: RuntimeMcpStatus;
  error?: string;
}

export interface EffectiveMcpConfigSnapshot {
  source: "opencode-managed-config";
  hash: string;
  servers: Array<ConfiguredMcpServer>;
  enabled: Array<string>;
  status?: Array<RuntimeMcp>;
  statusError?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableSerialize(value: unknown): string {
  if (value === null) return "null";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (!isPlainObject(value)) return JSON.stringify(value);
  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`).join(",")}}`;
}

function hashConfiguredMcpServers(servers: Array<ConfiguredMcpServer>) {
  return createHash("sha256").update(stableSerialize(servers)).digest("hex");
}

function resolveMcpConnectionDirectory(config: AgentMockingbirdConfig) {
  try {
    return resolveOpencodeConfigDir(config);
  } catch {
    return config.runtime.opencode.directory || config.workspace.pinnedDirectory;
  }
}

function createMcpClient(config: AgentMockingbirdConfig) {
  return createOpencodeV2ClientFromConnection({
    baseUrl: config.runtime.opencode.baseUrl,
    directory: resolveMcpConnectionDirectory(config),
  });
}

function createConfigClient(config: AgentMockingbirdConfig) {
  return createOpencodeClientFromConnection({
    baseUrl: config.runtime.opencode.baseUrl,
    directory: resolveMcpConnectionDirectory(config),
  });
}

function normalizeRecordStringMap(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      )
      .map(([key, entry]) => [key, entry]),
  );
}

function fromOpencodeMcp(
  id: string,
  value: unknown,
): ConfiguredMcpServer | null {
  if (!isPlainObject(value)) return null;
  const enabled = value.enabled !== false;
  if (value.type === "remote" && typeof value.url === "string") {
    const candidate = {
      id,
      type: "remote",
      enabled,
      url: value.url,
      headers: normalizeRecordStringMap(value.headers),
      oauth: value.oauth === false ? "off" : "auto",
      timeoutMs: typeof value.timeout === "number" ? value.timeout : undefined,
    };
    const parsed = configuredMcpServerSchema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  }
  if (value.type === "local" && Array.isArray(value.command)) {
    const candidate = {
      id,
      type: "local",
      enabled,
      command: value.command.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.trim().length > 0,
      ),
      environment: normalizeRecordStringMap(value.environment),
      timeoutMs: typeof value.timeout === "number" ? value.timeout : undefined,
    };
    const parsed = configuredMcpServerSchema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
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
      ...(typeof server.timeoutMs === "number"
        ? { timeout: server.timeoutMs }
        : {}),
    };
  }
  return {
    type: "local",
    enabled: server.enabled,
    command: server.command,
    environment: server.environment,
    ...(typeof server.timeoutMs === "number"
      ? { timeout: server.timeoutMs }
      : {}),
  };
}

export function readConfiguredMcpServersFromOpencodeConfig(
  config: Config,
): Array<ConfiguredMcpServer> {
  const raw = (config as Record<string, unknown>).mcp;
  if (!isPlainObject(raw)) return [];
  return Object.entries(raw)
    .map(([id, value]) => fromOpencodeMcp(id.trim(), value))
    .filter((server): server is ConfiguredMcpServer => Boolean(server))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function serializeConfiguredMcpServersToOpencodeConfig(
  servers: Array<ConfiguredMcpServer>,
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    normalizeMcpServerDefinitions(servers).map((server) => [
      server.id,
      toOpencodeMcp(server),
    ]),
  );
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
  return path.join(resolveOpencodeConfigDir(config), "opencode.jsonc");
}

export function readConfiguredMcpServersFromWorkspaceConfig(
  config: AgentMockingbirdConfig,
): Array<ConfiguredMcpServer> {
  let parsed: unknown;
  try {
    const raw = readFileSync(opencodeConfigFilePath(config), "utf8");
    const errors: ParseError[] = [];
    parsed = parseJsonc(raw, errors);
    if (errors.length > 0) {
      throw new Error(`Invalid JSONC: ${printParseErrorCode(errors[0]!.error)}`);
    }
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return [];
    }
    throw new Error(
      "Failed to read or parse workspace MCP configuration from opencode.jsonc",
      { cause: error },
    );
  }
  if (!isPlainObject(parsed)) {
    throw new Error("Workspace MCP configuration must parse to a JSON object");
  }
  return readConfiguredMcpServersFromOpencodeConfig(parsed as Config);
}

export function normalizeMcpIds(ids: Array<string>) {
  const normalized = ids.map((id) => id.trim()).filter(Boolean);
  return [...new Set(normalized)].sort((a, b) => a.localeCompare(b));
}

export function normalizeMcpServerDefinitions(
  servers: Array<ConfiguredMcpServer>,
) {
  const deduped = new Map<string, ConfiguredMcpServer>();
  for (const server of servers) {
    const parsed = fromOpencodeMcp(server.id, toOpencodeMcp(server));
    if (!parsed) continue;
    deduped.set(parsed.id, parsed);
  }
  return [...deduped.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

export function resolveConfiguredMcpServers(config: AgentMockingbirdConfig) {
  return normalizeMcpServerDefinitions(
    readConfiguredMcpServersFromWorkspaceConfig(config),
  );
}

export function resolveConfiguredMcpIds(config: AgentMockingbirdConfig) {
  return normalizeMcpIds(
    resolveConfiguredMcpServers(config)
      .filter((server) => server.enabled)
      .map((server) => server.id),
  );
}

export async function loadEffectiveMcpConfig(
  config: AgentMockingbirdConfig,
  input?: { includeStatus?: boolean },
): Promise<EffectiveMcpConfigSnapshot> {
  let servers: Array<ConfiguredMcpServer> = [];
  let enabled: Array<string> = [];
  let hash = hashConfiguredMcpServers([]);
  let configError: string | undefined;

  try {
    servers = resolveConfiguredMcpServers(config);
    enabled = normalizeMcpIds(
      servers.filter((server) => server.enabled).map((server) => server.id),
    );
    hash = hashConfiguredMcpServers(servers);
  } catch (error) {
    configError =
      error instanceof Error
        ? error.message
        : "Failed to read effective MCP configuration";
  }

  if (input?.includeStatus !== true) {
    return {
      source: "opencode-managed-config",
      hash,
      servers,
      enabled,
      ...(configError ? { statusError: configError } : {}),
    };
  }

  if (configError) {
    return {
      source: "opencode-managed-config",
      hash,
      servers,
      enabled,
      statusError: configError,
    };
  }

  try {
    const status = await listRuntimeMcps(config);
    return {
      source: "opencode-managed-config",
      hash,
      servers,
      enabled,
      status,
    };
  } catch (error) {
    return {
      source: "opencode-managed-config",
      hash,
      servers,
      enabled,
      statusError:
        error instanceof Error ? error.message : "Failed to load runtime MCP status",
    };
  }
}

async function getWorkspaceMcpConfig(config: AgentMockingbirdConfig) {
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

export async function listRuntimeMcps(
  config: AgentMockingbirdConfig,
): Promise<RuntimeMcp[]> {
  const { servers } = await getWorkspaceMcpConfig(config);
  const enabled = new Set(
    servers.filter((server) => server.enabled).map((server) => server.id),
  );
  const payload = unwrapSdkData<Record<string, unknown>>(
    await createMcpClient(config).mcp.status(undefined, {
      responseStyle: "data",
      throwOnError: true,
      signal: AbortSignal.timeout(config.runtime.opencode.timeoutMs),
    }),
  );

  const discoveredIds = Object.keys(isPlainObject(payload) ? payload : {})
    .map((id) => id.trim())
    .filter(Boolean);
  const configuredIds = servers.map((server) => server.id);
  const allIds = new Set([...configuredIds, ...discoveredIds]);

  return [...allIds]
    .sort((a, b) => a.localeCompare(b))
    .map((id) => {
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

export async function connectRuntimeMcp(
  config: AgentMockingbirdConfig,
  id: string,
) {
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

export async function disconnectRuntimeMcp(
  config: AgentMockingbirdConfig,
  id: string,
) {
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

export async function startRuntimeMcpAuth(
  config: AgentMockingbirdConfig,
  id: string,
) {
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

export async function removeRuntimeMcpAuth(
  config: AgentMockingbirdConfig,
  id: string,
) {
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

import type { Config as OpencodeConfig } from "@opencode-ai/sdk/client";
import { applyEdits, format, modify, parse as parseJsonc } from "jsonc-parser";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createOpencodeClientFromConnection } from "./client";
import type { AgentMockingbirdConfig } from "../config/schema";
import {
  resolveOpencodeConfigDir,
  resolveOpencodeWorkspaceDir,
} from "../workspace/resolve";

type ConfigLike = Record<string, unknown>;

const OPENCODE_SCHEMA_URL = "https://opencode.ai/config.json";
const TUI_SCHEMA_URL = "https://opencode.ai/tui.json";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function opencodeConfigFilePath(config: AgentMockingbirdConfig) {
  return path.join(resolveOpencodeConfigDir(config), "opencode.jsonc");
}

function tuiConfigFilePath(config: AgentMockingbirdConfig) {
  return path.join(resolveOpencodeConfigDir(config), "tui.json");
}

function ensureManagedConfigFile(
  filePath: string,
  initialContents: string,
) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  if (!existsSync(filePath)) {
    writeFileSync(filePath, initialContents, "utf8");
  }
  return filePath;
}

function patchJsoncField(input: string, value: unknown, jsonPath: string[]) {
  const edits = modify(input, jsonPath, value, {
    formattingOptions: {
      insertSpaces: true,
      tabSize: 2,
      eol: "\n",
    },
  });
  const patched = applyEdits(input, edits);
  const formatEdits = format(patched, undefined, {
    insertSpaces: true,
    tabSize: 2,
    eol: "\n",
  });
  return applyEdits(patched, formatEdits);
}

function readManagedConfigFile(config: AgentMockingbirdConfig) {
  return readFileSync(
    ensureManagedConfigFile(
      opencodeConfigFilePath(config),
      `{\n  "$schema": "${OPENCODE_SCHEMA_URL}"\n}\n`,
    ),
    "utf8",
  );
}

function readManagedTuiConfigFile(config: AgentMockingbirdConfig) {
  return readFileSync(
    ensureManagedConfigFile(
      tuiConfigFilePath(config),
      `{\n  "$schema": "${TUI_SCHEMA_URL}"\n}\n`,
    ),
    "utf8",
  );
}

function parseManagedConfig(raw: string): ConfigLike {
  const parsed = parseJsonc(raw);
  return isPlainObject(parsed) ? parsed : {};
}

function writeManagedConfigFile(config: AgentMockingbirdConfig, raw: string) {
  writeFileSync(
    ensureManagedConfigFile(
      opencodeConfigFilePath(config),
      `{\n  "$schema": "${OPENCODE_SCHEMA_URL}"\n}\n`,
    ),
    raw,
    "utf8",
  );
}

function writeManagedTuiConfigFile(config: AgentMockingbirdConfig, raw: string) {
  writeFileSync(
    ensureManagedConfigFile(
      tuiConfigFilePath(config),
      `{\n  "$schema": "${TUI_SCHEMA_URL}"\n}\n`,
    ),
    raw,
    "utf8",
  );
}

export function readManagedOpencodeConfig(
  config: AgentMockingbirdConfig,
): ConfigLike {
  return parseManagedConfig(readManagedConfigFile(config));
}

export function readManagedTuiConfig(
  config: AgentMockingbirdConfig,
): ConfigLike {
  return parseManagedConfig(readManagedTuiConfigFile(config));
}

function buildExecutorMcpConfig(config: AgentMockingbirdConfig) {
  const baseUrl = config.runtime.executor.baseUrl.replace(/\/+$/, "");
  const rawMountPath = config.runtime.executor.uiMountPath.trim();
  const mountPath =
    !rawMountPath || rawMountPath === "/"
      ? ""
      : `/${rawMountPath.replace(/^\/+/, "").replace(/\/+$/, "")}`;
  return {
    type: "remote",
    enabled: config.runtime.executor.enabled,
    url: `${baseUrl}${mountPath}/mcp`,
  };
}

export async function ensureExecutorMcpServerConfigured(
  config: AgentMockingbirdConfig,
): Promise<ConfigLike> {
  const current = readManagedConfigFile(config);
  const parsed = parseManagedConfig(current);
  const desired = buildExecutorMcpConfig(config);
  const currentExecutor = isPlainObject(parsed.mcp) && isPlainObject(parsed.mcp.executor) ? parsed.mcp.executor : null;

  if (
    currentExecutor &&
    currentExecutor.type === desired.type &&
    currentExecutor.enabled === desired.enabled &&
    currentExecutor.url === desired.url
  ) {
    return parsed;
  }

  const next = patchJsoncField(current, desired, ["mcp", "executor"]);
  writeManagedConfigFile(config, next);
  await disposeManagedOpencodeInstance(config);
  return parseManagedConfig(next);
}

export async function replaceManagedOpencodeField(
  config: AgentMockingbirdConfig,
  fieldPath: string[],
  value: unknown,
): Promise<ConfigLike> {
  const current = readManagedConfigFile(config);
  const next = patchJsoncField(current, value, fieldPath);
  writeManagedConfigFile(config, next);
  await disposeManagedOpencodeInstance(config);
  return parseManagedConfig(next);
}

export async function replaceManagedTuiField(
  config: AgentMockingbirdConfig,
  fieldPath: string[],
  value: unknown,
): Promise<ConfigLike> {
  const current = readManagedTuiConfigFile(config);
  const next = patchJsoncField(current, value, fieldPath);
  writeManagedTuiConfigFile(config, next);
  await disposeManagedOpencodeInstance(config);
  return parseManagedConfig(next);
}

export async function patchManagedOpencodeConfig(
  config: AgentMockingbirdConfig,
  patch: Record<string, unknown>,
): Promise<ConfigLike> {
  let current = readManagedConfigFile(config);
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value === "undefined") continue;
    current = patchJsoncField(current, value, [key]);
  }
  writeManagedConfigFile(config, current);
  await disposeManagedOpencodeInstance(config);
  return parseManagedConfig(current);
}

export async function patchManagedTuiConfig(
  config: AgentMockingbirdConfig,
  patch: Record<string, unknown>,
): Promise<ConfigLike> {
  let current = readManagedTuiConfigFile(config);
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value === "undefined") continue;
    current = patchJsoncField(current, value, [key]);
  }
  writeManagedTuiConfigFile(config, current);
  await disposeManagedOpencodeInstance(config);
  return parseManagedConfig(current);
}

export async function disposeManagedOpencodeInstance(
  config: AgentMockingbirdConfig,
) {
  try {
    await createOpencodeClientFromConnection({
      baseUrl: config.runtime.opencode.baseUrl,
      directory: resolveOpencodeWorkspaceDir(config),
    }).instance.dispose({
      responseStyle: "data",
      throwOnError: true,
      signal: AbortSignal.timeout(config.runtime.opencode.timeoutMs),
    });
  } catch {
    // Best-effort; OpenCode will also reload from file watchers when available.
  }
}

export type { ConfigLike, OpencodeConfig };

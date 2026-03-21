import {
  createOpencodeClient as createSdkClient,
  type OpencodeClient,
} from "@opencode-ai/sdk/client";
import {
  createOpencodeClient as createSdkV2Client,
  type OpencodeClient as OpencodeV2Client,
} from "@opencode-ai/sdk/v2/client";

import { env } from "../env";

const DEFAULT_OPENCODE_BASE_URL =
  env.AGENT_MOCKINGBIRD_OPENCODE_BASE_URL?.trim() ||
  `http://127.0.0.1:${process.env.OPENCODE_PORT?.trim() || "4096"}`;
const DEFAULT_OPENCODE_TIMEOUT_MS = 120_000;

interface OpencodeConnectionConfig {
  baseUrl: string;
  directory?: string | null;
  timeoutMs: number;
}

interface OpencodeConnectionInfo {
  baseUrl: string;
  timeoutMs: number;
  directoryConfigured: boolean;
  authConfigured: boolean;
}

function resolveAuthHeader() {
  const explicit = env.AGENT_MOCKINGBIRD_OPENCODE_AUTH_HEADER?.trim();
  if (explicit) return explicit;

  const username = env.AGENT_MOCKINGBIRD_OPENCODE_USERNAME?.trim();
  const password = env.AGENT_MOCKINGBIRD_OPENCODE_PASSWORD ?? "";
  if (!username) return undefined;
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

export function getOpencodeConnectionInfo(
  connection?: OpencodeConnectionConfig,
): OpencodeConnectionInfo {
  const authHeader = resolveAuthHeader();
  const resolved = connection ?? {
    baseUrl: DEFAULT_OPENCODE_BASE_URL,
    timeoutMs: DEFAULT_OPENCODE_TIMEOUT_MS,
    directory: undefined,
  };
  return {
    baseUrl: resolved.baseUrl,
    timeoutMs: resolved.timeoutMs,
    directoryConfigured: Boolean(resolved.directory),
    authConfigured: Boolean(authHeader),
  };
}

export function createOpencodeClient(): OpencodeClient {
  return createOpencodeClientFromConnection({
    baseUrl: DEFAULT_OPENCODE_BASE_URL,
  });
}

export function createOpencodeClientFromConnection(connection: {
  baseUrl: string;
  directory?: string | null;
}): OpencodeClient {
  const authHeader = resolveAuthHeader();
  return createSdkClient({
    baseUrl: connection.baseUrl,
    headers: authHeader ? { Authorization: authHeader } : undefined,
    directory: connection.directory ?? undefined,
  });
}

export function createOpencodeV2ClientFromConnection(connection: {
  baseUrl: string;
  directory?: string | null;
}): OpencodeV2Client {
  const authHeader = resolveAuthHeader();
  return createSdkV2Client({
    baseUrl: connection.baseUrl,
    headers: authHeader ? { Authorization: authHeader } : undefined,
    directory: connection.directory ?? undefined,
  });
}

export function getOpencodeErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

export function unwrapSdkData<T>(result: T | { data: T }): T {
  if (
    result &&
    typeof result === "object" &&
    "data" in result &&
    typeof (result as { data?: unknown }).data !== "undefined"
  ) {
    return (result as { data: T }).data;
  }
  return result as T;
}

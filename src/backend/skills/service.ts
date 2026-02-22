import type { Config } from "@opencode-ai/sdk/client";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { WafflebotConfig } from "../config/schema";
import { createOpencodeV2ClientFromConnection, unwrapSdkData } from "../opencode/client";
import { resolveDataPath } from "../paths";

const SKILL_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const MANAGED_SKILLS_ROOT = resolveDataPath("skills");

type PermissionAction = "allow" | "deny" | "ask";

interface RuntimeSkillResponse {
  name: string;
  description: string;
  location: string;
  content: string;
}

export interface RuntimeSkill {
  id: string;
  name: string;
  description: string;
  location: string;
  enabled: boolean;
  managed: boolean;
}

export interface ManagedSkillWriteResult {
  id: string;
  directoryPath: string;
  filePath: string;
  created: boolean;
}

function toAbsoluteLocation(location: string) {
  const trimmed = location.trim();
  if (!trimmed) return null;
  try {
    if (trimmed.startsWith("file://")) {
      return path.resolve(fileURLToPath(trimmed));
    }
    return path.resolve(trimmed);
  } catch {
    return null;
  }
}

function normalizePathList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const normalized = values
    .map(value => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean)
    .map(value => path.resolve(value));
  return [...new Set(normalized)];
}

export function normalizeSkillIds(ids: Array<string>): string[] {
  const normalized = ids.map(id => id.trim()).filter(Boolean);
  return [...new Set(normalized)].sort((a, b) => a.localeCompare(b));
}

export function normalizeSkillId(id: string) {
  const normalized = id.trim();
  if (!normalized) {
    throw new Error("skill id is required");
  }
  if (!SKILL_ID_PATTERN.test(normalized)) {
    throw new Error("skill id may only include letters, numbers, dot, underscore, or dash");
  }
  return normalized;
}

export function getManagedSkillsRootPath() {
  return MANAGED_SKILLS_ROOT;
}

export function getManagedSkillDirectoryPath(skillId: string) {
  return path.join(MANAGED_SKILLS_ROOT, normalizeSkillId(skillId));
}

export function writeManagedSkill(input: { id: string; content: string; overwrite?: boolean }): ManagedSkillWriteResult {
  const id = normalizeSkillId(input.id);
  const trimmedContent = input.content.trim();
  if (!trimmedContent) {
    throw new Error("skill content is required");
  }

  const directoryPath = getManagedSkillDirectoryPath(id);
  const filePath = path.join(directoryPath, "SKILL.md");
  const created = !existsSync(filePath);
  if (!created && input.overwrite !== true) {
    throw new Error(`skill ${id} already exists in managed imports`);
  }
  mkdirSync(directoryPath, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const serialized = `${trimmedContent}\n`;
  writeFileSync(tempPath, serialized, "utf8");
  renameSync(tempPath, filePath);

  return {
    id,
    directoryPath,
    filePath,
    created,
  };
}

export function removeManagedSkill(skillId: string) {
  const directoryPath = getManagedSkillDirectoryPath(skillId);
  if (existsSync(directoryPath)) {
    rmSync(directoryPath, { recursive: true, force: true });
  }
}

export function isManagedSkillLocation(location: string) {
  const absolute = toAbsoluteLocation(location);
  if (!absolute) return false;
  const root = getManagedSkillsRootPath();
  return absolute === root || absolute.startsWith(`${root}${path.sep}`);
}

export async function listRuntimeSkills(config: WafflebotConfig, enabledIds: Array<string>): Promise<RuntimeSkill[]> {
  const enabled = new Set(normalizeSkillIds(enabledIds));
  const client = createOpencodeV2ClientFromConnection({
    baseUrl: config.runtime.opencode.baseUrl,
    directory: config.runtime.opencode.directory,
  });
  const records = unwrapSdkData<Array<RuntimeSkillResponse>>(
    (await client.app.skills(
      undefined,
      {
        responseStyle: "data",
        throwOnError: true,
        signal: AbortSignal.timeout(config.runtime.opencode.timeoutMs),
      },
    )) as Array<RuntimeSkillResponse> | { data: Array<RuntimeSkillResponse> },
  );

  return records
    .map(record => ({
      id: record.name,
      name: record.name,
      description: record.description,
      location: record.location,
      enabled: enabled.has(record.name),
      managed: isManagedSkillLocation(record.location),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function buildManagedSkillPaths(currentConfig: Config) {
  const root = getManagedSkillsRootPath();
  const configRecord = currentConfig as Record<string, unknown>;
  const currentSkills =
    configRecord.skills && typeof configRecord.skills === "object" ? (configRecord.skills as Record<string, unknown>) : {};
  const paths = normalizePathList((currentSkills as { paths?: unknown }).paths).filter(value => value !== root);
  return [...paths, root];
}

export function buildSkillPermissionAllowlist(enabledIds: Array<string>): Record<string, PermissionAction> {
  const allowlist: Record<string, PermissionAction> = { "*": "deny" };
  for (const id of normalizeSkillIds(enabledIds)) {
    allowlist[id] = "allow";
  }
  return allowlist;
}

export function isConfigPermissionObject(permission: unknown): permission is Record<string, unknown> {
  return Boolean(permission) && typeof permission === "object" && !Array.isArray(permission);
}

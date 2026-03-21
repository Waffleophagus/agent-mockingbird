import type { Config } from "@opencode-ai/sdk/client";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AgentMockingbirdConfig } from "../config/schema";
import { createOpencodeClientFromConnection } from "../opencode/client";

const SKILL_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const MANAGED_SKILLS_RELATIVE = path.join(".agents", "skills");
const DISABLED_SKILLS_RELATIVE = path.join(".agent-mockingbird", "disabled-skills");

interface RuntimeSkill {
  id: string;
  name: string;
  description: string;
  location: string;
  enabled: boolean;
  managed: boolean;
}

interface ManagedSkillWriteResult {
  id: string;
  directoryPath: string;
  filePath: string;
  created: boolean;
}

interface RuntimeSkillIssue {
  id?: string;
  location: string;
  reason: string;
}

interface RuntimeSkillCatalog {
  skills: RuntimeSkill[];
  enabled: string[];
  disabled: string[];
  invalid: RuntimeSkillIssue[];
  revision: string;
  enabledPath: string;
  disabledPath: string;
}

function resolveWorkspaceDirectory(workspaceDir?: string | null) {
  const normalizedWorkspace = typeof workspaceDir === "string" ? workspaceDir.trim() : "";
  return normalizedWorkspace ? path.resolve(normalizedWorkspace) : path.resolve(process.cwd());
}

function resolveManagedSkillRoot(workspaceDir?: string | null) {
  return path.join(resolveWorkspaceDirectory(workspaceDir), MANAGED_SKILLS_RELATIVE);
}

function workspaceFingerprint(workspaceDir?: string | null) {
  const resolved = resolveWorkspaceDirectory(workspaceDir);
  return createHash("sha256").update(resolved).digest("hex").slice(0, 16);
}

function resolveDisabledSkillRoot(workspaceDir?: string | null) {
  const homeDir = os.homedir();
  return path.join(homeDir, DISABLED_SKILLS_RELATIVE, workspaceFingerprint(workspaceDir));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseSkillFrontmatter(content: string) {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return {
      ok: false as const,
      reason: "Missing YAML frontmatter",
    };
  }
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) {
    return {
      ok: false as const,
      reason: "Invalid frontmatter delimiter",
    };
  }
  const frontmatter = normalized.slice(4, end);
  const record: Record<string, string> = {};
  for (const line of frontmatter.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf(":");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (!key) continue;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    record[key] = value;
  }

  const name = record.name?.trim() ?? "";
  const description = record.description?.trim() ?? "";
  if (!name) {
    return {
      ok: false as const,
      reason: "Frontmatter missing required field: name",
    };
  }
  if (!description) {
    return {
      ok: false as const,
      reason: "Frontmatter missing required field: description",
    };
  }
  return {
    ok: true as const,
    name,
    description,
  };
}

function moveDirectory(source: string, target: string) {
  if (source === target) return;
  if (!existsSync(source)) return;
  if (existsSync(target)) {
    throw new Error(`skill target already exists: ${target}`);
  }
  mkdirSync(path.dirname(target), { recursive: true });
  try {
    renameSync(source, target);
  } catch (error) {
    const code = isObject(error) && typeof error.code === "string" ? error.code : "";
    if (code !== "EXDEV") {
      throw error;
    }
    cpSync(source, target, { recursive: true, force: false, errorOnExist: true });
    rmSync(source, { recursive: true, force: true });
  }
}

function listSkillDirectories(root: string) {
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(root, entry.name));
  } catch {
    return [];
  }
}

function directoryMtimeMs(dir: string): number {
  try {
    return statSync(dir).mtimeMs;
  } catch {
    return 0;
  }
}

function skillInfoFromDirectory(directoryPath: string) {
  const id = path.basename(directoryPath);
  if (!SKILL_ID_PATTERN.test(id)) {
    return {
      ok: false as const,
      issue: {
        id,
        location: directoryPath,
        reason: "Directory name is not a valid skill id",
      } satisfies RuntimeSkillIssue,
    };
  }
  const filePath = path.join(directoryPath, "SKILL.md");
  if (!existsSync(filePath)) {
    return {
      ok: false as const,
      issue: {
        id,
        location: directoryPath,
        reason: "Missing SKILL.md",
      } satisfies RuntimeSkillIssue,
    };
  }
  let content = "";
  try {
    content = readFileSync(filePath, "utf8");
  } catch (error) {
    return {
      ok: false as const,
      issue: {
        id,
        location: filePath,
        reason: error instanceof Error ? error.message : "Failed to read SKILL.md",
      } satisfies RuntimeSkillIssue,
    };
  }
  const frontmatter = parseSkillFrontmatter(content);
  if (!frontmatter.ok) {
    return {
      ok: false as const,
      issue: {
        id,
        location: filePath,
        reason: frontmatter.reason,
      } satisfies RuntimeSkillIssue,
    };
  }
  if (frontmatter.name !== id) {
    return {
      ok: false as const,
      issue: {
        id,
        location: filePath,
        reason: `Frontmatter name "${frontmatter.name}" must match directory "${id}"`,
      } satisfies RuntimeSkillIssue,
    };
  }
  return {
    ok: true as const,
    skill: {
      id,
      name: frontmatter.name,
      description: frontmatter.description,
      location: filePath,
    },
  };
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

export function getManagedSkillsRootPath(workspaceDir?: string | null) {
  return resolveManagedSkillRoot(workspaceDir);
}

export function getDisabledSkillsRootPath(workspaceDir?: string | null) {
  return resolveDisabledSkillRoot(workspaceDir);
}

function getManagedSkillDirectoryPath(skillId: string, workspaceDir?: string | null) {
  return path.join(resolveManagedSkillRoot(workspaceDir), normalizeSkillId(skillId));
}

function getDisabledSkillDirectoryPath(skillId: string, workspaceDir?: string | null) {
  return path.join(resolveDisabledSkillRoot(workspaceDir), normalizeSkillId(skillId));
}

export function writeManagedSkill(input: {
  id: string;
  content: string;
  overwrite?: boolean;
  workspaceDir?: string | null;
  enabled?: boolean;
}): ManagedSkillWriteResult {
  const id = normalizeSkillId(input.id);
  const trimmedContent = input.content.trim();
  if (!trimmedContent) {
    throw new Error("skill content is required");
  }

  const directoryPath = input.enabled === false
    ? getDisabledSkillDirectoryPath(id, input.workspaceDir)
    : getManagedSkillDirectoryPath(id, input.workspaceDir);
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

export function removeManagedSkill(skillId: string, workspaceDir?: string | null) {
  for (const directoryPath of [
    getManagedSkillDirectoryPath(skillId, workspaceDir),
    getDisabledSkillDirectoryPath(skillId, workspaceDir),
  ]) {
    if (existsSync(directoryPath)) {
      rmSync(directoryPath, { recursive: true, force: true });
    }
  }
}

export function setManagedSkillEnabled(skillId: string, enabled: boolean, workspaceDir?: string | null) {
  const id = normalizeSkillId(skillId);
  const enabledPath = getManagedSkillDirectoryPath(id, workspaceDir);
  const disabledPath = getDisabledSkillDirectoryPath(id, workspaceDir);
  const source = enabled ? disabledPath : enabledPath;
  const target = enabled ? enabledPath : disabledPath;
  moveDirectory(source, target);
}

export function reconcileManagedSkillEnabledSet(desiredIds: Array<string>, workspaceDir?: string | null) {
  const desired = new Set(normalizeSkillIds(desiredIds));
  for (const directoryPath of listSkillDirectories(getManagedSkillsRootPath(workspaceDir))) {
    const id = path.basename(directoryPath);
    if (!desired.has(id)) {
      setManagedSkillEnabled(id, false, workspaceDir);
    }
  }
  for (const directoryPath of listSkillDirectories(getDisabledSkillsRootPath(workspaceDir))) {
    const id = path.basename(directoryPath);
    if (desired.has(id)) {
      setManagedSkillEnabled(id, true, workspaceDir);
    }
  }
}

export function listManagedSkillCatalog(workspaceDir?: string | null): RuntimeSkillCatalog {
  const enabledPath = getManagedSkillsRootPath(workspaceDir);
  const disabledPath = getDisabledSkillsRootPath(workspaceDir);
  mkdirSync(enabledPath, { recursive: true });
  mkdirSync(disabledPath, { recursive: true });

  const invalid: RuntimeSkillIssue[] = [];
  const skillsById = new Map<string, RuntimeSkill>();
  const enabledIds = new Set<string>();
  const disabledIds = new Set<string>();

  const register = (state: "enabled" | "disabled", directoryPath: string) => {
    const parsed = skillInfoFromDirectory(directoryPath);
    if (!parsed.ok) {
      invalid.push(parsed.issue);
      return;
    }
    const current = skillsById.get(parsed.skill.id);
    if (current) {
      invalid.push({
        id: parsed.skill.id,
        location: parsed.skill.location,
        reason: `Duplicate skill id detected (already loaded from ${current.location})`,
      });
      return;
    }
    const enabled = state === "enabled";
    skillsById.set(parsed.skill.id, {
      id: parsed.skill.id,
      name: parsed.skill.name,
      description: parsed.skill.description,
      location: parsed.skill.location,
      enabled,
      managed: true,
    });
    if (enabled) {
      enabledIds.add(parsed.skill.id);
    } else {
      disabledIds.add(parsed.skill.id);
    }
  };

  for (const directoryPath of listSkillDirectories(enabledPath)) {
    register("enabled", directoryPath);
  }
  for (const directoryPath of listSkillDirectories(disabledPath)) {
    register("disabled", directoryPath);
  }

  const skills = [...skillsById.values()].sort((a, b) => a.id.localeCompare(b.id));
  const enabled = [...enabledIds].sort((a, b) => a.localeCompare(b));
  const disabled = [...disabledIds].sort((a, b) => a.localeCompare(b));
  invalid.sort((a, b) => `${a.id ?? ""}|${a.location}`.localeCompare(`${b.id ?? ""}|${b.location}`));

  const revisionSource = JSON.stringify({
    enabled,
    disabled,
    invalid,
    enabledPath,
    disabledPath,
    enabledMtimeMs: directoryMtimeMs(enabledPath),
    disabledMtimeMs: directoryMtimeMs(disabledPath),
  });
  const revision = createHash("sha256").update(revisionSource).digest("hex");

  return {
    skills,
    enabled,
    disabled,
    invalid,
    revision,
    enabledPath,
    disabledPath,
  };
}

export async function disposeOpencodeSkillInstance(config: AgentMockingbirdConfig) {
  await createOpencodeClientFromConnection({
    baseUrl: config.runtime.opencode.baseUrl,
    directory: config.runtime.opencode.directory,
  }).instance.dispose({
    responseStyle: "data",
    throwOnError: true,
    signal: AbortSignal.timeout(config.runtime.opencode.timeoutMs),
  });
}

export function buildManagedSkillPaths(currentConfig: Config, workspaceDir?: string | null) {
  const root = getManagedSkillsRootPath(workspaceDir);
  return normalizePathList([root]);
}

import { parse as parseJsonc } from "jsonc-parser";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { AgentMockingbirdConfig } from "../config/schema";
import { getConfigSnapshot } from "../config/service";
import {
  resolveOpencodeConfigDir,
  resolveOpencodeWorkspaceDir,
} from "../workspace/resolve";

const DEFAULT_BOOTSTRAP_FILE_NAMES = [
  "AGENTS.md",
  "SOUL.md",
  "TOOLS.md",
  "IDENTITY.md",
  "USER.md",
  "HEARTBEAT.md",
  "BOOTSTRAP.md",
  "MEMORY.md",
  "memory.md",
] as const;

const SUBAGENT_BOOTSTRAP_ALLOWLIST = new Set<string>(["AGENTS.md", "TOOLS.md"]);
const MIN_BOOTSTRAP_FILE_BUDGET_CHARS = 64;
const BOOTSTRAP_HEAD_RATIO = 0.7;
const BOOTSTRAP_TAIL_RATIO = 0.2;

const IDENTITY_PLACEHOLDER_VALUES = new Set([
  "pick something you like",
  "ai? robot? familiar? ghost in the machine? something weirder?",
  "how do you come across? sharp? warm? chaotic? calm?",
  "your signature - pick one that feels right",
  "workspace-relative path, http(s) url, or data uri",
]);

type BootstrapFileName = (typeof DEFAULT_BOOTSTRAP_FILE_NAMES)[number];

interface WorkspaceIdentityProfile {
  name?: string;
  emoji?: string;
  theme?: string;
  creature?: string;
  vibe?: string;
  avatar?: string;
}

interface BootstrapConfig {
  enabled: boolean;
  maxCharsPerFile: number;
  maxCharsTotal: number;
  subagentMinimal: boolean;
  includeAgentPrompt: boolean;
}

interface AgentRuntimeDetails {
  mode?: string;
  prompt?: string;
}

interface LoadedBootstrapFile {
  name: BootstrapFileName;
  path: string;
  content: string;
  missing: boolean;
  truncated: boolean;
  originalLength: number;
}

interface WorkspaceBootstrapPromptContext {
  section: string | null;
  workspaceDir: string;
  mode: "full" | "minimal";
  hasSoul: boolean;
  files: LoadedBootstrapFile[];
  identity: WorkspaceIdentityProfile | null;
  agentPrompt: string | null;
  agentPromptSource: string | null;
}

function resolveWorkspaceDir(config: AgentMockingbirdConfig): string {
  return resolveOpencodeWorkspaceDir(config);
}

function resolveBootstrapConfig(
  config: AgentMockingbirdConfig,
): BootstrapConfig {
  const source = config.runtime.opencode.bootstrap;
  return {
    enabled: source.enabled === true,
    maxCharsPerFile: source.maxCharsPerFile,
    maxCharsTotal: source.maxCharsTotal,
    subagentMinimal: source.subagentMinimal === true,
    includeAgentPrompt: source.includeAgentPrompt === true,
  };
}

function normalizeIdentityValue(value: string): string {
  let normalized = value.trim();
  normalized = normalized.replace(/^[*_]+|[*_]+$/g, "").trim();
  if (normalized.startsWith("(") && normalized.endsWith(")")) {
    normalized = normalized.slice(1, -1).trim();
  }
  normalized = normalized.replace(/[\u2013\u2014]/g, "-");
  normalized = normalized.replace(/\s+/g, " ").toLowerCase();
  return normalized;
}

function isIdentityPlaceholder(value: string): boolean {
  return IDENTITY_PLACEHOLDER_VALUES.has(normalizeIdentityValue(value));
}

function parseIdentityMarkdown(content: string): WorkspaceIdentityProfile {
  const identity: WorkspaceIdentityProfile = {};
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const cleaned = line.trim().replace(/^\s*-\s*/, "");
    const colonIndex = cleaned.indexOf(":");
    if (colonIndex === -1) continue;
    const label = cleaned
      .slice(0, colonIndex)
      .replace(/[*_]/g, "")
      .trim()
      .toLowerCase();
    const value = cleaned
      .slice(colonIndex + 1)
      .replace(/^[*_]+|[*_]+$/g, "")
      .trim();
    if (!value || isIdentityPlaceholder(value)) continue;
    if (label === "name") identity.name = value;
    if (label === "emoji") identity.emoji = value;
    if (label === "theme") identity.theme = value;
    if (label === "creature") identity.creature = value;
    if (label === "vibe") identity.vibe = value;
    if (label === "avatar") identity.avatar = value;
  }
  return identity;
}

function identityHasValues(identity: WorkspaceIdentityProfile): boolean {
  return Boolean(
    identity.name ||
    identity.emoji ||
    identity.theme ||
    identity.creature ||
    identity.vibe ||
    identity.avatar,
  );
}

function loadWorkspaceIdentityProfile(
  config: AgentMockingbirdConfig = getConfigSnapshot().config,
) {
  const workspaceDir = resolveWorkspaceDir(config);
  const identityPath = path.join(workspaceDir, "IDENTITY.md");
  if (!existsSync(identityPath)) return null;
  try {
    const raw = readFileSync(identityPath, "utf8");
    const parsed = parseIdentityMarkdown(raw);
    return identityHasValues(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function clampToBudget(content: string, budget: number): string {
  if (budget <= 0) return "";
  if (content.length <= budget) return content;
  if (budget <= 3) {
    return content.slice(0, budget);
  }
  return `${content.slice(0, budget - 1)}…`;
}

function trimBootstrapContent(
  content: string,
  fileName: string,
  maxChars: number,
) {
  const trimmed = content.trimEnd();
  if (trimmed.length <= maxChars) {
    return {
      content: trimmed,
      truncated: false,
      originalLength: trimmed.length,
    };
  }

  const headChars = Math.floor(maxChars * BOOTSTRAP_HEAD_RATIO);
  const tailChars = Math.floor(maxChars * BOOTSTRAP_TAIL_RATIO);
  const marker = [
    "",
    `[...truncated, read ${fileName} for full content...]`,
    `…(truncated ${fileName}: kept ${headChars}+${tailChars} chars of ${trimmed.length})…`,
    "",
  ].join("\n");

  return {
    content: [
      trimmed.slice(0, headChars),
      marker,
      trimmed.slice(-tailChars),
    ].join("\n"),
    truncated: true,
    originalLength: trimmed.length,
  };
}

function resolveOpencodeConfigFilePath(config: AgentMockingbirdConfig): string {
  return path.join(resolveOpencodeConfigDir(config), "opencode.jsonc");
}

function resolveAgentRuntimeDetails(
  config: AgentMockingbirdConfig,
  agentId: string,
): AgentRuntimeDetails | null {
  const trimmedId = agentId.trim();
  if (!trimmedId) return null;
  const configPath = resolveOpencodeConfigFilePath(config);
  if (!existsSync(configPath)) return null;
  try {
    const parsed = parseJsonc(readFileSync(configPath, "utf8")) as Record<
      string,
      unknown
    >;
    const agentMap = parsed?.agent;
    if (!agentMap || typeof agentMap !== "object" || Array.isArray(agentMap))
      return null;
    const rawEntry = (agentMap as Record<string, unknown>)[trimmedId];
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry))
      return null;
    const entry = rawEntry as Record<string, unknown>;
    return {
      mode:
        typeof entry.mode === "string"
          ? entry.mode.trim().toLowerCase()
          : undefined,
      prompt:
        typeof entry.prompt === "string" ? entry.prompt.trim() : undefined,
    };
  } catch {
    return null;
  }
}

function resolveBootstrapFileNames(
  mode: "full" | "minimal",
): Array<BootstrapFileName> {
  if (mode === "full") return [...DEFAULT_BOOTSTRAP_FILE_NAMES];
  return DEFAULT_BOOTSTRAP_FILE_NAMES.filter((name) =>
    SUBAGENT_BOOTSTRAP_ALLOWLIST.has(name),
  );
}

export function buildWorkspaceBootstrapPromptContext(input?: {
  agentId?: string;
  config?: AgentMockingbirdConfig;
}): WorkspaceBootstrapPromptContext {
  const config = input?.config ?? getConfigSnapshot().config;
  const workspaceDir = resolveWorkspaceDir(config);
  const bootstrap = resolveBootstrapConfig(config);
  const details = input?.agentId
    ? resolveAgentRuntimeDetails(config, input.agentId)
    : null;
  const mode: "full" | "minimal" =
    bootstrap.subagentMinimal && details?.mode === "subagent"
      ? "minimal"
      : "full";
  const agentPrompt =
    bootstrap.includeAgentPrompt && details?.prompt ? details.prompt : null;

  if (!bootstrap.enabled) {
    return {
      section: null,
      workspaceDir,
      mode,
      hasSoul: false,
      files: [],
      identity: loadWorkspaceIdentityProfile(config),
      agentPrompt,
      agentPromptSource: agentPrompt ? input?.agentId?.trim() || null : null,
    };
  }

  const fileNames = resolveBootstrapFileNames(mode);
  let remainingTotalChars = Math.max(1, bootstrap.maxCharsTotal);
  const files: LoadedBootstrapFile[] = [];

  for (const fileName of fileNames) {
    if (remainingTotalChars <= 0) break;
    const filePath = path.join(workspaceDir, fileName);
    if (!existsSync(filePath)) {
      const missing = `[MISSING] Expected at: ${filePath}`;
      const content = clampToBudget(missing, remainingTotalChars);
      if (!content) break;
      files.push({
        name: fileName,
        path: filePath,
        content,
        missing: true,
        truncated: false,
        originalLength: 0,
      });
      remainingTotalChars = Math.max(0, remainingTotalChars - content.length);
      continue;
    }
    if (remainingTotalChars < MIN_BOOTSTRAP_FILE_BUDGET_CHARS) {
      break;
    }
    const raw = readFileSync(filePath, "utf8");
    const maxChars = Math.max(
      1,
      Math.min(bootstrap.maxCharsPerFile, remainingTotalChars),
    );
    const trimmed = trimBootstrapContent(raw, fileName, maxChars);
    const content = clampToBudget(trimmed.content, remainingTotalChars);
    if (!content) continue;
    files.push({
      name: fileName,
      path: filePath,
      content,
      missing: false,
      truncated: trimmed.truncated || content.length < trimmed.content.length,
      originalLength: trimmed.originalLength,
    });
    remainingTotalChars = Math.max(0, remainingTotalChars - content.length);
  }

  const hasSoul = files.some(
    (file) => file.name.toLowerCase() === "soul.md" && !file.missing,
  );
  let section: string | null = null;
  if (files.length > 0) {
    const lines: string[] = [];
    lines.push(
      "# Project Context",
      "",
      "The following workspace context files have been loaded:",
    );
    if (hasSoul) {
      lines.push(
        "If SOUL.md is present, embody its persona and tone. Avoid stiff, generic replies; follow its guidance unless higher-priority instructions override it.",
      );
    }
    lines.push("");
    for (const file of files) {
      lines.push(`## ${file.name}`, "", file.content, "");
    }
    section = lines.filter(Boolean).join("\n");
  }

  return {
    section,
    workspaceDir,
    mode,
    hasSoul,
    files,
    identity: loadWorkspaceIdentityProfile(config),
    agentPrompt,
    agentPromptSource: agentPrompt ? input?.agentId?.trim() || null : null,
  };
}

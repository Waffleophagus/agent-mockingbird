import type { Message, OpencodeClient, Part, Session } from "@opencode-ai/sdk/client";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import type { Stats } from "node:fs";
import os from "node:os";
import path from "node:path";


import type { AgentMockingbirdConfig } from "../config/schema";
import { getConfigSnapshot } from "../config/service";
import { createOpencodeClientFromConnection, unwrapSdkData } from "../opencode/client";
import { resolveOpencodeWorkspaceDir } from "../workspace/resolve";

const EXCLUDED_DIR_NAMES = new Set([".git", "node_modules", ".next", "dist", "build", "coverage"]);
const MAX_DISCOVERED_FILES = 5_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_LLM_FILE_BYTES = 256 * 1024;
const REFERENCE_SNIPPET_MAX_CHARS = 3_500;

const INCLUDED_ROOT_PREFIXES = ["memory/", "scripts/", "cron/", "crons/", "skills/", ".agents/", ".agent/", ".opencode/"];
const INCLUDED_ROOT_FILES = new Set(["AGENTS.md", "SOUL.md", "IDENTITY.md", "CLAUDE.md", "README.md"]);
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
const TEXT_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".conf",
  ".cfg",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".mjs",
  ".cjs",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".sql",
  ".xml",
  ".html",
  ".css",
]);
const PROTECTED_TARGET_PATHS = new Set([
  ".opencode/opencode.jsonc",
  ".opencode/package.json",
  ".opencode/bun.lock",
  ".opencode/bun.lockb",
  ".opencode/node_modules",
]);


type OpenclawMergeChoice = {
  decision: "merge" | "keep_target" | "keep_source";
  mergedContent: string;
  notes?: string;
};

type OpenclawLlmMerger = {
  client: OpencodeClient;
  sessionId: string;
  model: {
    providerId: string;
    modelId: string;
  };
  timeoutMs: number;
  openclawContext: string;
  opencodeContext: string;
};

export type OpenclawImportSource =
  | { mode: "local"; path: string }
  | { mode: "git"; url: string; ref?: string };

export interface OpenclawMigrationInput {
  source: OpenclawImportSource;
  targetDirectory?: string;
  config?: AgentMockingbirdConfig;
}

interface MaterializedImportSource {
  mode: "local" | "git";
  resolvedDirectory: string;
  url?: string;
  requestedRef?: string;
  resolvedRef?: string;
  commit?: string;
}

interface DiscoveredSourceFile {
  relativePath: string;
  sourcePath: string;
  targetRelativePath: string;
  sourceHash: string;
  sizeBytes: number;
  notes?: string[];
}

export interface OpenclawMigrationResult {
  source: {
    mode: "local" | "git";
    resolvedDirectory: string;
    url?: string;
    requestedRef?: string;
    resolvedRef?: string;
    commit?: string;
  };
  targetDirectory: string;
  discoveredCount: number;
  copied: Array<{ relativePath: string; sourcePath: string; targetPath: string }>;
  merged: Array<{ relativePath: string; sourcePath: string; targetPath: string; strategy: "llm" | "deterministic" }>;
  skippedExisting: Array<{ relativePath: string; targetPath: string }>;
  skippedIdentical: Array<{ relativePath: string; targetPath: string }>;
  skippedProtected: Array<{ relativePath: string; targetPath: string }>;
  failed: Array<{ relativePath: string; reason: string }>;
  warnings: string[];
  summary: {
    discovered: number;
    copied: number;
    merged: number;
    mergedByLlm: number;
    mergedDeterministic: number;
    skippedExisting: number;
    skippedIdentical: number;
    skippedProtected: number;
    failed: number;
  };
}

function resolveWorkspaceDir(config: AgentMockingbirdConfig): string {
  return resolveOpencodeWorkspaceDir(config);
}

function importCacheRoot() {
  return path.join(os.tmpdir(), "agent-mockingbird-openclaw-import");
}

function gitCacheRootDir() {
  return path.join(importCacheRoot(), "git");
}

function ensureDir(dirPath: string) {
  mkdirSync(dirPath, { recursive: true });
}

function normalizeRelativePath(relPath: string) {
  return relPath.split(path.sep).join("/");
}

function normalizeCaseInsensitivePath(relPath: string) {
  return normalizeRelativePath(relPath).toLowerCase();
}

function assertInsideRoot(root: string, candidate: string) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes source root: ${candidate}`);
  }
}

function hashFile(filePath: string) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

type TargetPathState =
  | { kind: "missing" }
  | { kind: "file"; hash: string }
  | { kind: "non-file"; fileType: string };

function describeFileType(stats: Stats) {
  if (stats.isFile()) return "file";
  if (stats.isDirectory()) return "directory";
  if (stats.isSymbolicLink()) return "symlink";
  if (stats.isBlockDevice()) return "block-device";
  if (stats.isCharacterDevice()) return "character-device";
  if (stats.isFIFO()) return "fifo";
  if (stats.isSocket()) return "socket";
  return "other";
}

function readTargetPathState(targetPath: string): TargetPathState {
  try {
    const stats = lstatSync(targetPath);
    const fileType = describeFileType(stats);
    if (!stats.isFile()) return { kind: "non-file", fileType };
    return { kind: "file", hash: hashFile(targetPath) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "missing" };
    }
    throw error;
  }
}

function runGit(args: string[], cwd?: string) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    cwd,
  });
  if (result.status !== 0) {
    const output = `${result.stderr || ""}${result.stdout || ""}`.trim();
    throw new Error(output || `git ${args.join(" ")} failed`);
  }
  return (result.stdout || "").trim();
}

function resolveDefaultRemoteBranch(repoDir: string) {
  const head = runGit(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], repoDir);
  const slash = head.indexOf("/");
  if (slash === -1) return head;
  return head.slice(slash + 1);
}

function materializeGitSource(input: { url: string; ref?: string }): MaterializedImportSource {
  const rawUrl = input.url.trim();
  if (!rawUrl) {
    throw new Error("source.url is required for git import");
  }

  ensureDir(gitCacheRootDir());
  const key = createHash("sha256")
    .update(`${rawUrl}\n${(input.ref ?? "").trim()}`)
    .digest("hex")
    .slice(0, 16);
  const repoDir = path.join(gitCacheRootDir(), key);

  if (!existsSync(path.join(repoDir, ".git"))) {
    rmSync(repoDir, { recursive: true, force: true });
    runGit(["clone", "--quiet", rawUrl, repoDir]);
  } else {
    runGit(["fetch", "--all", "--prune"], repoDir);
  }

  const resolvedRef = (input.ref ?? "").trim() || resolveDefaultRemoteBranch(repoDir);
  runGit(["checkout", "--force", resolvedRef], repoDir);
  if (!(input.ref ?? "").trim()) {
    runGit(["pull", "--ff-only"], repoDir);
  }

  const commit = runGit(["rev-parse", "HEAD"], repoDir);
  return {
    mode: "git",
    resolvedDirectory: repoDir,
    url: rawUrl,
    requestedRef: (input.ref ?? "").trim() || undefined,
    resolvedRef,
    commit,
  };
}

function materializeLocalSource(input: { path: string }): MaterializedImportSource {
  const sourcePath = input.path.trim();
  if (!sourcePath) {
    throw new Error("source.path is required for local import");
  }
  const resolvedDirectory = path.resolve(sourcePath);
  const stats = statSync(resolvedDirectory);
  if (!stats.isDirectory()) {
    throw new Error(`source.path is not a directory: ${resolvedDirectory}`);
  }
  return {
    mode: "local",
    resolvedDirectory,
  };
}

function materializeSource(source: OpenclawImportSource): MaterializedImportSource {
  return source.mode === "git" ? materializeGitSource(source) : materializeLocalSource(source);
}

function shouldIncludePath(relativePath: string): boolean {
  if (!relativePath || relativePath.startsWith("../")) return false;
  const normalized = normalizeRelativePath(relativePath);
  const baseName = path.basename(normalized);
  if (INCLUDED_ROOT_FILES.has(baseName)) return true;
  if (!normalized.includes("/") && isMarkdownPath(normalized)) return true;
  return INCLUDED_ROOT_PREFIXES.some(prefix => normalized.startsWith(prefix));
}

function mapTargetRelativePath(relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath);
  if (normalized.startsWith("skills/")) {
    return `.agents/skills/${normalized.slice("skills/".length)}`;
  }
  return normalized;
}

function discoverMigrationFiles(sourceDirectory: string) {
  const warnings: string[] = [];
  const discovered: Omit<DiscoveredSourceFile, "targetRelativePath" | "notes">[] = [];

  const walk = (dirPath: string) => {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "." || entry.name === "..") continue;
      if (entry.isDirectory() && EXCLUDED_DIR_NAMES.has(entry.name)) continue;

      const absolutePath = path.join(dirPath, entry.name);
      const relativePath = normalizeRelativePath(path.relative(sourceDirectory, absolutePath));
      if (!relativePath || relativePath.startsWith("../")) continue;

      let stats;
      try {
        stats = lstatSync(absolutePath);
      } catch (error) {
        warnings.push(
          `Skipped unreadable path ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }

      if (stats.isSymbolicLink()) {
        try {
          const resolved = realpathSync(absolutePath);
          assertInsideRoot(sourceDirectory, resolved);
        } catch {
          warnings.push(`Skipped symlink outside source root: ${relativePath}`);
          continue;
        }
      }

      if (stats.isDirectory()) {
        walk(absolutePath);
        continue;
      }

      if (!stats.isFile()) continue;
      if (!shouldIncludePath(relativePath)) continue;

      if (stats.size > MAX_FILE_BYTES) {
        warnings.push(`Skipped large file ${relativePath} (${stats.size} bytes)`);
        continue;
      }

      if (discovered.length >= MAX_DISCOVERED_FILES) {
        warnings.push(`Reached file limit (${MAX_DISCOVERED_FILES}); remaining files were skipped`);
        return;
      }

      discovered.push({
        relativePath,
        sourcePath: absolutePath,
        sourceHash: hashFile(absolutePath),
        sizeBytes: stats.size,
      });
    }
  };

  walk(sourceDirectory);
  const hasAgentsSource = discovered.some(file => normalizeCaseInsensitivePath(file.relativePath) === "agents.md");
  const files: DiscoveredSourceFile[] = discovered.map((file) => {
    const normalized = normalizeCaseInsensitivePath(file.relativePath);
    const notes: string[] = [];
    let targetRelativePath = mapTargetRelativePath(file.relativePath);

    // Compatibility bridge: OpenClaw commonly stores top-level prompt guidance in CLAUDE.md.
    if (normalized === "claude.md" && !hasAgentsSource) {
      targetRelativePath = "AGENTS.md";
      notes.push("compat_map:CLAUDE.md->AGENTS.md");
      warnings.push("Mapped CLAUDE.md to AGENTS.md because source AGENTS.md was not present");
    }

    return {
      ...file,
      targetRelativePath,
      notes,
    };
  });
  return { files, warnings };
}

function resolveTargetDirectory(input: { targetDirectory?: string; config?: AgentMockingbirdConfig }) {
  if (input.targetDirectory?.trim()) {
    return path.resolve(input.targetDirectory.trim());
  }
  const config = input.config ?? getConfigSnapshot().config;
  return resolveWorkspaceDir(config);
}

function isMarkdownPath(filePath: string) {
  return MARKDOWN_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isLikelyTextPath(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_EXTENSIONS.has(ext) || ext === "";
}

const OPENCLAW_SPECIFIC_PATTERNS = [
  /\bopenclaw\b/i,
  /\bclaude\.md\b/i,
  /\bclaude code\b/i,
];

function isAgentInstructionsPath(relativePath: string) {
  return normalizeCaseInsensitivePath(relativePath) === "agents.md";
}

function validateAgentMergeContent(content: string): string | null {
  if (!content.trim()) return "merged content was empty";
  const offenders = OPENCLAW_SPECIFIC_PATTERNS.filter(pattern => pattern.test(content));
  if (!offenders.length) return null;
  return "merged content still contained OpenClaw-specific references";
}

function clipForPrompt(text: string, limit = REFERENCE_SNIPPET_MAX_CHARS) {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  const head = Math.floor(limit * 0.65);
  const tail = Math.floor(limit * 0.35);
  return `${trimmed.slice(0, head)}\n\n...[truncated ${trimmed.length - limit} chars]...\n\n${trimmed.slice(-tail)}`;
}

function readPromptReferenceIfExists(filePath: string) {
  try {
    if (!existsSync(filePath)) return "";
    return clipForPrompt(readFileSync(filePath, "utf8"));
  } catch {
    return "";
  }
}

function loadExternalReferenceContexts() {
  const openclawAgents = readPromptReferenceIfExists("/tmp/openclaw/AGENTS.md");
  const openclawReadme = readPromptReferenceIfExists("/tmp/openclaw/README.md");
  const opencodeAgents = readPromptReferenceIfExists("/tmp/opencode-7vCebI/AGENTS.md");
  const opencodeReadme = readPromptReferenceIfExists("/tmp/opencode-7vCebI/README.md");

  const openclawContext = [
    "# OpenClaw reference",
    openclawAgents ? `## AGENTS.md\n${openclawAgents}` : "",
    openclawReadme ? `## README.md\n${openclawReadme}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const opencodeContext = [
    "# OpenCode/Waffle-style reference",
    opencodeAgents ? `## AGENTS.md\n${opencodeAgents}` : "",
    opencodeReadme ? `## README.md\n${opencodeReadme}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { openclawContext, opencodeContext };
}

function decodeTextFileIfPossible(filePath: string, maxBytes = MAX_LLM_FILE_BYTES): string | null {
  const buffer = readFileSync(filePath);
  if (buffer.length > maxBytes) return null;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] === 0) return null;
  }
  return buffer.toString("utf8");
}

function extractAssistantText(parts: Array<Part>) {
  const text = parts
    .filter((part): part is Extract<Part, { type: "text" }> => part.type === "text")
    .map(part => part.text.trim())
    .filter(Boolean)
    .join("\n\n");
  return text || null;
}

function parseMergeChoice(text: string): OpenclawMergeChoice | null {
  const candidates: string[] = [text];
  const fenced = /```json\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]) candidates.push(fenced[1]);
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Partial<OpenclawMergeChoice>;
      if (typeof parsed?.mergedContent !== "string") continue;
      const rawDecision = typeof parsed.decision === "string" ? parsed.decision.trim().toLowerCase() : "merge";
      const decision = rawDecision === "keep_target" || rawDecision === "keep_source" ? rawDecision : "merge";
      return {
        decision,
        mergedContent: parsed.mergedContent,
        notes: typeof parsed.notes === "string" ? parsed.notes : undefined,
      };
    } catch {
      // try next format
    }
  }
  return null;
}

function buildLlmMergePrompt(input: {
  sourceRelativePath: string;
  relativePath: string;
  sourceContent: string;
  targetContent: string;
  openclawContext: string;
  opencodeContext: string;
}) {
  return [
    "You are migrating an OpenClaw workspace file into a Agent Mockingbird/OpenCode workspace.",
    "Return ONLY valid JSON with this exact shape:",
    '{"decision":"merge|keep_target|keep_source","mergedContent":"...","notes":"optional"}',
    "Rules:",
    "1) Remove or rewrite OpenClaw-specific instructions, names, and references.",
    "2) Keep existing Agent Mockingbird/OpenCode-specific instructions from target when there is conflict.",
    "3) Preserve useful non-platform-specific content from source.",
    "4) Output full final file in mergedContent (no markdown fences).",
    "5) Prefer merge unless source is clearly incompatible.",
    "6) Remove references to OpenClaw internals, OpenClaw commands, and CLAUDE.md conventions.",
    "7) Keep result concise and instruction-focused for AGENTS.md.",
    "",
    `Target path: ${input.relativePath}`,
    `Source path: ${input.sourceRelativePath}`,
    "",
    input.openclawContext ? `Reference context (OpenClaw):\n${input.openclawContext}` : "",
    input.opencodeContext ? `Reference context (OpenCode/Waffle):\n${input.opencodeContext}` : "",
    "",
    `Current target file:\n\n${clipForPrompt(input.targetContent, 10_000)}`,
    "",
    `Incoming source file:\n\n${clipForPrompt(input.sourceContent, 10_000)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function createLlmMerger(config: AgentMockingbirdConfig, warnings: string[]): Promise<OpenclawLlmMerger | null> {
  if (process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test") {
    return null;
  }
  if (process.env.AGENT_MOCKINGBIRD_DISABLE_OPENCLAW_LLM_MERGE === "1") {
    warnings.push("LLM merge disabled via AGENT_MOCKINGBIRD_DISABLE_OPENCLAW_LLM_MERGE=1");
    return null;
  }

  const providerId = config.runtime.opencode.providerId.trim();
  const modelId = config.runtime.opencode.modelId.trim();
  if (!providerId || !modelId) {
    warnings.push("LLM merge unavailable: runtime.opencode provider/model is not configured");
    return null;
  }

  const timeoutMs = Math.max(2_000, Math.min(config.runtime.opencode.timeoutMs, 20_000));
  const client = createOpencodeClientFromConnection({
    baseUrl: config.runtime.opencode.baseUrl,
    directory: config.runtime.opencode.directory,
  });

  try {
    const session = unwrapSdkData<Session>(
      await client.session.create({
        body: { title: "agent-mockingbird-openclaw-merge" },
        responseStyle: "data",
        throwOnError: true,
        signal: AbortSignal.timeout(timeoutMs),
      }),
    );
    const references = loadExternalReferenceContexts();
    return {
      client,
      sessionId: session.id,
      model: { providerId, modelId },
      timeoutMs,
      openclawContext: references.openclawContext,
      opencodeContext: references.opencodeContext,
    };
  } catch (error) {
    warnings.push(`LLM merge unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function tryLlmMergeConflict(input: {
  merger: OpenclawLlmMerger;
  sourceRelativePath: string;
  relativePath: string;
  sourceContent: string;
  targetContent: string;
}): Promise<OpenclawMergeChoice | null> {
  const prompt = buildLlmMergePrompt({
    sourceRelativePath: input.sourceRelativePath,
    relativePath: input.relativePath,
    sourceContent: input.sourceContent,
    targetContent: input.targetContent,
    openclawContext: input.merger.openclawContext,
    opencodeContext: input.merger.opencodeContext,
  });

  const response = unwrapSdkData<{ info: Message; parts: Array<Part> }>(
    await input.merger.client.session.prompt({
      path: { id: input.merger.sessionId },
      body: {
        model: {
          providerID: input.merger.model.providerId,
          modelID: input.merger.model.modelId,
        },
        parts: [{ type: "text", text: prompt }],
      },
      responseStyle: "data",
      throwOnError: true,
      signal: AbortSignal.timeout(input.merger.timeoutMs),
    }),
  );

  if (response.info.role !== "assistant") {
    throw new Error(`unexpected merge role: ${response.info.role}`);
  }

  const text = extractAssistantText(response.parts);
  if (!text) {
    throw new Error("merge response did not include assistant text");
  }
  return parseMergeChoice(text);
}

export async function migrateOpenclawWorkspace(input: OpenclawMigrationInput): Promise<OpenclawMigrationResult> {
  const source = materializeSource(input.source);
  const config = input.config ?? getConfigSnapshot().config;
  const targetDirectory = resolveTargetDirectory({ targetDirectory: input.targetDirectory, config });
  ensureDir(targetDirectory);

  const discovered = discoverMigrationFiles(source.resolvedDirectory);
  const copied: OpenclawMigrationResult["copied"] = [];
  const merged: OpenclawMigrationResult["merged"] = [];
  const skippedExisting: OpenclawMigrationResult["skippedExisting"] = [];
  const skippedIdentical: OpenclawMigrationResult["skippedIdentical"] = [];
  const skippedProtected: OpenclawMigrationResult["skippedProtected"] = [];
  const failed: OpenclawMigrationResult["failed"] = [];
  const warnings = [...discovered.warnings];

  let llmMerger: OpenclawLlmMerger | null | undefined = undefined;

  for (const file of discovered.files) {
    const targetPath = path.join(targetDirectory, file.targetRelativePath);
    const protectedMatch = [...PROTECTED_TARGET_PATHS].find(protectedPath => {
      const normalizedTarget = normalizeCaseInsensitivePath(file.targetRelativePath);
      const normalizedProtected = normalizeCaseInsensitivePath(protectedPath);
      return normalizedTarget === normalizedProtected || normalizedTarget.startsWith(`${normalizedProtected}/`);
    });
    if (protectedMatch) {
      skippedProtected.push({ relativePath: file.targetRelativePath, targetPath });
      continue;
    }

    try {
      const targetState = readTargetPathState(targetPath);
      if (targetState.kind === "missing") {
        ensureDir(path.dirname(targetPath));
        copyFileSync(file.sourcePath, targetPath);
        copied.push({ relativePath: file.targetRelativePath, sourcePath: file.sourcePath, targetPath });
        continue;
      }
      if (targetState.kind === "non-file") {
        failed.push({
          relativePath: file.targetRelativePath,
          reason: `cannot write over ${targetState.fileType} target: ${targetPath}`,
        });
        continue;
      }
      if (targetState.hash === file.sourceHash) {
        skippedIdentical.push({ relativePath: file.targetRelativePath, targetPath });
        continue;
      }

      const sourceText =
        file.sizeBytes <= MAX_LLM_FILE_BYTES && isLikelyTextPath(file.sourcePath)
          ? decodeTextFileIfPossible(file.sourcePath)
          : null;
      const targetText =
        isLikelyTextPath(targetPath) && statSync(targetPath).size <= MAX_LLM_FILE_BYTES
          ? decodeTextFileIfPossible(targetPath)
          : null;

      if (sourceText !== null && targetText !== null && isAgentInstructionsPath(file.targetRelativePath)) {
        if (typeof llmMerger === "undefined") {
          llmMerger = await createLlmMerger(config, warnings);
        }

        if (llmMerger) {
          try {
            const choice = await tryLlmMergeConflict({
              merger: llmMerger,
              sourceRelativePath: file.relativePath,
              relativePath: file.targetRelativePath,
              sourceContent: sourceText,
              targetContent: targetText,
            });
            if (choice) {
              if (choice.decision === "keep_target") {
                skippedExisting.push({ relativePath: file.targetRelativePath, targetPath });
                continue;
              }
              if (choice.decision === "keep_source") {
                ensureDir(path.dirname(targetPath));
                copyFileSync(file.sourcePath, targetPath);
                merged.push({ relativePath: file.targetRelativePath, sourcePath: file.sourcePath, targetPath, strategy: "llm" });
                continue;
              }
              const normalizedContent = choice.mergedContent.endsWith("\n")
                ? choice.mergedContent
                : `${choice.mergedContent}\n`;
              if (isAgentInstructionsPath(file.targetRelativePath)) {
                const invalidReason = validateAgentMergeContent(normalizedContent);
                if (invalidReason) {
                  warnings.push(
                    `LLM merge rejected for ${file.targetRelativePath}: ${invalidReason}; keeping existing target`,
                  );
                  skippedExisting.push({ relativePath: file.targetRelativePath, targetPath });
                  continue;
                }
              }
              const mergedHash = createHash("sha256").update(normalizedContent).digest("hex");
              if (mergedHash === targetState.hash) {
                skippedIdentical.push({ relativePath: file.targetRelativePath, targetPath });
                continue;
              }
              writeFileSync(targetPath, normalizedContent, "utf8");
              merged.push({ relativePath: file.targetRelativePath, sourcePath: file.sourcePath, targetPath, strategy: "llm" });
              continue;
            }
            warnings.push(`LLM merge returned invalid JSON for ${file.targetRelativePath}; keeping existing target`);
          } catch (error) {
            warnings.push(
              `LLM merge failed for ${file.targetRelativePath}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }

      if (isAgentInstructionsPath(file.targetRelativePath)) {
        warnings.push(`Skipped AGENTS.md merge for ${file.relativePath}; smart merge was unavailable`);
      }
      skippedExisting.push({ relativePath: file.targetRelativePath, targetPath });
    } catch (error) {
      failed.push({
        relativePath: file.targetRelativePath,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const mergedByLlm = merged.filter(entry => entry.strategy === "llm").length;
  const mergedDeterministic = merged.length - mergedByLlm;

  return {
    source,
    targetDirectory,
    discoveredCount: discovered.files.length,
    copied,
    merged,
    skippedExisting,
    skippedIdentical,
    skippedProtected,
    failed,
    warnings,
    summary: {
      discovered: discovered.files.length,
      copied: copied.length,
      merged: merged.length,
      mergedByLlm,
      mergedDeterministic,
      skippedExisting: skippedExisting.length,
      skippedIdentical: skippedIdentical.length,
      skippedProtected: skippedProtected.length,
      failed: failed.length,
    },
  };
}

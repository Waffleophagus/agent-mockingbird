import { randomUUID, createHash } from "node:crypto";
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
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import type { WafflebotConfig } from "../config/schema";
import { getConfigSnapshot } from "../config/service";
import { syncMemoryIndex } from "../memory/service";

const EXCLUDED_DIR_NAMES = new Set([".git", "node_modules"]);
const PREVIEW_TTL_MS = 15 * 60 * 1000;
const MAX_DISCOVERED_FILES = 5_000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export type OpenclawImportSource =
  | { mode: "local"; path: string }
  | { mode: "git"; url: string; ref?: string };

export interface OpenclawImportPreviewInput {
  source: OpenclawImportSource;
  targetDirectory?: string;
  config?: WafflebotConfig;
}

export interface OpenclawImportPreviewFile {
  relativePath: string;
  sourcePath: string;
  targetPath: string;
  sourceHash: string;
  targetHash: string | null;
  status: "new" | "identical" | "conflict";
  sizeBytes: number;
}

export interface OpenclawImportPreviewResult {
  previewId: string;
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
  filesNew: OpenclawImportPreviewFile[];
  filesIdentical: OpenclawImportPreviewFile[];
  filesConflicting: OpenclawImportPreviewFile[];
  warnings: string[];
  expiresAt: string;
}

export interface OpenclawImportApplyInput {
  previewId: string;
  overwritePaths?: unknown;
  skipPaths?: unknown;
  runMemorySync?: boolean;
}

export interface OpenclawImportApplyResult {
  previewId: string;
  sourceDirectory: string;
  targetDirectory: string;
  copied: Array<{ relativePath: string; sourcePath: string; targetPath: string }>;
  skippedExisting: Array<{ relativePath: string; targetPath: string }>;
  skippedIdentical: Array<{ relativePath: string; targetPath: string }>;
  skippedRequested: Array<{ relativePath: string; targetPath: string }>;
  failed: Array<{ relativePath: string; reason: string }>;
  memorySync:
    | { status: "disabled" }
    | { status: "completed" }
    | { status: "failed"; error: string };
  summary: {
    copied: number;
    skippedExisting: number;
    skippedIdentical: number;
    skippedRequested: number;
    failed: number;
  };
}

interface MaterializedImportSource {
  mode: "local" | "git";
  resolvedDirectory: string;
  url?: string;
  requestedRef?: string;
  resolvedRef?: string;
  commit?: string;
}

interface OpenclawImportPreviewManifest {
  previewId: string;
  createdAt: string;
  expiresAt: string;
  source: MaterializedImportSource;
  targetDirectory: string;
  files: OpenclawImportPreviewFile[];
}

function resolveWorkspaceDir(config: WafflebotConfig): string {
  return config.runtime.opencode.directory?.trim() || process.cwd();
}

function importCacheRoot() {
  return path.join(os.tmpdir(), "wafflebot-openclaw-import");
}

function previewRootDir() {
  return path.join(importCacheRoot(), "previews");
}

function gitCacheRootDir() {
  return path.join(importCacheRoot(), "git");
}

function ensureDir(dirPath: string) {
  mkdirSync(dirPath, { recursive: true });
}

function isMarkdownFile(filePath: string) {
  const lower = filePath.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown");
}

function normalizeRelativePath(relPath: string) {
  return relPath.split(path.sep).join("/");
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

function describeFileType(stats: ReturnType<typeof lstatSync>) {
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

function normalizeStringArray(input: unknown) {
  if (!Array.isArray(input)) return new Set<string>();
  const normalized = new Set<string>();
  for (const entry of input) {
    if (typeof entry !== "string") continue;
    const trimmed = normalizeRelativePath(entry.trim());
    if (!trimmed) continue;
    normalized.add(trimmed);
  }
  return normalized;
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

function discoverMarkdownFiles(sourceDirectory: string) {
  const warnings: string[] = [];
  const files: Array<{ relativePath: string; sourcePath: string; sourceHash: string; sizeBytes: number }> = [];

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
      if (!isMarkdownFile(relativePath)) continue;

      if (stats.size > MAX_FILE_BYTES) {
        warnings.push(`Skipped large markdown file ${relativePath} (${stats.size} bytes)`);
        continue;
      }

      if (files.length >= MAX_DISCOVERED_FILES) {
        warnings.push(`Reached file limit (${MAX_DISCOVERED_FILES}); remaining markdown files were skipped`);
        return;
      }

      files.push({
        relativePath,
        sourcePath: absolutePath,
        sourceHash: hashFile(absolutePath),
        sizeBytes: stats.size,
      });
    }
  };

  walk(sourceDirectory);
  return { files, warnings };
}

function resolveTargetDirectory(input: { targetDirectory?: string; config?: WafflebotConfig }) {
  if (input.targetDirectory?.trim()) {
    return path.resolve(input.targetDirectory.trim());
  }
  const config = input.config ?? getConfigSnapshot().config;
  return resolveWorkspaceDir(config);
}

function sweepExpiredPreviews(now = Date.now()) {
  ensureDir(previewRootDir());
  const entries = readdirSync(previewRootDir(), { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const manifestPath = path.join(previewRootDir(), entry.name);
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as OpenclawImportPreviewManifest;
      const expiresAt = Date.parse(manifest.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= now) {
        rmSync(manifestPath, { force: true });
      }
    } catch {
      rmSync(manifestPath, { force: true });
    }
  }
}

function writePreviewManifest(manifest: OpenclawImportPreviewManifest) {
  ensureDir(previewRootDir());
  const manifestPath = path.join(previewRootDir(), `${manifest.previewId}.json`);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function readPreviewManifest(previewId: string): OpenclawImportPreviewManifest {
  if (!previewId.trim()) {
    throw new Error("previewId is required");
  }
  const manifestPath = path.join(previewRootDir(), `${previewId.trim()}.json`);
  if (!existsSync(manifestPath)) {
    throw new Error(`previewId not found: ${previewId}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as OpenclawImportPreviewManifest;
  const expiresAt = Date.parse(manifest.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    rmSync(manifestPath, { force: true });
    throw new Error(`previewId expired: ${previewId}`);
  }
  return manifest;
}

export function previewOpenclawImport(input: OpenclawImportPreviewInput): OpenclawImportPreviewResult {
  sweepExpiredPreviews();

  const source = materializeSource(input.source);
  const targetDirectory = resolveTargetDirectory(input);
  ensureDir(targetDirectory);

  const discovered = discoverMarkdownFiles(source.resolvedDirectory);
  const filesNew: OpenclawImportPreviewFile[] = [];
  const filesIdentical: OpenclawImportPreviewFile[] = [];
  const filesConflicting: OpenclawImportPreviewFile[] = [];

  for (const file of discovered.files) {
    const targetPath = path.join(targetDirectory, file.relativePath);
    const targetState = readTargetPathState(targetPath);
    const targetHash = targetState.kind === "file" ? targetState.hash : null;
    const status: OpenclawImportPreviewFile["status"] =
      targetState.kind === "missing" ? "new" : targetHash === file.sourceHash ? "identical" : "conflict";

    const previewFile: OpenclawImportPreviewFile = {
      relativePath: file.relativePath,
      sourcePath: file.sourcePath,
      targetPath,
      sourceHash: file.sourceHash,
      targetHash,
      status,
      sizeBytes: file.sizeBytes,
    };

    if (status === "new") filesNew.push(previewFile);
    if (status === "identical") filesIdentical.push(previewFile);
    if (status === "conflict") filesConflicting.push(previewFile);
  }

  const previewId = randomUUID();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS).toISOString();
  writePreviewManifest({
    previewId,
    createdAt,
    expiresAt,
    source,
    targetDirectory,
    files: [...filesNew, ...filesIdentical, ...filesConflicting],
  });

  return {
    previewId,
    source,
    targetDirectory,
    discoveredCount: discovered.files.length,
    filesNew,
    filesIdentical,
    filesConflicting,
    warnings: discovered.warnings,
    expiresAt,
  };
}

export async function applyOpenclawImport(input: OpenclawImportApplyInput): Promise<OpenclawImportApplyResult> {
  sweepExpiredPreviews();

  const manifest = readPreviewManifest(input.previewId);
  const overwritePaths = normalizeStringArray(input.overwritePaths);
  const skipPaths = normalizeStringArray(input.skipPaths);

  const copied: OpenclawImportApplyResult["copied"] = [];
  const skippedExisting: OpenclawImportApplyResult["skippedExisting"] = [];
  const skippedIdentical: OpenclawImportApplyResult["skippedIdentical"] = [];
  const skippedRequested: OpenclawImportApplyResult["skippedRequested"] = [];
  const failed: OpenclawImportApplyResult["failed"] = [];

  for (const file of manifest.files) {
    if (skipPaths.has(file.relativePath)) {
      skippedRequested.push({ relativePath: file.relativePath, targetPath: file.targetPath });
      continue;
    }
    try {
      if (!existsSync(file.sourcePath)) {
        failed.push({ relativePath: file.relativePath, reason: `source file no longer exists: ${file.sourcePath}` });
        continue;
      }
      const currentHash = hashFile(file.sourcePath);
      if (currentHash !== file.sourceHash) {
        failed.push({ relativePath: file.relativePath, reason: "source file changed after preview; rerun preview" });
        continue;
      }

      const targetState = readTargetPathState(file.targetPath);
      if (targetState.kind === "file" && targetState.hash === file.sourceHash) {
        skippedIdentical.push({ relativePath: file.relativePath, targetPath: file.targetPath });
        continue;
      }
      if (targetState.kind !== "missing" && !overwritePaths.has(file.relativePath)) {
        skippedExisting.push({ relativePath: file.relativePath, targetPath: file.targetPath });
        continue;
      }
      if (targetState.kind === "non-file") {
        failed.push({
          relativePath: file.relativePath,
          reason: `cannot overwrite ${targetState.fileType} target: ${file.targetPath}`,
        });
        continue;
      }

      ensureDir(path.dirname(file.targetPath));
      copyFileSync(file.sourcePath, file.targetPath);
      copied.push({
        relativePath: file.relativePath,
        sourcePath: file.sourcePath,
        targetPath: file.targetPath,
      });
    } catch (error) {
      failed.push({
        relativePath: file.relativePath,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  let memorySync: OpenclawImportApplyResult["memorySync"] = { status: "disabled" };
  const shouldSync = input.runMemorySync !== false;
  if (shouldSync) {
    try {
      await syncMemoryIndex();
      memorySync = { status: "completed" };
    } catch (error) {
      memorySync = {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    previewId: manifest.previewId,
    sourceDirectory: manifest.source.resolvedDirectory,
    targetDirectory: manifest.targetDirectory,
    copied,
    skippedExisting,
    skippedIdentical,
    skippedRequested,
    failed,
    memorySync,
    summary: {
      copied: copied.length,
      skippedExisting: skippedExisting.length,
      skippedIdentical: skippedIdentical.length,
      skippedRequested: skippedRequested.length,
      failed: failed.length,
    },
  };
}

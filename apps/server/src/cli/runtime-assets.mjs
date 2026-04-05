import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const STATE_VERSION = 1;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeRelativePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function listRelativeFiles(rootDir, currentDir = rootDir) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listRelativeFiles(rootDir, absolutePath));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    files.push(normalizeRelativePath(path.relative(rootDir, absolutePath)));
  }
  files.sort((left, right) => left.localeCompare(right));
  return files;
}

function hashFile(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

function safeReadState(stateFilePath) {
  if (!fs.existsSync(stateFilePath)) {
    return { version: STATE_VERSION, files: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFilePath, "utf8"));
    const files = typeof parsed?.files === "object" && parsed.files ? parsed.files : {};
    return {
      version: Number.isInteger(parsed?.version) ? parsed.version : STATE_VERSION,
      files,
    };
  } catch {
    return { version: STATE_VERSION, files: {} };
  }
}

function writeState(stateFilePath, state) {
  ensureDir(path.dirname(stateFilePath));
  fs.writeFileSync(stateFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function timestampForBackup(now = new Date()) {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const hours = String(now.getUTCHours()).padStart(2, "0");
  const minutes = String(now.getUTCMinutes()).padStart(2, "0");
  const seconds = String(now.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function makeBackupPath(targetFilePath) {
  const stamp = timestampForBackup();
  let candidate = `${targetFilePath}.backup-${stamp}`;
  let suffix = 1;
  while (fs.existsSync(candidate)) {
    candidate = `${targetFilePath}.backup-${stamp}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function readDecision(value) {
  if (value === "keep-local" || value === "use-packaged") {
    return value;
  }
  return "use-packaged";
}

export async function syncRuntimeWorkspaceAssets(input) {
  const mode = input?.mode === "update" ? "update" : "install";
  const rawSourceWorkspaceDir =
    typeof input?.sourceWorkspaceDir === "string" ? input.sourceWorkspaceDir.trim() : "";
  const rawTargetWorkspaceDir =
    typeof input?.targetWorkspaceDir === "string" ? input.targetWorkspaceDir.trim() : "";
  const rawStateFilePath =
    typeof input?.stateFilePath === "string" ? input.stateFilePath.trim() : "";

  if (!rawSourceWorkspaceDir) {
    throw new Error("runtime asset source directory is required");
  }
  if (!rawTargetWorkspaceDir) {
    throw new Error("runtime asset target directory is required");
  }
  if (!rawStateFilePath) {
    throw new Error("runtime asset state file path is required");
  }

  const sourceWorkspaceDir = path.resolve(rawSourceWorkspaceDir);
  const targetWorkspaceDir = path.resolve(rawTargetWorkspaceDir);
  const stateFilePath = path.resolve(rawStateFilePath);

  if (!sourceWorkspaceDir || !fs.existsSync(sourceWorkspaceDir)) {
    throw new Error(`runtime asset source directory missing: ${sourceWorkspaceDir}`);
  }

  const interactive = Boolean(input?.interactive);
  const logger = typeof input?.logger === "function" ? input.logger : null;
  const onConflict = typeof input?.onConflict === "function" ? input.onConflict : null;

  ensureDir(targetWorkspaceDir);
  const previousState = safeReadState(stateFilePath);
  const relativeFiles = listRelativeFiles(sourceWorkspaceDir);
  const relativeFilesSet = new Set(relativeFiles);
  const nowIso = new Date().toISOString();

  const summary = {
    mode,
    source: sourceWorkspaceDir,
    target: targetWorkspaceDir,
    stateFile: stateFilePath,
    scannedFiles: relativeFiles.length,
    copied: 0,
    overwritten: 0,
    unchanged: 0,
    keptLocal: 0,
    conflicts: 0,
    backupsCreated: 0,
    removed: 0,
    conflictResolutions: [],
    backups: [],
  };

  const nextState = {
    version: STATE_VERSION,
    updatedAt: nowIso,
    files: {},
  };

  for (const relativePath of relativeFiles) {
    const sourceFilePath = path.join(sourceWorkspaceDir, relativePath);
    const targetFilePath = path.join(targetWorkspaceDir, relativePath);
    const sourceHash = hashFile(sourceFilePath);
    const previous = previousState.files?.[relativePath] ?? null;

    const targetExists = fs.existsSync(targetFilePath);
    const targetHash = targetExists ? hashFile(targetFilePath) : null;
    const previousSourceHash = typeof previous?.sourceHash === "string" ? previous.sourceHash : null;
    const previousAppliedHash = typeof previous?.appliedHash === "string" ? previous.appliedHash : null;

    const packageChanged = previousSourceHash === null || previousSourceHash !== sourceHash;
    const localChanged = previousAppliedHash === null ? mode === "update" : targetHash !== previousAppliedHash;

    let appliedHash = targetHash;

    if (!targetExists) {
      ensureDir(path.dirname(targetFilePath));
      fs.copyFileSync(sourceFilePath, targetFilePath);
      summary.copied += 1;
      appliedHash = hashFile(targetFilePath);
      if (logger) logger(`runtime-assets: copied ${relativePath}`);
    } else if (mode === "install") {
      fs.copyFileSync(sourceFilePath, targetFilePath);
      summary.overwritten += 1;
      appliedHash = hashFile(targetFilePath);
      if (logger) logger(`runtime-assets: overwritten ${relativePath}`);
    } else if (!packageChanged) {
      summary.unchanged += 1;
      if (logger) logger(`runtime-assets: unchanged ${relativePath}`);
    } else if (!localChanged) {
      fs.copyFileSync(sourceFilePath, targetFilePath);
      summary.overwritten += 1;
      appliedHash = hashFile(targetFilePath);
      if (logger) logger(`runtime-assets: updated ${relativePath}`);
    } else {
      summary.conflicts += 1;
      const conflictInput = {
        relativePath,
        targetFilePath,
        sourceFilePath,
      };

      const decision =
        interactive && onConflict ? readDecision(await onConflict(conflictInput)) : "use-packaged";

      if (decision === "keep-local") {
        summary.keptLocal += 1;
        summary.conflictResolutions.push({ path: relativePath, decision: "keep-local" });
        if (logger) logger(`runtime-assets: kept local ${relativePath}`);
      } else {
        if (!interactive) {
          const backupPath = makeBackupPath(targetFilePath);
          fs.copyFileSync(targetFilePath, backupPath);
          summary.backupsCreated += 1;
          summary.backups.push({ path: relativePath, backupPath });
          if (logger) logger(`runtime-assets: backup ${relativePath} -> ${backupPath}`);
        }
        fs.copyFileSync(sourceFilePath, targetFilePath);
        summary.overwritten += 1;
        appliedHash = hashFile(targetFilePath);
        summary.conflictResolutions.push({ path: relativePath, decision: "use-packaged" });
        if (logger) logger(`runtime-assets: replaced ${relativePath}`);
      }
    }

    nextState.files[relativePath] = {
      sourceHash,
      appliedHash,
      updatedAt: nowIso,
    };
  }

  const removedPaths = Object.keys(previousState.files ?? {})
    .filter(relativePath => !relativeFilesSet.has(relativePath))
    .sort((left, right) => left.localeCompare(right));

  for (const relativePath of removedPaths) {
    const previous = previousState.files?.[relativePath] ?? null;
    const targetFilePath = path.join(targetWorkspaceDir, relativePath);
    if (!fs.existsSync(targetFilePath)) {
      if (logger) logger(`runtime-assets: already absent ${relativePath}`);
      continue;
    }

    const targetHash = hashFile(targetFilePath);
    const previousAppliedHash = typeof previous?.appliedHash === "string" ? previous.appliedHash : null;
    const localChanged = previousAppliedHash === null ? true : targetHash !== previousAppliedHash;

    if (!localChanged || mode === "install") {
      fs.rmSync(targetFilePath, { force: true });
      summary.removed += 1;
      if (logger) logger(`runtime-assets: removed ${relativePath}`);
      continue;
    }

    const conflictInput = {
      relativePath,
      targetFilePath,
      sourceFilePath: null,
      removed: true,
    };

    const decision =
      interactive && onConflict ? readDecision(await onConflict(conflictInput)) : "use-packaged";

    if (decision === "keep-local") {
      summary.keptLocal += 1;
      summary.conflictResolutions.push({ path: relativePath, decision: "keep-local" });
      if (logger) logger(`runtime-assets: kept removed local file ${relativePath}`);
      nextState.files[relativePath] = {
        sourceHash: null,
        appliedHash: targetHash,
        updatedAt: nowIso,
      };
      continue;
    }

    if (!interactive) {
      const backupPath = makeBackupPath(targetFilePath);
      fs.copyFileSync(targetFilePath, backupPath);
      summary.backupsCreated += 1;
      summary.backups.push({ path: relativePath, backupPath });
      if (logger) logger(`runtime-assets: backup ${relativePath} -> ${backupPath}`);
    }

    fs.rmSync(targetFilePath, { force: true });
    summary.removed += 1;
    summary.conflictResolutions.push({ path: relativePath, decision: "use-packaged" });
    if (logger) logger(`runtime-assets: removed stale ${relativePath}`);
  }

  writeState(stateFilePath, nextState);
  return summary;
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ReleaseCheckerConfig = {
  packages?: string[];
  githubRepos?: string[];
  stateKey?: string;
};

type VersionState = {
  lastChecked: string;
  versions: Record<string, string>;
};

type ReleaseVersion = {
  source: "npm" | "github";
  name: string;
  version: string;
};

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const stateDir = path.join(moduleDir, ".state");

function resolveStateFilePath(stateKey: string) {
  const normalizedStateKey = stateKey.trim() || "default";
  if (!/^[A-Za-z0-9_-]+$/.test(normalizedStateKey)) {
    throw new Error('Invalid stateKey: only letters, numbers, "_" and "-" are allowed');
  }
  return {
    stateKey: normalizedStateKey,
    filePath: path.join(stateDir, `${normalizedStateKey}.json`),
  };
}

async function loadState(stateKey: string): Promise<VersionState> {
  const { filePath } = resolveStateFilePath(stateKey);
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<VersionState>;
    return {
      lastChecked:
        typeof parsed.lastChecked === "string" && parsed.lastChecked
          ? parsed.lastChecked
          : new Date(0).toISOString(),
      versions:
        parsed.versions && typeof parsed.versions === "object" && !Array.isArray(parsed.versions)
          ? Object.fromEntries(
              Object.entries(parsed.versions).filter(
                (entry): entry is [string, string] => typeof entry[1] === "string",
              ),
            )
          : {},
    };
  } catch {
    return {
      lastChecked: new Date(0).toISOString(),
      versions: {},
    };
  }
}

async function saveState(stateKey: string, state: VersionState) {
  const { filePath } = resolveStateFilePath(stateKey);
  await mkdir(stateDir, { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2));
}

async function getNpmVersion(pkg: string): Promise<string | null> {
  try {
    const response = await fetch(`https://registry.npmjs.org/${pkg}/latest`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data.version === "string" && data.version ? data.version : null;
  } catch {
    return null;
  }
}

async function getGitHubVersion(repo: string): Promise<string | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "AgentMockingbird-ReleaseChecker",
      },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data.tag_name === "string" && data.tag_name ? data.tag_name : null;
  } catch {
    return null;
  }
}

export default async function checkWithState(ctx: {
  payload: ReleaseCheckerConfig;
}) {
  const packages = Array.isArray(ctx.payload.packages) ? ctx.payload.packages : [];
  const githubRepos = Array.isArray(ctx.payload.githubRepos) ? ctx.payload.githubRepos : [];
  const stateKey = typeof ctx.payload.stateKey === "string" ? ctx.payload.stateKey : "default";
  const { stateKey: resolvedStateKey } = resolveStateFilePath(stateKey);

  const previousState = await loadState(resolvedStateKey);
  const nextVersions = { ...previousState.versions };
  const newVersions: ReleaseVersion[] = [];

  for (const pkg of packages) {
    const version = await getNpmVersion(pkg);
    if (!version) continue;
    if (previousState.versions[`npm:${pkg}`] !== version) {
      newVersions.push({ source: "npm", name: pkg, version });
    }
    nextVersions[`npm:${pkg}`] = version;
  }

  for (const repo of githubRepos) {
    const version = await getGitHubVersion(repo);
    if (!version) continue;
    if (previousState.versions[`github:${repo}`] !== version) {
      newVersions.push({ source: "github", name: repo, version });
    }
    nextVersions[`github:${repo}`] = version;
  }

  await saveState(resolvedStateKey, {
    lastChecked: new Date().toISOString(),
    versions: nextVersions,
  });

  if (newVersions.length === 0) {
    return {
      status: "ok" as const,
      summary: `Release check completed with no changes since ${previousState.lastChecked}.`,
      data: { stateKey: resolvedStateKey, versions: nextVersions },
      invokeAgent: { shouldInvoke: false },
    };
  }

  const prompt = [
    "New releases detected since the last successful check:",
    "",
    ...newVersions.map((release) => `- ${release.source} ${release.name} -> ${release.version}`),
    "",
    "Review changelogs and decide whether follow-up work is needed.",
  ].join("\n");

  return {
    status: "ok" as const,
    summary: `Detected ${newVersions.length} new release${newVersions.length === 1 ? "" : "s"}.`,
    data: { stateKey: resolvedStateKey, newVersions, versions: nextVersions },
    invokeAgent: {
      shouldInvoke: true,
      prompt,
      context: { stateKey: resolvedStateKey, newVersions, versions: nextVersions },
    },
  };
}

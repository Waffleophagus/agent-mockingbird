type ReleaseCheckConfig = {
  packages?: string[];
  githubRepos?: string[];
  notifyOnNoReleases?: boolean;
};

type ReleaseInfo = {
  source: "npm" | "github";
  name: string;
  version: string;
  published: string;
  url?: string;
};

async function checkNpmReleases(packages: string[]): Promise<ReleaseInfo[]> {
  const releases = await Promise.all(
    packages.map(async (pkg) => {
      try {
        const response = await fetch(`https://registry.npmjs.org/${pkg}/latest`, {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) return null;
        const data = await response.json();
        if (typeof data.version !== "string" || !data.version) return null;
        return {
          source: "npm" as const,
          name: pkg,
          version: data.version,
          published:
            typeof data.time?.modified === "string" && data.time.modified
              ? data.time.modified
              : new Date().toISOString(),
        };
      } catch {
        return null;
      }
    }),
  );
  return releases.filter((release): release is ReleaseInfo => release !== null);
}

async function checkGitHubReleases(repos: string[]): Promise<ReleaseInfo[]> {
  const releases = await Promise.all(
    repos.map(async (repo) => {
      try {
        const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "AgentMockingbird-ReleaseChecker",
          },
        });
        if (!response.ok) return null;
        const data = await response.json();
        if (typeof data.tag_name !== "string" || !data.tag_name) return null;
        return {
          source: "github" as const,
          name: repo,
          version: data.tag_name,
          published:
            typeof data.published_at === "string" && data.published_at
              ? data.published_at
              : new Date().toISOString(),
          url: typeof data.html_url === "string" ? data.html_url : undefined,
        };
      } catch {
        return null;
      }
    }),
  );
  return releases.filter((release): release is ReleaseInfo => release !== null);
}

export default async function executorReleaseCheck(ctx: {
  payload: ReleaseCheckConfig;
}) {
  const packages = Array.isArray(ctx.payload.packages) ? ctx.payload.packages : [];
  const githubRepos = Array.isArray(ctx.payload.githubRepos) ? ctx.payload.githubRepos : [];
  const notifyOnNoReleases = ctx.payload.notifyOnNoReleases === true;

  const [npmReleases, githubReleases] = await Promise.all([
    checkNpmReleases(packages),
    checkGitHubReleases(githubRepos),
  ]);
  const releases = [...npmReleases, ...githubReleases];

  if (releases.length === 0) {
    return {
      status: "ok" as const,
      summary: "Release check completed with no releases found.",
      data: { releases },
      invokeAgent: { shouldInvoke: notifyOnNoReleases, prompt: "No new releases found." },
    };
  }

  const prompt = [
    "New releases detected:",
    "",
    ...releases.map(
      (release) =>
        `- ${release.source} ${release.name} -> ${release.version} (${release.published})${release.url ? ` ${release.url}` : ""}`,
    ),
    "",
    "Review and decide whether any upgrades should be scheduled.",
  ].join("\n");

  return {
    status: "ok" as const,
    summary: `Detected ${releases.length} release${releases.length === 1 ? "" : "s"}.`,
    data: { releases },
    invokeAgent: {
      shouldInvoke: true,
      prompt,
      context: { releases },
    },
  };
}

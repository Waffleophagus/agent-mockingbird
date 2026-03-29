type GitHubReleaseConfig = {
  repos?: string[];
  includeDrafts?: boolean;
  includePrereleases?: boolean;
};

type GitHubRelease = {
  source: "github";
  repo: string;
  tagName: string;
  name: string;
  publishedAt: string;
  url: string;
  isPrerelease: boolean;
  isDraft: boolean;
};

async function getLatestRelease(
  repo: string,
  includeDrafts: boolean,
  includePrereleases: boolean,
): Promise<GitHubRelease | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "AgentMockingbird-GitHubReleaseChecker",
      },
    });
    if (!response.ok) return null;

    const payload = await response.json();
    if (!Array.isArray(payload)) return null;
    const data = payload.find((entry) => {
      if (!entry || typeof entry !== "object") return false;
      if (!includeDrafts && entry.draft === true) return false;
      if (!includePrereleases && entry.prerelease === true) return false;
      return typeof entry.tag_name === "string" && entry.tag_name.length > 0;
    });
    if (!data || typeof data !== "object") return null;
    if (typeof data.tag_name !== "string" || !data.tag_name) return null;

    return {
      source: "github",
      repo,
      tagName: data.tag_name,
      name: typeof data.name === "string" && data.name ? data.name : data.tag_name,
      publishedAt:
        typeof data.published_at === "string" && data.published_at
          ? data.published_at
          : new Date().toISOString(),
      url: typeof data.html_url === "string" ? data.html_url : `https://github.com/${repo}/releases`,
      isPrerelease: data.prerelease === true,
      isDraft: data.draft === true,
    };
  } catch {
    return null;
  }
}

export default async function checkGitHubReleases(ctx: {
  payload: GitHubReleaseConfig;
}) {
  const repos = Array.isArray(ctx.payload.repos) ? ctx.payload.repos : [];
  const includeDrafts = ctx.payload.includeDrafts === true;
  const includePrereleases = ctx.payload.includePrereleases === true;
  const releases = (
    await Promise.all(
      repos.map((repo) => getLatestRelease(repo, includeDrafts, includePrereleases)),
    )
  ).filter((release): release is GitHubRelease => release !== null);

  if (releases.length === 0) {
    return {
      status: "ok" as const,
      summary: "No GitHub releases found.",
      invokeAgent: { shouldInvoke: false },
    };
  }

  const prompt = [
    "New GitHub releases detected:",
    "",
    ...releases.map(
      (release) =>
        `- ${release.repo}@${release.tagName}${release.isPrerelease ? " (prerelease)" : ""} - ${release.url}`,
    ),
    "",
    "Review the release notes and assess upgrade impact.",
  ].join("\n");

  return {
    status: "ok" as const,
    summary: `Detected ${releases.length} GitHub release${releases.length === 1 ? "" : "s"}.`,
    data: { releases },
    invokeAgent: {
      shouldInvoke: true,
      prompt,
      context: { releases },
    },
  };
}

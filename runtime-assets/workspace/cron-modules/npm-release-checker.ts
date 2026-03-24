type ReleaseCheckConfig = {
  packages?: string[];
};

type ReleaseInfo = {
  source: "npm";
  name: string;
  version: string;
  publishedAt: string;
  changelogUrl?: string;
};

async function getPackageInfo(pkg: string): Promise<ReleaseInfo | null> {
  try {
    const response = await fetch(`https://registry.npmjs.org/${pkg}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;

    const data = await response.json();
    const latest = data["dist-tags"]?.latest;
    const publishedAt = data.time?.[latest];
    if (typeof latest !== "string" || !latest) return null;

    return {
      source: "npm",
      name: pkg,
      version: latest,
      publishedAt:
        typeof publishedAt === "string" && publishedAt
          ? publishedAt
          : new Date().toISOString(),
      changelogUrl:
        typeof data.homepage === "string" && data.homepage
          ? data.homepage
          : undefined,
    };
  } catch {
    return null;
  }
}

export default async function checkReleases(ctx: {
  payload: ReleaseCheckConfig;
}) {
  const packages = Array.isArray(ctx.payload.packages) ? ctx.payload.packages : [];
  const releases = (await Promise.all(packages.map((pkg) => getPackageInfo(pkg)))).filter(
    (release): release is ReleaseInfo => release !== null,
  );

  if (releases.length === 0) {
    return {
      status: "ok" as const,
      summary: "No npm releases found.",
      invokeAgent: { shouldInvoke: false },
    };
  }

  const prompt = [
    "New npm package releases detected:",
    "",
    ...releases.map(
      (release) =>
        `- ${release.name}@${release.version} (published: ${release.publishedAt})`,
    ),
    "",
    "Review these releases and decide whether any upgrades are worth pulling in.",
  ].join("\n");

  return {
    status: "ok" as const,
    summary: `Detected ${releases.length} npm release${releases.length === 1 ? "" : "s"}.`,
    data: { releases },
    invokeAgent: {
      shouldInvoke: true,
      prompt,
      context: { releases },
    },
  };
}

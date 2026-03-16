import path from "node:path";

export const STANDALONE_ENTRYPOINTS_RELATIVE = ["apps/server/src/index.ts"] as const;

export function resolveStandaloneEntrypoints(repoRoot: string): string[] {
  return STANDALONE_ENTRYPOINTS_RELATIVE.map(entrypoint => path.join(repoRoot, entrypoint));
}

export function createStandaloneBuildOptions(repoRoot: string, outfile: string): Bun.BuildConfig {
  return {
    root: repoRoot,
    entrypoints: resolveStandaloneEntrypoints(repoRoot),
    compile: {
      outfile,
    },
    minify: true,
    sourcemap: "linked",
  };
}

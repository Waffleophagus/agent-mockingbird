import { expect, test } from "bun:test";
import path from "node:path";

import { createStandaloneBuildOptions, STANDALONE_ENTRYPOINTS_RELATIVE } from "./standaloneBuild";

test("standalone build config uses the main server entrypoint", () => {
  const repoRoot = path.resolve(import.meta.dir, "../../../..");
  const outfile = path.join(repoRoot, "dist", "agent-mockingbird");

  const options = createStandaloneBuildOptions(repoRoot, outfile);
  expect(options.compile).toEqual({ outfile });
  expect(options.sourcemap).toBe("linked");
  expect(options.minify).toBe(true);

  const entrypoints = options.entrypoints as string[];
  for (const relativeEntrypoint of STANDALONE_ENTRYPOINTS_RELATIVE) {
    expect(entrypoints).toContain(path.join(repoRoot, relativeEntrypoint));
  }
});

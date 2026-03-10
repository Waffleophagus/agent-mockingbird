import { describe, expect, test } from "bun:test";

import {
  buildStreamdownCodeLineHighlights,
  buildStreamdownRenderSnapshot,
} from "./streamdownSnapshots";

describe("streamdownSnapshots", () => {
  test("emits colored live highlights for completed lines in incomplete fenced blocks", async () => {
    const highlights = await buildStreamdownCodeLineHighlights(
      "```ts\nconst answer: number = 42;\nconst next = answer + 1;"
    );

    expect(highlights).toHaveLength(1);
    expect(highlights[0]?.lineText).toBe("const answer: number = 42;");
    expect(
      highlights[0]?.tokens.some(
        (token) => typeof token.color === "string" && token.color.length > 0
      )
    ).toBe(true);
  });

  test("preserves token colors in final render snapshots", async () => {
    const snapshot = await buildStreamdownRenderSnapshot(
      "```ts\nconst answer: number = 42;\n```"
    );

    expect(snapshot?.codeBlocks).toHaveLength(1);
    expect(
      snapshot?.codeBlocks[0]?.tokens[0]?.some(
        (token) => typeof token.color === "string" && token.color.length > 0
      )
    ).toBe(true);
  });
});

import { describe, expect, test } from "bun:test";

import { blendRrfAndRerank, hasStrongBm25Signal, reciprocalRankFusion } from "./qmdPort";

describe("hasStrongBm25Signal", () => {
  test("returns true when score and gap thresholds are met", () => {
    const ranked = [
      { id: "a", score: 0.91 },
      { id: "b", score: 0.72 },
    ];
    expect(hasStrongBm25Signal(ranked, { minScore: 0.85, minGap: 0.15 })).toBe(true);
  });

  test("returns false when top gap is too small", () => {
    const ranked = [
      { id: "a", score: 0.91 },
      { id: "b", score: 0.8 },
    ];
    expect(hasStrongBm25Signal(ranked, { minScore: 0.85, minGap: 0.15 })).toBe(false);
  });
});

describe("reciprocalRankFusion", () => {
  test("boosts items that rank well across multiple lists", () => {
    const results = reciprocalRankFusion(
      [
        [
          { id: "x", score: 1 },
          { id: "y", score: 0.9 },
        ],
        [
          { id: "y", score: 1 },
          { id: "x", score: 0.8 },
        ],
      ],
      [1, 1],
      60,
    );

    expect(results.length).toBe(2);
    expect(results[0]?.id).toBe("x");
    expect(results[1]?.id).toBe("y");
  });
});

describe("blendRrfAndRerank", () => {
  test("protects top-ranked items with stronger rrf weight", () => {
    const top = blendRrfAndRerank(1, 0.1);
    const mid = blendRrfAndRerank(8, 0.1);
    const tail = blendRrfAndRerank(20, 0.1);
    expect(top).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(tail);
  });
});

import { describe, expect, test } from "bun:test";

import { buildConceptExpandedQueries } from "./conceptExpansion";

describe("buildConceptExpandedQueries", () => {
  test("expands portfolio query to adjacent asset classes", () => {
    const expanded = buildConceptExpandedQueries("How is my portfolio doing?", {
      enabled: true,
      maxPacks: 3,
      maxTerms: 12,
    });
    expect(expanded.matchedConceptPacks).toContain("portfolio");
    expect(expanded.expandedTokens).toContain("silver");
    expect(expanded.expandedQueries.some(item => item.type === "lex")).toBe(true);
    expect(expanded.expandedQueries.some(item => item.type === "vec")).toBe(true);
  });

  test("respects disable flag", () => {
    const expanded = buildConceptExpandedQueries("portfolio", {
      enabled: false,
      maxPacks: 3,
      maxTerms: 12,
    });
    expect(expanded.matchedConceptPacks).toHaveLength(0);
    expect(expanded.expandedTokens).toHaveLength(0);
    expect(expanded.expandedQueries).toHaveLength(0);
  });
});

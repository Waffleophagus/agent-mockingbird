describe("@streamdown/react-native", () => {
  it("exports core parsing helpers", async () => {
    const mod = await import("../index");
    expect(typeof mod.parseMarkdownIntoBlocks).toBe("function");
    expect(typeof mod.remend).toBe("function");
  });

  it("parses markdown into blocks", async () => {
    const { parseMarkdownIntoBlocks } = await import("../index");
    const blocks = parseMarkdownIntoBlocks("# Title\n\nParagraph\n\n- Item");
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks.length).toBeGreaterThan(0);
  });

  it("applies remend for incomplete markdown", async () => {
    const { remend } = await import("../index");
    const output = remend("This is **bold");
    expect(output).toContain("**");
  });

  it("splits text by word and char for animation tokenization", async () => {
    const { __testUtils } = await import("../lib/markdown-native");
    expect(__testUtils.splitByWord("alpha beta")).toEqual(["alpha", " ", "beta"]);
    expect(__testUtils.splitByChar("ab  c")).toEqual(["a", "b", "  ", "c"]);
  });

  it("counts only non-whitespace animation tokens", async () => {
    const { __testUtils } = await import("../lib/markdown-native");
    expect(__testUtils.countAnimatableTokens(["alpha", " ", "beta", "\n"])).toBe(
      2
    );
  });

  it("applies allow/disallow element filtering rules", async () => {
    const { __filterTestUtils } = await import("../lib/markdown-native");
    const node = { tagName: "script" } as any;

    expect(
      __filterTestUtils.shouldRemoveElement(
        node,
        0,
        undefined,
        undefined,
        ["script"],
        undefined
      )
    ).toBe(true);

    expect(
      __filterTestUtils.shouldRemoveElement(
        node,
        0,
        undefined,
        ["p", "a"],
        undefined,
        undefined
      )
    ).toBe(true);

    expect(
      __filterTestUtils.shouldRemoveElement(
        node,
        0,
        undefined,
        undefined,
        undefined,
        () => false
      )
    ).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { parseMarkdownIntoBlocks, remend } from "../src";

describe("@streamdown/core", () => {
  it("parses markdown into multiple blocks for normal markdown", () => {
    const markdown = "# Title\n\nParagraph one.\n\nParagraph two.";
    const blocks = parseMarkdownIntoBlocks(markdown);
    expect(blocks.length).toBeGreaterThan(1);
  });

  it("keeps footnote markdown as a single block", () => {
    const markdown = "Item[^1]\n\n[^1]: Footnote definition";
    const blocks = parseMarkdownIntoBlocks(markdown);
    expect(blocks).toHaveLength(1);
  });

  it("merges blocks while math fence is incomplete", () => {
    const markdown = "$$\nE = mc^2\n\nparagraph";
    const blocks = parseMarkdownIntoBlocks(markdown);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain("paragraph");
  });

  it("repairs incomplete markdown with remend", () => {
    expect(remend("hello **world")).toContain("**");
  });
});

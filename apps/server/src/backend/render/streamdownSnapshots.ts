import type { StreamdownCodeLineHighlight } from "@agent-mockingbird/contracts/dashboard";
import { createServerCodeHighlighter } from "@streamdown/code";
import {
  extractStreamdownCodeBlocks,
  hashStreamdownCodeBlock,
  type StreamdownCodeBlockSnapshot,
  type StreamdownRenderSnapshot,
} from "@streamdown/core";

const STREAMDOWN_SERVER_THEME_ID = "app-dark";
const openingFenceRegex =
  /^(?<fence>`{3,}|~{3,})(?<language>[^\n`]*)\n(?<rest>[\s\S]*)$/;

const highlighter = createServerCodeHighlighter({
  themes: ["github-dark", "github-dark"],
});

function normalizeMarkdownContent(content: string): string {
  const normalizedLineEndings = content.replace(/\r\n?/g, "\n");
  const hasRealNewlines = normalizedLineEndings.includes("\n");
  const escapedNewlineCount = normalizedLineEndings.match(/\\n/g)?.length ?? 0;
  const hasEscapedFence = normalizedLineEndings.includes("\\`\\`\\`");
  if (!hasRealNewlines && escapedNewlineCount < 2 && !hasEscapedFence) {
    return normalizedLineEndings;
  }
  return normalizedLineEndings
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\`/g, "`");
}

const mapCodeToken = (token: {
  bgColor?: string;
  color?: string;
  content: string;
  htmlStyle?: Record<string, string>;
}) => ({
  bgColor: token.bgColor,
  color:
    token.color ??
    token.htmlStyle?.color ??
    token.htmlStyle?.["--shiki-dark"] ??
    token.htmlStyle?.["--shiki-light"],
  content: token.content,
});

const mapCodeTokenRows = (
  rows: Array<
    Array<{
      bgColor?: string;
      color?: string;
      content: string;
    }>
  >,
) => rows.map((row) => row.map(mapCodeToken));

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractLiveCodeLines(blocks: string[]): StreamdownCodeLineHighlight[] {
  return blocks.flatMap((block, blockIndex) => {
    const opening = block.match(openingFenceRegex);
    if (!opening?.groups) {
      return [];
    }

    const fence = opening.groups.fence ?? "";
    const language = (opening.groups.language ?? "").trim().toLowerCase();
    const rest = opening.groups.rest ?? "";
    if (!fence) {
      return [];
    }
    const closingFenceRegex = new RegExp(`\\n${escapeRegex(fence)}\\s*$`);
    const isClosed = closingFenceRegex.test(rest);
    const code = isClosed ? rest.replace(closingFenceRegex, "") : rest;
    const lines = code.split("\n");
    const completedLines = isClosed ? lines : lines.slice(0, -1);
    const codeHash = hashStreamdownCodeBlock(language, code);

    return completedLines.map((lineText, lineIndex) => ({
      blockIndex,
      codeHash,
      isClosed,
      lineIndex,
      language,
      lineText,
      tokens: [],
    }));
  });
}

export async function buildStreamdownCodeLineHighlights(
  markdown: string,
): Promise<StreamdownCodeLineHighlight[]> {
  const normalizedMarkdown = normalizeMarkdownContent(markdown);
  const extracted = extractStreamdownCodeBlocks({
    markdown: normalizedMarkdown,
    parseIncompleteMarkdown: true,
  });
  const liveCodeLines = extractLiveCodeLines(extracted.blocks);

  if (liveCodeLines.length === 0) {
    return [];
  }

  return (
    await Promise.all(
      liveCodeLines.map(
        async (line): Promise<StreamdownCodeLineHighlight | null> => {
          try {
            const result = await highlighter.highlightCode({
              code: line.lineText,
              language: line.language,
            });
            return {
              ...line,
              tokens: result.tokens[0]?.map(mapCodeToken) ?? [],
            };
          } catch (error) {
            console.warn(
              `[server] Streamdown line highlight failed for language "${line.language}":`,
              error,
            );
            return null;
          }
        },
      ),
    )
  ).filter((line): line is StreamdownCodeLineHighlight => Boolean(line));
}

export async function buildStreamdownRenderSnapshot(
  markdown: string,
): Promise<StreamdownRenderSnapshot | undefined> {
  const normalizedMarkdown = normalizeMarkdownContent(markdown);
  const extracted = extractStreamdownCodeBlocks({
    markdown: normalizedMarkdown,
    parseIncompleteMarkdown: true,
  });

  if (extracted.extractedCodeBlocks.length === 0) {
    return undefined;
  }

  const codeBlocks = (
    await Promise.all(
      extracted.extractedCodeBlocks.map(
        async (block): Promise<StreamdownCodeBlockSnapshot | null> => {
          try {
            const result = await highlighter.highlightCode({
              code: block.code,
              language: block.language,
            });
            return {
              blockIndex: block.blockIndex,
              codeHash: block.codeHash,
              language: block.language,
              tokens: mapCodeTokenRows(result.tokens),
            };
          } catch (error) {
            console.warn(
              `[server] Streamdown snapshot highlight failed for language "${block.language}":`,
              error,
            );
            return null;
          }
        },
      ),
    )
  ).filter(
    (
      block: StreamdownCodeBlockSnapshot | null,
    ): block is StreamdownCodeBlockSnapshot => Boolean(block),
  );

  if (codeBlocks.length === 0) {
    return undefined;
  }

  return {
    codeBlocks,
    contentHash: extracted.contentHash,
    themeId: STREAMDOWN_SERVER_THEME_ID,
    version: 1,
  };
}

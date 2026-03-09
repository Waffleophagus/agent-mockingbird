import {
  extractStreamdownCodeBlocks,
  type StreamdownCodeBlockSnapshot,
  type StreamdownRenderSnapshot,
} from "@streamdown/core";
import { createServerCodeHighlighter } from "@streamdown/code";

const STREAMDOWN_SERVER_THEME_ID = "app-dark";
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

export async function buildStreamdownRenderSnapshot(markdown: string): Promise<StreamdownRenderSnapshot | undefined> {
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
      extracted.extractedCodeBlocks.map(async (block): Promise<StreamdownCodeBlockSnapshot | null> => {
        try {
          const result = await highlighter.highlightCode({
            code: block.code,
            language: block.language,
          });
          return {
            blockIndex: block.blockIndex,
            codeHash: block.codeHash,
            language: block.language,
            tokens: result.tokens.map((row: Array<{ bgColor?: string; color?: string; content: string }>) =>
              row.map((token: { bgColor?: string; color?: string; content: string }) => ({
                bgColor: token.bgColor,
                color: token.color,
                content: token.content,
              })),
            ),
          };
        } catch (error) {
          console.warn(
            `[server] Streamdown snapshot highlight failed for language "${block.language}":`,
            error,
          );
          return null;
        }
      }),
    )
  ).filter((block: StreamdownCodeBlockSnapshot | null): block is StreamdownCodeBlockSnapshot => Boolean(block));

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

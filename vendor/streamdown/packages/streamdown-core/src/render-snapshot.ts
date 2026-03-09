import type { RemendOptions } from "remend";
import remend from "remend";
import { parseMarkdownIntoBlocks } from "./parse-blocks";

export interface StreamdownCodeTokenSnapshot {
  bgColor?: string;
  color?: string;
  content: string;
}

export interface StreamdownCodeBlockSnapshot {
  blockIndex: number;
  codeHash: string;
  language: string;
  tokens: StreamdownCodeTokenSnapshot[][];
}

export interface StreamdownRenderSnapshot {
  codeBlocks: StreamdownCodeBlockSnapshot[];
  contentHash: string;
  themeId: string;
  version: 1;
}

export interface ExtractStreamdownCodeBlocksOptions {
  markdown: string;
  parseIncompleteMarkdown?: boolean;
  parseMarkdownIntoBlocksFn?: (markdown: string) => string[];
  remendOptions?: RemendOptions;
}

export interface ExtractedStreamdownCodeBlock {
  blockIndex: number;
  code: string;
  codeHash: string;
  language: string;
}

export interface ExtractedStreamdownCodeBlocks {
  blocks: string[];
  contentHash: string;
  extractedCodeBlocks: ExtractedStreamdownCodeBlock[];
  normalizedMarkdown: string;
}

const fencedCodeBlockRegex =
  /^(?<fence>`{3,}|~{3,})(?<language>[^\n`]*)\n(?<code>[\s\S]*?)\n\k<fence>\s*$/;

export const hashStreamdownContent = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
};

export const hashStreamdownCodeBlock = (
  language: string,
  code: string,
): string => hashStreamdownContent(`${language}\u0000${code}`);

export const extractStreamdownCodeBlockMetadata = (
  block: string,
): ExtractedStreamdownCodeBlock | null => {
  const matched = block.match(fencedCodeBlockRegex);
  if (!matched?.groups) {
    return null;
  }

  const language = matched.groups.language.trim().toLowerCase();
  const code = matched.groups.code ?? "";

  return {
    blockIndex: -1,
    code,
    codeHash: hashStreamdownCodeBlock(language, code),
    language,
  };
};

export const extractStreamdownCodeBlocks = (
  input: ExtractStreamdownCodeBlocksOptions,
): ExtractedStreamdownCodeBlocks => {
  const normalizedMarkdown =
    input.parseIncompleteMarkdown === false
      ? input.markdown
      : remend(input.markdown, input.remendOptions);
  const parseBlocks = input.parseMarkdownIntoBlocksFn ?? parseMarkdownIntoBlocks;
  const blocks = parseBlocks(normalizedMarkdown);
  const extractedCodeBlocks = blocks.flatMap((block, blockIndex) => {
    const metadata = extractStreamdownCodeBlockMetadata(block);
    if (!metadata) {
      return [];
    }
    return [
      {
        ...metadata,
        blockIndex,
      },
    ];
  });

  return {
    blocks,
    contentHash: hashStreamdownContent(normalizedMarkdown),
    extractedCodeBlocks,
    normalizedMarkdown,
  };
};

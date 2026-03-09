import type {
  RemendOptions,
  StreamdownCodeBlockSnapshot,
  StreamdownRenderSnapshot,
} from "@streamdown/core";
import {
  extractStreamdownCodeBlockMetadata,
  hashStreamdownContent,
  parseMarkdownIntoBlocks,
  remend,
} from "@streamdown/core";
import type { ReactNode } from "react";
import { memo, useEffect, useMemo, useState, useTransition } from "react";
import { Linking, View } from "react-native";
import {
  type AllowElement,
  type AnimateOptions,
  type CodeHighlighterPlugin,
  MarkdownNative,
  type MarkdownNativeTheme,
  type UrlTransform,
} from "./lib/markdown-native";

export { parseMarkdownIntoBlocks, remend };
export type { CodeHighlighterPlugin } from "./lib/markdown-native";
export type {
  StreamdownCodeBlockSnapshot,
  StreamdownRenderSnapshot,
} from "@streamdown/core";

export type StreamdownNativeMode = "streaming" | "static";
export type StreamdownStaticCodeStrategy = "freeze" | "plain" | "highlight";

export type StreamdownFrozenCodeBlockSnapshot = StreamdownCodeBlockSnapshot;
export type StreamdownFrozenSnapshot = StreamdownRenderSnapshot;
export type StreamdownTheme = MarkdownNativeTheme;

export interface StreamdownNativeProps {
  animated?: boolean | AnimateOptions;
  allowElement?: AllowElement;
  allowedElements?: readonly string[];
  children?: string;
  disallowedElements?: readonly string[];
  frozenSnapshot?: StreamdownRenderSnapshot;
  isAnimating?: boolean;
  mode?: StreamdownNativeMode;
  parseIncompleteMarkdown?: boolean;
  parseMarkdownIntoBlocksFn?: (markdown: string) => string[];
  plugins?: {
    code?: CodeHighlighterPlugin;
  };
  remend?: RemendOptions;
  renderSnapshot?: StreamdownRenderSnapshot;
  staticCodeStrategy?: StreamdownStaticCodeStrategy;
  theme?: StreamdownTheme;
  onLinkPress?: (href: string) => void;
  unwrapDisallowed?: boolean;
  urlTransform?: UrlTransform;
}

const normalizeSnapshot = (
  snapshot: StreamdownRenderSnapshot | undefined,
  contentHash: string
): StreamdownRenderSnapshot | undefined => {
  if (!snapshot) {
    return undefined;
  }
  if (snapshot.version !== 1 || snapshot.contentHash !== contentHash) {
    return undefined;
  }
  return snapshot;
};

const Block = memo(
  ({
    content,
    onLinkPress,
    animated,
    frozenCodeBlock,
    isAnimating,
    codePlugin,
    allowElement,
    allowedElements,
    disallowedElements,
    mode,
    staticCodeStrategy,
    theme,
    unwrapDisallowed,
    urlTransform,
  }: {
    animated?: AnimateOptions;
    allowElement?: AllowElement;
    allowedElements?: readonly string[];
    codePlugin?: CodeHighlighterPlugin;
    content: string;
    disallowedElements?: readonly string[];
    frozenCodeBlock?: StreamdownCodeBlockSnapshot;
    isAnimating?: boolean;
    mode: StreamdownNativeMode;
    onLinkPress?: (href: string) => void;
    staticCodeStrategy: StreamdownStaticCodeStrategy;
    theme?: StreamdownTheme;
    unwrapDisallowed?: boolean;
    urlTransform?: UrlTransform;
  }) => {
    return (
      <MarkdownNative
        animated={animated}
        allowElement={allowElement}
        allowedElements={allowedElements}
        codePlugin={codePlugin}
        content={content}
        disallowedElements={disallowedElements}
        frozenCodeBlock={frozenCodeBlock}
        isAnimating={isAnimating}
        mode={mode}
        onLinkPress={onLinkPress}
        staticCodeStrategy={staticCodeStrategy}
        theme={theme}
        unwrapDisallowed={unwrapDisallowed}
        urlTransform={urlTransform}
      />
    );
  }
);

Block.displayName = "StreamdownNativeBlock";

export const Streamdown = ({
  animated,
  children,
  mode = "streaming",
  frozenSnapshot,
  isAnimating = false,
  parseIncompleteMarkdown = true,
  parseMarkdownIntoBlocksFn = parseMarkdownIntoBlocks,
  plugins,
  remend: remendOptions,
  renderSnapshot,
  staticCodeStrategy = "plain",
  theme,
  onLinkPress,
  allowElement,
  allowedElements,
  disallowedElements,
  unwrapDisallowed,
  urlTransform,
}: StreamdownNativeProps): ReactNode => {
  const [_isPending, startTransition] = useTransition();

  const processedChildren = useMemo(() => {
    if (typeof children !== "string") {
      return "";
    }
    if (mode === "streaming" && parseIncompleteMarkdown) {
      return remend(children, remendOptions);
    }
    return children;
  }, [children, mode, parseIncompleteMarkdown, remendOptions]);

  const blocks = useMemo(
    () => parseMarkdownIntoBlocksFn(processedChildren),
    [parseMarkdownIntoBlocksFn, processedChildren]
  );
  const contentHash = useMemo(
    () => hashStreamdownContent(processedChildren),
    [processedChildren]
  );
  const activeSnapshot = useMemo(
    () => normalizeSnapshot(renderSnapshot ?? frozenSnapshot, contentHash),
    [contentHash, frozenSnapshot, renderSnapshot]
  );

  const [displayBlocks, setDisplayBlocks] = useState<string[]>(blocks);

  useEffect(() => {
    if (mode === "streaming" && !isAnimating) {
      startTransition(() => {
        setDisplayBlocks(blocks);
      });
      return;
    }
    setDisplayBlocks(blocks);
  }, [blocks, isAnimating, mode]);

  const blocksToRender = mode === "streaming" ? displayBlocks : blocks;
  const animatedOptions: AnimateOptions | undefined =
    animated === true ? {} : animated === false ? undefined : animated;

  const handleLinkPress = (href: string) => {
    if (onLinkPress) {
      onLinkPress(href);
      return;
    }
    void Linking.openURL(href);
  };

  const snapshotBlocksByIndex = useMemo(() => {
    const entries = new Map<number, StreamdownCodeBlockSnapshot>();
    for (const block of activeSnapshot?.codeBlocks ?? []) {
      entries.set(block.blockIndex, block);
    }
    return entries;
  }, [activeSnapshot]);

  return (
    <View>
      {blocksToRender.map((block, index) => {
        const metadata = extractStreamdownCodeBlockMetadata(block);
        const snapshotBlock = snapshotBlocksByIndex.get(index);
        const validSnapshotBlock =
          metadata &&
          snapshotBlock &&
          snapshotBlock.codeHash === metadata.codeHash &&
          snapshotBlock.language === metadata.language
            ? snapshotBlock
            : undefined;

        return (
          <Block
            animated={animatedOptions}
            allowElement={allowElement}
            allowedElements={allowedElements}
            codePlugin={plugins?.code}
            content={block}
            disallowedElements={disallowedElements}
            frozenCodeBlock={validSnapshotBlock}
            key={`block-${index}`}
            isAnimating={isAnimating}
            mode={mode}
            onLinkPress={handleLinkPress}
            staticCodeStrategy={staticCodeStrategy}
            theme={theme}
            unwrapDisallowed={unwrapDisallowed}
            urlTransform={urlTransform}
          />
        );
      })}
    </View>
  );
};

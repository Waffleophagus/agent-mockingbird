import type { Element, Parents, Root, Text } from "hast";
import type { ReactNode } from "react";
import { memo, useEffect, useMemo, useState } from "react";
import {
  Image as RNImage,
  ScrollView,
  StyleSheet,
  Text as RNText,
  View,
} from "react-native";
import Animated, { Easing, FadeIn, SlideInUp } from "react-native-reanimated";
import "react-native-url-polyfill/auto";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

interface RenderContext {
  allowElement?: AllowElement;
  allowedElements?: readonly string[];
  disallowedElements?: readonly string[];
  frozenCodeBlock?: FrozenCodeBlock;
  keyPrefix: string;
  listIndex?: number;
  animated?: AnimateOptions;
  codePlugin?: CodeHighlighterPlugin;
  isAnimating?: boolean;
  mode?: "streaming" | "static";
  onLinkPress?: (href: string) => void;
  parentTag?: string;
  staticCodeStrategy?: "freeze" | "plain" | "highlight";
  styles: ReturnType<typeof createStyles>;
  unwrapDisallowed?: boolean;
  urlTransform?: UrlTransform;
}

export interface AnimateOptions {
  animation?: "fadeIn" | "blurIn" | "slideUp" | (string & {});
  duration?: number;
  easing?: string;
  maxAnimatedTokens?: number;
  sep?: "word" | "char";
}

export interface CodeHighlightOptions {
  code: string;
  language: string;
}

export interface CodeHighlightToken {
  content: string;
  color?: string;
}

export interface CodeHighlightResult {
  tokens: CodeHighlightToken[][];
}

export interface FrozenCodeBlock {
  language: string;
  tokens: CodeHighlightToken[][];
}

export interface CodeHighlighterPlugin {
  highlight: (
    options: CodeHighlightOptions,
    callback?: (result: CodeHighlightResult) => void
  ) => CodeHighlightResult | null;
}

export interface MarkdownNativeTheme {
  blockquoteBorderColor?: string;
  codeBlockBackgroundColor?: string;
  codeBlockBorderColor?: string;
  codeTextColor?: string;
  imageBackgroundColor?: string;
  inlineCodeBackgroundColor?: string;
  inlineCodeTextColor?: string;
  linkColor?: string;
  mutedTextColor?: string;
  ruleColor?: string;
  tableBorderColor?: string;
  tableHeaderBackgroundColor?: string;
  textColor?: string;
}

export type AllowElement = (
  element: Readonly<Element>,
  index: number,
  parent: Readonly<Parents> | undefined
) => boolean | null | undefined;

export type UrlTransform = (
  url: string,
  key: string,
  node: Readonly<Element>
) => string | null | undefined;

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype);

const whitespaceOnlyRegex = /^\s+$/;
const animationSkipTags = new Set(["code", "pre", "svg", "math", "annotation"]);

const splitByWord = (text: string): string[] => {
  const parts: string[] = [];
  let current = "";
  let inWhitespace = false;

  for (const char of text) {
    const isWhitespace = /\s/.test(char);
    if (isWhitespace !== inWhitespace && current) {
      parts.push(current);
      current = "";
    }
    current += char;
    inWhitespace = isWhitespace;
  }

  if (current) {
    parts.push(current);
  }

  return parts;
};

const splitByChar = (text: string): string[] => {
  const parts: string[] = [];
  let whitespaceBuffer = "";

  for (const char of text) {
    if (/\s/.test(char)) {
      whitespaceBuffer += char;
    } else {
      if (whitespaceBuffer) {
        parts.push(whitespaceBuffer);
        whitespaceBuffer = "";
      }
      parts.push(char);
    }
  }

  if (whitespaceBuffer) {
    parts.push(whitespaceBuffer);
  }

  return parts;
};

const countAnimatableTokens = (parts: string[]) =>
  parts.reduce(
    (count, part) => (whitespaceOnlyRegex.test(part) ? count : count + 1),
    0
  );

export const __testUtils = {
  countAnimatableTokens,
  splitByChar,
  splitByWord,
};

const mapEasing = (easing: string | undefined) => {
  switch (easing) {
    case "linear":
      return Easing.linear;
    case "ease-in":
      return Easing.in(Easing.quad);
    case "ease-out":
      return Easing.out(Easing.quad);
    case "ease-in-out":
      return Easing.inOut(Easing.quad);
    default:
      return Easing.inOut(Easing.quad);
  }
};

const AnimatedToken = memo(
  ({
    text,
    options,
  }: {
    options: Required<AnimateOptions>;
    text: string;
  }) => {
    const easing = mapEasing(options.easing);
    if (options.animation === "slideUp") {
      return (
        <Animated.Text entering={SlideInUp.duration(options.duration).easing(easing)}>
          {text}
        </Animated.Text>
      );
    }

    // `blurIn` gracefully degrades to `fadeIn` in the baseline RN path.
    return (
      <Animated.Text entering={FadeIn.duration(options.duration).easing(easing)}>
        {text}
      </Animated.Text>
    );
  }
);

AnimatedToken.displayName = "AnimatedToken";

const languageRegex = /language-([^\s]+)/;

const resolveClassName = (classNameValue: unknown): string => {
  if (typeof classNameValue === "string") {
    return classNameValue;
  }
  if (Array.isArray(classNameValue)) {
    return classNameValue.filter((value) => typeof value === "string").join(" ");
  }
  return "";
};

const resolveLanguage = (node: Element): string => {
  const className = resolveClassName(node.properties?.className);
  const match = className.match(languageRegex);
  return match?.[1] ?? "";
};

const HighlightedCodeBlock = memo(
  ({
    code,
    language,
    codePlugin,
    frozenCodeBlock,
    mode,
    staticCodeStrategy,
    styles,
  }: {
    code: string;
    codePlugin?: CodeHighlighterPlugin;
    frozenCodeBlock?: FrozenCodeBlock;
    language: string;
    mode?: "streaming" | "static";
    staticCodeStrategy?: "freeze" | "plain" | "highlight";
    styles: ReturnType<typeof createStyles>;
  }) => {
    const [tokens, setTokens] = useState<CodeHighlightToken[][] | null>(null);

    useEffect(() => {
      if (frozenCodeBlock?.tokens) {
        setTokens(frozenCodeBlock.tokens);
        return;
      }
      if (mode === "static" && staticCodeStrategy !== "highlight") {
        setTokens(null);
        return;
      }
      if (!codePlugin) {
        setTokens(null);
        return;
      }
      const cached = codePlugin.highlight(
        {
          code,
          language,
        },
        (result) => {
          setTokens(result.tokens);
        }
      );
      if (cached?.tokens) {
        setTokens(cached.tokens);
      }
    }, [
      codePlugin,
      code,
      frozenCodeBlock,
      language,
      mode,
      staticCodeStrategy,
    ]);

    if (!tokens) {
      return <RNText style={styles.codeBlockText}>{code}</RNText>;
    }

    return (
      <RNText style={styles.codeBlockText}>
        {tokens.map((row, rowIndex) => (
          <RNText key={`row-${rowIndex}`}>
            {row.map((token, tokenIndex) => (
              <RNText
                key={`token-${rowIndex}-${tokenIndex}`}
                style={token.color ? { color: token.color } : undefined}
              >
                {token.content}
              </RNText>
            ))}
            {"\n"}
          </RNText>
        ))}
      </RNText>
    );
  }
);

HighlightedCodeBlock.displayName = "HighlightedCodeBlock";

const toString = (node: unknown): string => {
  if (!node || typeof node !== "object") {
    return "";
  }
  const typed = node as {
    type?: string;
    value?: string;
    children?: unknown[];
  };
  if (typed.type === "text") {
    return typed.value ?? "";
  }
  if (!typed.children?.length) {
    return "";
  }
  return typed.children.map(toString).join("");
};

const renderTextChildren = (children: ReactNode[]): ReactNode =>
  children.length === 0 ? null : children;

const renderViewChildren = (
  children: ReactNode[],
  keyPrefix: string,
  styles: ReturnType<typeof createStyles>
): ReactNode[] =>
  children.reduce<ReactNode[]>((result, child, index) => {
    if (typeof child !== "string") {
      result.push(child);
      return result;
    }
    if (whitespaceOnlyRegex.test(child)) {
      return result;
    }
    result.push(
      <RNText key={`${keyPrefix}-text-${index}`} style={styles.paragraph}>
        {child}
      </RNText>
    );
    return result;
  }, []);

const renderChildren = (
  node: Root | Element,
  context: RenderContext
): ReactNode[] => {
  const children = node.children ?? [];
  return children
    .map((child, index) =>
      renderNode(child as Element | Text, {
        ...context,
        keyPrefix: `${context.keyPrefix}-${index}`,
        listIndex: index,
        parentTag: "tagName" in node ? node.tagName : undefined,
      })
    )
    .filter((child) => child !== null);
};

const renderNode = (
  node: Element | Text,
  context: RenderContext
): ReactNode | null => {
  const styles = context.styles;

  if (node.type === "text") {
    const shouldAnimate =
      context.isAnimating &&
      context.animated &&
      !(context.parentTag && animationSkipTags.has(context.parentTag));

    if (!shouldAnimate) {
      return node.value;
    }

    const options: Required<AnimateOptions> = {
      animation: context.animated?.animation ?? "fadeIn",
      duration: context.animated?.duration ?? 150,
      easing: context.animated?.easing ?? "ease",
      maxAnimatedTokens: context.animated?.maxAnimatedTokens ?? 400,
      sep: context.animated?.sep ?? "word",
    };

    const parts =
      options.sep === "char" ? splitByChar(node.value) : splitByWord(node.value);
    if (countAnimatableTokens(parts) > options.maxAnimatedTokens) {
      return node.value;
    }

    return parts.map((part, index) => {
      if (whitespaceOnlyRegex.test(part)) {
        return part;
      }
      return (
        <AnimatedToken
          key={`${context.keyPrefix}-token-${index}`}
          options={options}
          text={part}
        />
      );
    });
  }

  if (node.type !== "element") {
    return null;
  }

  const key = context.keyPrefix;
  const children = renderChildren(node, context);

  switch (node.tagName) {
    case "h1":
      return (
        <RNText key={key} style={styles.h1}>
          {renderTextChildren(children)}
        </RNText>
      );
    case "h2":
      return (
        <RNText key={key} style={styles.h2}>
          {renderTextChildren(children)}
        </RNText>
      );
    case "h3":
      return (
        <RNText key={key} style={styles.h3}>
          {renderTextChildren(children)}
        </RNText>
      );
    case "h4":
    case "h5":
    case "h6":
      return (
        <RNText key={key} style={styles.h4}>
          {renderTextChildren(children)}
        </RNText>
      );
    case "p":
      return (
        <RNText key={key} style={styles.paragraph}>
          {renderTextChildren(children)}
        </RNText>
      );
    case "strong":
      return (
        <RNText key={key} style={styles.strong}>
          {renderTextChildren(children)}
        </RNText>
      );
    case "em":
      return (
        <RNText key={key} style={styles.emphasis}>
          {renderTextChildren(children)}
        </RNText>
      );
    case "a": {
      const hrefValue = node.properties?.href;
      const hrefRaw = hrefValue ? String(hrefValue) : "";
      const href = context.urlTransform
        ? context.urlTransform(hrefRaw, "href", node) ?? ""
        : hrefRaw;
      return (
        <RNText
          key={key}
          onPress={() => {
            if (href && context.onLinkPress) {
              context.onLinkPress(href);
            }
          }}
          style={styles.link}
        >
          {renderTextChildren(children)}
        </RNText>
      );
    }
    case "img": {
      const srcValue = node.properties?.src;
      const srcRaw = srcValue ? String(srcValue) : "";
      const src = context.urlTransform
        ? context.urlTransform(srcRaw, "src", node) ?? ""
        : srcRaw;
      if (!src) {
        return null;
      }
      const alt =
        typeof node.properties?.alt === "string"
          ? node.properties.alt
          : "Image";
      const widthRaw = node.properties?.width;
      const heightRaw = node.properties?.height;
      const width = Number.isFinite(Number(widthRaw))
        ? Number(widthRaw)
        : undefined;
      const height = Number.isFinite(Number(heightRaw))
        ? Number(heightRaw)
        : undefined;
      return (
        <MarkdownImage
          alt={alt}
          height={height}
          key={key}
          src={src}
          styles={styles}
          width={width}
        />
      );
    }
    case "code": {
      const isInline = context.parentTag !== "pre";
      const language = resolveLanguage(node);
      if (!isInline) {
        return (
          <HighlightedCodeBlock
            code={toString(node)}
            codePlugin={context.codePlugin}
            frozenCodeBlock={context.frozenCodeBlock}
            key={key}
            language={language}
            mode={context.mode}
            staticCodeStrategy={context.staticCodeStrategy}
            styles={context.styles}
          />
        );
      }
      return (
        <RNText key={key} style={styles.inlineCode}>
          {toString(node)}
        </RNText>
      );
    }
    case "pre":
      return (
        <ScrollView
          horizontal={true}
          key={key}
          showsHorizontalScrollIndicator={false}
          style={styles.codeBlockWrapper}
        >
          <View style={styles.codeBlock}>
            {children.length ? children : <RNText style={styles.codeBlockText} />}
          </View>
        </ScrollView>
      );
    case "blockquote":
      return (
        <View key={key} style={styles.blockquote}>
          {renderViewChildren(children, key, styles)}
        </View>
      );
    case "hr":
      return <View key={key} style={styles.hr} />;
    case "br":
      return "\n";
    case "ul":
    case "ol":
      return (
        <View key={key} style={styles.list}>
          {renderViewChildren(children, key, styles)}
        </View>
      );
    case "li": {
      const bullet =
        context.parentTag === "ol" ? `${(context.listIndex ?? 0) + 1}.` : "•";
      return (
        <View key={key} style={styles.listItemRow}>
          <RNText style={styles.listBullet}>{bullet}</RNText>
          <View style={styles.listItemBody}>
            {renderViewChildren(children, key, styles)}
          </View>
        </View>
      );
    }
    case "table":
      return (
        <ScrollView horizontal={true} key={key} style={styles.tableScroll}>
          <View style={styles.table}>{renderViewChildren(children, key, styles)}</View>
        </ScrollView>
      );
    case "thead":
    case "tbody":
      return (
        <View key={key} style={styles.tableSection}>
          {renderViewChildren(children, key, styles)}
        </View>
      );
    case "tr":
      return (
        <View key={key} style={styles.tableRow}>
          {renderViewChildren(children, key, styles)}
        </View>
      );
    case "th":
      return (
        <RNText key={key} style={styles.tableHeaderCell}>
          {toString(node)}
        </RNText>
      );
    case "td":
      return (
        <RNText key={key} style={styles.tableCell}>
          {toString(node)}
        </RNText>
      );
    default:
      if (children.length === 0) {
        return null;
      }
      return (
        <View key={key} style={styles.genericBlock}>
          {renderViewChildren(children, key, styles)}
        </View>
      );
  }
};

export interface MarkdownNativeProps {
  allowElement?: AllowElement;
  allowedElements?: readonly string[];
  content: string;
  disallowedElements?: readonly string[];
  animated?: AnimateOptions;
  codePlugin?: CodeHighlighterPlugin;
  frozenCodeBlock?: FrozenCodeBlock;
  isAnimating?: boolean;
  mode?: "streaming" | "static";
  onLinkPress?: (href: string) => void;
  staticCodeStrategy?: "freeze" | "plain" | "highlight";
  theme?: MarkdownNativeTheme;
  unwrapDisallowed?: boolean;
  urlTransform?: UrlTransform;
}

const shouldRemoveElement = (
  node: Readonly<Element>,
  index: number | undefined,
  parent: Readonly<Parents> | undefined,
  allowedElements: readonly string[] | undefined,
  disallowedElements: readonly string[] | undefined,
  allowElement: AllowElement | undefined
): boolean => {
  let remove = false;

  if (allowedElements) {
    remove = !allowedElements.includes(node.tagName);
  } else if (disallowedElements) {
    remove = disallowedElements.includes(node.tagName);
  }

  if (!remove && allowElement && typeof index === "number") {
    remove = !allowElement(node, index, parent);
  }

  return remove;
};

export const __filterTestUtils = {
  mapEasing,
  shouldRemoveElement,
};

const transformTree = (
  node: Root | Element | Text,
  context: RenderContext,
  index: number | undefined,
  parent: Parents | undefined
): Root | Element | Text | Array<Element | Text> | null => {
  if (node.type === "text") {
    return node;
  }

  const children = node.children ?? [];
  const transformedChildren: Array<Element | Text> = [];
  children.forEach((child, childIndex) => {
    const transformed = transformTree(
      child as Element | Text,
      context,
      childIndex,
      node
    );
    if (Array.isArray(transformed)) {
      transformedChildren.push(...transformed);
      return;
    }
    if (transformed) {
      transformedChildren.push(transformed as Element | Text);
    }
  });

  if (node.type === "element") {
    const transformedNode: Element = {
      ...node,
      children: transformedChildren,
    };

    const remove = shouldRemoveElement(
      transformedNode,
      index,
      parent,
      context.allowedElements,
      context.disallowedElements,
      context.allowElement
    );

    if (remove) {
      if (context.unwrapDisallowed) {
        return transformedChildren;
      }
      return null;
    }

    return transformedNode;
  }

  return {
    ...node,
    children: transformedChildren,
  };
};

const MarkdownImage = memo(
  ({
    src,
    alt,
    width,
    height,
    styles,
  }: {
    alt: string;
    height?: number;
    src: string;
    styles: ReturnType<typeof createStyles>;
    width?: number;
  }) => {
    const [hasError, setHasError] = useState(false);
    if (hasError) {
      return <RNText style={styles.imageFallback}>Image not available</RNText>;
    }
    return (
      <View style={styles.imageWrapper}>
        <RNImage
          accessibilityLabel={alt}
          onError={() => setHasError(true)}
          resizeMode="contain"
          source={{ uri: src }}
          style={[
            styles.image,
            width ? { width } : null,
            height ? { height } : null,
          ]}
        />
      </View>
    );
  }
);

MarkdownImage.displayName = "MarkdownImage";

export const MarkdownNative = memo(
  ({
    content,
    onLinkPress,
    animated,
    codePlugin,
    frozenCodeBlock,
    isAnimating,
    mode = "streaming",
    allowElement,
    allowedElements,
    disallowedElements,
    staticCodeStrategy = "plain",
    theme,
    unwrapDisallowed,
    urlTransform,
  }: MarkdownNativeProps) => {
    const styles = useMemo(() => createStyles(theme), [theme]);
    const tree = useMemo(
      () => processor.runSync(processor.parse(content)) as Root,
      [content]
    );

    const transformedTree = useMemo(
      () =>
        transformTree(
          tree,
          {
            keyPrefix: "root",
            onLinkPress,
            animated,
            codePlugin,
            frozenCodeBlock,
            isAnimating,
            mode,
            allowElement,
            allowedElements,
            disallowedElements,
            staticCodeStrategy,
            styles,
            unwrapDisallowed,
            urlTransform,
          },
          undefined,
          undefined
        ) as Root,
      [
        tree,
        onLinkPress,
        animated,
        codePlugin,
        frozenCodeBlock,
        isAnimating,
        mode,
        allowElement,
        allowedElements,
        disallowedElements,
        staticCodeStrategy,
        styles,
        unwrapDisallowed,
        urlTransform,
      ]
    );

    const nodes = useMemo(
      () =>
        renderChildren(transformedTree, {
          keyPrefix: "root",
          onLinkPress,
          animated,
          codePlugin,
          frozenCodeBlock,
          isAnimating,
          mode,
          allowElement,
          allowedElements,
          disallowedElements,
          staticCodeStrategy,
          styles,
          unwrapDisallowed,
          urlTransform,
        }),
      [
        transformedTree,
        onLinkPress,
        animated,
        codePlugin,
        frozenCodeBlock,
        isAnimating,
        mode,
        allowElement,
        allowedElements,
        disallowedElements,
        staticCodeStrategy,
        styles,
        unwrapDisallowed,
        urlTransform,
      ]
    );

    return (
      <View style={styles.container}>
        {renderViewChildren(nodes, "root-container", styles)}
      </View>
    );
  }
);

MarkdownNative.displayName = "MarkdownNative";

const defaultTheme: Required<MarkdownNativeTheme> = {
  blockquoteBorderColor: "#8D8A84",
  codeBlockBackgroundColor: "#13100F",
  codeBlockBorderColor: "rgba(141, 138, 132, 0.35)",
  codeTextColor: "#F6EFE4",
  imageBackgroundColor: "#302722",
  inlineCodeBackgroundColor: "#201918",
  inlineCodeTextColor: "#F6EFE4",
  linkColor: "#7AC7D9",
  mutedTextColor: "#D7B98D",
  ruleColor: "rgba(141, 138, 132, 0.35)",
  tableBorderColor: "rgba(141, 138, 132, 0.35)",
  tableHeaderBackgroundColor: "#302722",
  textColor: "#F6EFE4",
};

const createStyles = (theme?: MarkdownNativeTheme) => {
  const palette = {
    ...defaultTheme,
    ...theme,
  };

  return StyleSheet.create({
    container: {
      gap: 8,
    },
    genericBlock: {
      gap: 6,
    },
    h1: {
      fontSize: 30,
      fontWeight: "700",
      marginTop: 10,
      marginBottom: 6,
      color: palette.textColor,
    },
    h2: {
      fontSize: 24,
      fontWeight: "700",
      marginTop: 10,
      marginBottom: 6,
      color: palette.textColor,
    },
    h3: {
      fontSize: 20,
      fontWeight: "700",
      marginTop: 10,
      marginBottom: 6,
      color: palette.textColor,
    },
    h4: {
      fontSize: 16,
      fontWeight: "700",
      marginTop: 8,
      marginBottom: 4,
      color: palette.textColor,
    },
    paragraph: {
      fontSize: 16,
      lineHeight: 24,
      color: palette.textColor,
    },
    strong: {
      fontWeight: "700",
    },
    emphasis: {
      fontStyle: "italic",
    },
    link: {
      color: palette.linkColor,
      textDecorationLine: "underline",
    },
    imageWrapper: {
      marginVertical: 8,
    },
    image: {
      width: "100%",
      minHeight: 120,
      maxHeight: 320,
      borderRadius: 10,
      backgroundColor: palette.imageBackgroundColor,
    },
    imageFallback: {
      color: palette.mutedTextColor,
      fontStyle: "italic",
      marginVertical: 8,
    },
    inlineCode: {
      fontFamily: "Menlo",
      fontSize: 14,
      backgroundColor: palette.inlineCodeBackgroundColor,
      color: palette.inlineCodeTextColor,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
    },
    codeBlockWrapper: {
      backgroundColor: palette.codeBlockBackgroundColor,
      borderColor: palette.codeBlockBorderColor,
      borderWidth: 1,
      borderRadius: 10,
    },
    codeBlock: {
      padding: 12,
      minWidth: "100%",
    },
    codeBlockText: {
      fontFamily: "Menlo",
      fontSize: 13,
      lineHeight: 20,
      color: palette.codeTextColor,
    },
    blockquote: {
      borderLeftColor: palette.blockquoteBorderColor,
      borderLeftWidth: 4,
      paddingLeft: 12,
      marginVertical: 4,
      gap: 6,
    },
    hr: {
      height: 1,
      backgroundColor: palette.ruleColor,
      marginVertical: 6,
    },
    list: {
      gap: 4,
      marginVertical: 4,
    },
    listItemRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
    },
    listBullet: {
      width: 18,
      fontSize: 16,
      lineHeight: 24,
      color: palette.textColor,
    },
    listItemBody: {
      flex: 1,
      gap: 4,
    },
    tableScroll: {
      borderWidth: 1,
      borderColor: palette.tableBorderColor,
      borderRadius: 8,
    },
    table: {
      minWidth: 320,
    },
    tableSection: {
      gap: 0,
    },
    tableRow: {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderBottomColor: palette.tableBorderColor,
    },
    tableHeaderCell: {
      minWidth: 120,
      paddingVertical: 8,
      paddingHorizontal: 10,
      fontWeight: "700",
      color: palette.textColor,
      backgroundColor: palette.tableHeaderBackgroundColor,
    },
    tableCell: {
      minWidth: 120,
      paddingVertical: 8,
      paddingHorizontal: 10,
      color: palette.textColor,
    },
  });
};

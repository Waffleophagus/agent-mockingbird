import { Image, Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import Markdown, { type RenderRules } from "react-native-markdown-display";
import SyntaxHighlighter from "react-native-syntax-highlighter";
import { atomOneDark } from "react-syntax-highlighter/styles/hljs";

import { chromePalette } from "@/theme/palette";

const styles = StyleSheet.create({
  body: {
    color: chromePalette.bone,
    fontSize: 14,
    lineHeight: 23,
  },
  paragraph: {
    marginTop: 0,
    marginBottom: 10,
  },
  heading1: {
    color: chromePalette.bone,
    fontSize: 24,
    lineHeight: 32,
    fontWeight: "700",
    marginBottom: 12,
  },
  heading2: {
    color: chromePalette.bone,
    fontSize: 20,
    lineHeight: 30,
    fontWeight: "700",
    marginBottom: 10,
  },
  heading3: {
    color: chromePalette.bone,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: "700",
    marginBottom: 8,
  },
  heading4: {
    color: chromePalette.bone,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "700",
    marginBottom: 8,
  },
  heading5: {
    color: chromePalette.bone,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "700",
    marginBottom: 6,
  },
  heading6: {
    color: chromePalette.haze,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    marginBottom: 6,
  },
  link: {
    color: chromePalette.ocean,
    textDecorationLine: "underline",
  },
  blockquote: {
    borderLeftColor: chromePalette.moss,
    borderLeftWidth: 3,
    marginVertical: 10,
    paddingLeft: 10,
    opacity: 0.9,
  },
  bulletList: {
    marginBottom: 12,
  },
  orderedList: {
    marginBottom: 12,
  },
  listItem: {
    marginBottom: 6,
  },
  hr: {
    borderBottomColor: `${chromePalette.bone}33`,
    borderBottomWidth: 1,
    marginVertical: 14,
  },
  inlineCode: {
    backgroundColor: `${chromePalette.ink}CC`,
    borderColor: `${chromePalette.bone}2A`,
    borderRadius: 6,
    borderWidth: 1,
    color: "#B7D2FF",
    fontFamily: "monospace",
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  codeBlockContainer: {
    backgroundColor: "#0A0A0E",
    borderColor: `${chromePalette.bone}1F`,
    borderRadius: 12,
    borderWidth: 1,
    marginVertical: 8,
    overflow: "hidden",
  },
  codeBlockHeader: {
    borderBottomColor: `${chromePalette.bone}1A`,
    borderBottomWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  codeBlockLanguage: {
    color: chromePalette.haze,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  codeBlockScroll: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  codeBlockText: {
    color: chromePalette.brass,
    fontFamily: "monospace",
    fontSize: 13,
    lineHeight: 20,
  },
  syntaxRoot: {
    backgroundColor: "transparent",
    margin: 0,
    padding: 0,
    minWidth: "100%",
  },
  image: {
    width: "100%",
    minHeight: 140,
    maxHeight: 300,
    borderRadius: 12,
    marginVertical: 8,
    backgroundColor: `${chromePalette.ink}AA`,
  },
});

const markdownStyle = {
  body: styles.body,
  paragraph: styles.paragraph,
  heading1: styles.heading1,
  heading2: styles.heading2,
  heading3: styles.heading3,
  heading4: styles.heading4,
  heading5: styles.heading5,
  heading6: styles.heading6,
  link: styles.link,
  blockquote: styles.blockquote,
  bullet_list: styles.bulletList,
  ordered_list: styles.orderedList,
  list_item: styles.listItem,
  hr: styles.hr,
  code_inline: styles.inlineCode,
};

const markdownRules: RenderRules = {
  fence: (node) => {
    const languageAttr = typeof node.attributes?.class === "string" ? node.attributes.class : "";
    const language = languageAttr.startsWith("language-") ? languageAttr.replace("language-", "").trim() : "";
    const rawContent = (node.content ?? "").replace(/\n$/, "");
    return (
      <View key={node.key} style={styles.codeBlockContainer}>
        {language ? (
          <View style={styles.codeBlockHeader}>
            <Text style={styles.codeBlockLanguage}>{language}</Text>
          </View>
        ) : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.codeBlockScroll}>
          <SyntaxHighlighter
            language={language || "text"}
            style={atomOneDark}
            highlighter="hljs"
            customStyle={styles.syntaxRoot}
            fontFamily="monospace"
            fontSize={13}
          >
            {rawContent}
          </SyntaxHighlighter>
        </ScrollView>
      </View>
    );
  },
  image: (node, _children, _parent, _styles, allowedImageHandlers, defaultImageHandler) => {
    const src = typeof node.attributes?.src === "string" ? node.attributes.src : "";
    const alt = typeof node.attributes?.alt === "string" ? node.attributes.alt : undefined;
    if (!src) return null;

    const canShowDirect = allowedImageHandlers.some(handler => src.toLowerCase().startsWith(handler.toLowerCase()));
    if (!canShowDirect && defaultImageHandler === null) return null;
    const uri = canShowDirect ? src : `${defaultImageHandler}${src}`;

    return (
      <Image
        key={node.key}
        source={{ uri }}
        style={styles.image}
        resizeMode="contain"
        accessibilityLabel={alt}
        accessible={Boolean(alt)}
      />
    );
  },
};

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

function onLinkPress(url: string) {
  void Linking.openURL(url).catch(() => {
    // Ignore bad links to avoid noisy runtime errors in chat rendering.
  });
  return true;
}

export function MarkdownMessage({ content }: { content: string }) {
  const displayContent = normalizeMarkdownContent(content);
  if (!displayContent.trim()) return null;

  return (
    <Markdown style={markdownStyle} rules={markdownRules} onLinkPress={onLinkPress} mergeStyle>
      {displayContent}
    </Markdown>
  );
}

import type { StreamdownRenderSnapshot } from "@streamdown/react-native";
import { Streamdown } from "@streamdown/react-native";
import { Linking, StyleSheet, View } from "react-native";

import { chromePalette } from "@/theme/palette";

const styles = StyleSheet.create({
  container: {
    marginTop: 2,
  },
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

function onLinkPress(url: string) {
  void Linking.openURL(url).catch(() => {
    // Keep rendering resilient for malformed links in message content.
  });
}

export function MarkdownMessage({
  content,
  isStreaming = false,
  renderSnapshot,
}: {
  content: string;
  isStreaming?: boolean;
  renderSnapshot?: StreamdownRenderSnapshot;
}) {
  const displayContent = normalizeMarkdownContent(content);
  if (!displayContent.trim()) return null;

  return (
    <View style={styles.container}>
      <Streamdown
        mode={isStreaming ? "streaming" : "static"}
        parseIncompleteMarkdown={isStreaming}
        isAnimating={isStreaming}
        animated={isStreaming ? { animation: "fadeIn", sep: "word" } : false}
        onLinkPress={onLinkPress}
        renderSnapshot={renderSnapshot}
        staticCodeStrategy="plain"
        theme={{
          blockquoteBorderColor: chromePalette.haze,
          codeBlockBackgroundColor: chromePalette.ink,
          codeBlockBorderColor: "rgba(246, 239, 228, 0.10)",
          codeTextColor: chromePalette.bone,
          imageBackgroundColor: chromePalette.ash,
          inlineCodeBackgroundColor: "rgba(246, 239, 228, 0.10)",
          inlineCodeTextColor: chromePalette.bone,
          linkColor: chromePalette.ocean,
          mutedTextColor: chromePalette.brass,
          ruleColor: "rgba(141, 138, 132, 0.35)",
          tableBorderColor: "rgba(141, 138, 132, 0.35)",
          tableHeaderBackgroundColor: chromePalette.ash,
          textColor: chromePalette.bone,
        }}
      >
        {displayContent}
      </Streamdown>
    </View>
  );
}

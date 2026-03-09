import type { StreamdownFrozenSnapshot } from "@streamdown/react-native";
import { Streamdown } from "@streamdown/react-native";
import { useEffect, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";

import {
  readCachedMarkdownSnapshot,
  writeCachedMarkdownSnapshot,
} from "@/features/chat/cache";
import { getStreamdownCodePlugin } from "@/lib/streamdown-code-plugin";

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
  snapshotCacheKey,
}: {
  content: string;
  isStreaming?: boolean;
  snapshotCacheKey?: {
    entryId: string;
    sessionId: string;
  };
}) {
  const displayContent = normalizeMarkdownContent(content);
  if (!displayContent.trim()) return null;

  const codePlugin = getStreamdownCodePlugin();
  const [frozenSnapshot, setFrozenSnapshot] = useState<
    StreamdownFrozenSnapshot | undefined
  >(() =>
    snapshotCacheKey
      ? readCachedMarkdownSnapshot(
          snapshotCacheKey.sessionId,
          snapshotCacheKey.entryId
        )
      : undefined
  );

  useEffect(() => {
    if (!snapshotCacheKey) {
      setFrozenSnapshot(undefined);
      return;
    }
    setFrozenSnapshot(
      readCachedMarkdownSnapshot(
        snapshotCacheKey.sessionId,
        snapshotCacheKey.entryId
      )
    );
  }, [snapshotCacheKey?.entryId, snapshotCacheKey?.sessionId]);

  const handleFrozenSnapshot = (snapshot: StreamdownFrozenSnapshot) => {
    setFrozenSnapshot(snapshot);
    if (!snapshotCacheKey) {
      return;
    }
    writeCachedMarkdownSnapshot(
      snapshotCacheKey.sessionId,
      snapshotCacheKey.entryId,
      snapshot
    );
  };

  return (
    <View style={styles.container}>
      <Streamdown
        frozenSnapshot={frozenSnapshot}
        mode={isStreaming ? "streaming" : "static"}
        onFrozenSnapshot={handleFrozenSnapshot}
        parseIncompleteMarkdown={isStreaming}
        isAnimating={isStreaming}
        animated={isStreaming ? { animation: "fadeIn", sep: "word" } : false}
        onLinkPress={onLinkPress}
        plugins={codePlugin ? { code: codePlugin } : undefined}
        staticCodeStrategy="freeze"
      >
        {displayContent}
      </Streamdown>
    </View>
  );
}

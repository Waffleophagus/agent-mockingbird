import type { StreamdownRenderSnapshot } from "@agent-mockingbird/contracts/dashboard";
import { code } from "@streamdown/code";
import { memo } from "react";
import { Streamdown } from "streamdown";

import { cn } from "@/lib/utils";

const STREAMDOWN_PLUGINS = { code };

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

interface MarkdownMessageProps {
  content: string;
  isStreaming: boolean;
  variant?: "message" | "thinking";
  className?: string;
  renderSnapshot?: StreamdownRenderSnapshot;
}

export const MarkdownMessage = memo(function MarkdownMessage({
  content,
  isStreaming,
  variant = "message",
  className,
  renderSnapshot,
}: MarkdownMessageProps) {
  const displayContent = normalizeMarkdownContent(content);
  if (!displayContent.trim()) return null;
  return (
    <Streamdown
      className={cn("chat-markdown", variant === "thinking" && "chat-markdown-thinking", className)}
      mode={isStreaming ? "streaming" : "static"}
      parseIncompleteMarkdown={isStreaming}
      isAnimating={isStreaming}
      animated={isStreaming}
      plugins={STREAMDOWN_PLUGINS}
      renderSnapshot={renderSnapshot}
    >
      {displayContent}
    </Streamdown>
  );
});

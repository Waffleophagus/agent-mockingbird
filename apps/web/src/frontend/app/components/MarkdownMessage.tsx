import { code } from "@streamdown/code";
import { memo } from "react";
import { Streamdown } from "streamdown";

import { cn } from "@/lib/utils";

const STREAMDOWN_PLUGINS = { code };

interface MarkdownMessageProps {
  content: string;
  isStreaming: boolean;
  variant?: "message" | "thinking";
  className?: string;
}

export const MarkdownMessage = memo(function MarkdownMessage({
  content,
  isStreaming,
  variant = "message",
  className,
}: MarkdownMessageProps) {
  if (!content.trim()) return null;
  return (
    <Streamdown
      className={cn("chat-markdown", variant === "thinking" && "chat-markdown-thinking", className)}
      mode={isStreaming ? "streaming" : "static"}
      parseIncompleteMarkdown={isStreaming}
      isAnimating={isStreaming}
      animated={isStreaming}
      plugins={STREAMDOWN_PLUGINS}
    >
      {content}
    </Streamdown>
  );
});

import { AlertTriangle, LoaderCircle, RefreshCcw } from "lucide-react";
import type { RefObject } from "react";

import { Button } from "@/components/ui/button";
import {
  formatCompactTimestamp,
  formatElapsedFrom,
  type LocalChatMessage,
  relativeFromIso,
  sanitizeMessageContentForDisplay,
  shouldHideMirroredAssistantContent,
} from "@/frontend/app/chatHelpers";
import { MarkdownMessage } from "@/frontend/app/components/MarkdownMessage";
import type { ChatMessagePart } from "@/types/dashboard";

function stringifyToolInput(input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return "";
  }
}

function resolvePartTimestamp(part: ChatMessagePart, fallbackIso: string): string {
  const iso = part.startedAt ?? part.observedAt ?? fallbackIso;
  return iso;
}

function sortPartsChronologically(parts: ChatMessagePart[], fallbackIso: string): ChatMessagePart[] {
  return [...parts].sort((left, right) => {
    const leftTs = Date.parse(resolvePartTimestamp(left, fallbackIso));
    const rightTs = Date.parse(resolvePartTimestamp(right, fallbackIso));
    if (Number.isFinite(leftTs) && Number.isFinite(rightTs) && leftTs !== rightTs) return leftTs - rightTs;
    return left.id.localeCompare(right.id);
  });
}

export interface MessageTimelineProps {
  messages: LocalChatMessage[];
  chatScrollRef: RefObject<HTMLDivElement | null>;
  hasNewMessages: boolean;
  isUserScrolledUp: boolean;
  scrollToBottom: () => void;
  loadingMessages: boolean;
  showThinkingDetails: boolean;
  showToolCallDetails: boolean;
  retryFailedRequest: (requestId: string) => void;
}

export function MessageTimeline(props: MessageTimelineProps) {
  const {
    chatScrollRef,
    hasNewMessages,
    isUserScrolledUp,
    loadingMessages,
    messages,
    retryFailedRequest,
    scrollToBottom,
    showThinkingDetails,
    showToolCallDetails,
  } = props;

  return (
    <div className="oc-timeline" ref={chatScrollRef}>
      {hasNewMessages && isUserScrolledUp && (
        <button type="button" onClick={scrollToBottom} className="oc-new-message-chip">New messages</button>
      )}
      {loadingMessages && <p className="text-sm text-muted-foreground">Loading messages...</p>}
      {!loadingMessages && messages.length === 0 && <p className="text-sm text-muted-foreground">No messages yet.</p>}
      {messages.map(message => {
        const messageContent = sanitizeMessageContentForDisplay(message.role, message.content);
        const hideMirroredAssistantContent = shouldHideMirroredAssistantContent(message, showThinkingDetails);
        const renderedMessageContent = hideMirroredAssistantContent ? "" : messageContent;
        const pendingMeta = message.uiMeta?.type === "assistant-pending" ? message.uiMeta : null;
        const isPending = pendingMeta?.status === "pending";
        const isQueued = pendingMeta?.status === "queued";
        const isDetached = pendingMeta?.status === "detached";
        const isFailed = pendingMeta?.status === "failed";
        const shouldRenderMessageRow =
          message.role !== "assistant" ||
          isPending || isQueued || isDetached || isFailed ||
          Boolean(renderedMessageContent.trim()) ||
          Boolean(message.memoryTrace);

        const visibleTimelineParts = message.role === "assistant"
          ? sortPartsChronologically((message.parts ?? []).filter(part => {
            if (part.type === "thinking") return showThinkingDetails;
            if (part.type === "tool_call") return showToolCallDetails;
            return false;
          }), message.at)
          : [];

        return (
          <div key={message.id} className="oc-turn-block">
            {visibleTimelineParts.map(part => {
              const partIso = resolvePartTimestamp(part, message.at);
              const partTimestamp = formatCompactTimestamp(partIso) || relativeFromIso(partIso);
              const elapsed = formatElapsedFrom(message.at, partIso);

              if (part.type === "thinking") {
                return (
                  <article key={`${message.id}-${part.id}`} className="oc-subturn">
                    <div className="oc-subturn-head">
                      <p>thinking</p>
                      <p>{elapsed ? `${elapsed} · ` : ""}{partTimestamp}</p>
                    </div>
                    <MarkdownMessage className="mt-1" content={part.text} isStreaming={isPending} variant="thinking" />
                  </article>
                );
              }

              const detailsInput = stringifyToolInput(part.input);
              return (
                <article key={`${message.id}-${part.id}`} className="oc-subturn">
                  <div className="oc-subturn-head">
                    <p>tool · {part.tool}</p>
                    <p>{elapsed ? `${elapsed} · ` : ""}{partTimestamp}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">status: {part.status}</p>
                  {(detailsInput || part.output || part.error) && (
                    <details className="mt-2 rounded border border-border/60 bg-background/50 p-2">
                      <summary className="cursor-pointer text-[11px] text-muted-foreground">details</summary>
                      {detailsInput && <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[11px]">{detailsInput}</pre>}
                      {part.output && <p className="mt-1 whitespace-pre-wrap text-[11px]">{part.output}</p>}
                      {part.error && <p className="mt-1 whitespace-pre-wrap text-[11px] text-destructive">{part.error}</p>}
                    </details>
                  )}
                </article>
              );
            })}

            {shouldRenderMessageRow && (
              <article className="oc-message" data-role={message.role}>
                <div className="oc-message-head">
                  <p>{message.role}</p>
                  <p>{formatCompactTimestamp(message.at) || relativeFromIso(message.at)}</p>
                </div>
                {isPending && (
                  <p className="inline-flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />OpenCode is responding...</p>
                )}
                {isFailed && (
                  <div className="space-y-2">
                    <p className="inline-flex items-center gap-2 text-xs text-destructive"><AlertTriangle className="size-3.5" />Failed to send request.</p>
                    {pendingMeta?.errorMessage && <p className="text-xs text-muted-foreground">{pendingMeta.errorMessage}</p>}
                    <Button type="button" size="sm" variant="outline" onClick={() => pendingMeta && retryFailedRequest(pendingMeta.requestId)}>
                      <RefreshCcw className="size-3.5" />Retry
                    </Button>
                  </div>
                )}
                {(isQueued || isDetached) && pendingMeta?.errorMessage && (
                  <p className="text-xs text-muted-foreground">{pendingMeta.errorMessage}</p>
                )}
                <MarkdownMessage className="mt-1" content={renderedMessageContent} isStreaming={Boolean(isPending)} variant="message" />
              </article>
            )}
          </div>
        );
      })}
    </div>
  );
}

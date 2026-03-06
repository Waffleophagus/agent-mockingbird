import type { BackgroundRunSnapshot, ChatMessagePart } from "@agent-mockingbird/contracts/dashboard";
import { AlertTriangle, ArrowRight, ChevronDown, LoaderCircle, RefreshCcw, Sparkles, Wrench } from "lucide-react";
import type { RefObject } from "react";

import { Button } from "@/components/ui/button";
import {
  extractBackgroundAnnouncements,
  formatCompactTimestamp,
  formatElapsedFrom,
  type LocalChatMessage,
  relativeFromIso,
  sanitizeMessageContentForDisplay,
  shouldHideMirroredAssistantContent,
} from "@/frontend/app/chatHelpers";
import { MarkdownMessage } from "@/frontend/app/components/MarkdownMessage";

function stringifyToolInput(input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return "";
  }
}

function resolvePartTimestamp(part: ChatMessagePart, fallbackIso: string): string {
  return part.startedAt ?? part.observedAt ?? fallbackIso;
}

function sortPartsChronologically(parts: ChatMessagePart[], fallbackIso: string): ChatMessagePart[] {
  return [...parts].sort((left, right) => {
    const leftTs = Date.parse(resolvePartTimestamp(left, fallbackIso));
    const rightTs = Date.parse(resolvePartTimestamp(right, fallbackIso));
    if (Number.isFinite(leftTs) && Number.isFinite(rightTs) && leftTs !== rightTs) return leftTs - rightTs;
    return left.id.localeCompare(right.id);
  });
}

type SessionTurn = {
  id: string;
  user?: LocalChatMessage;
  assistantMessages: LocalChatMessage[];
};

function buildTurns(messages: LocalChatMessage[]): SessionTurn[] {
  const turns: SessionTurn[] = [];
  let current: SessionTurn | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      current = {
        id: message.id,
        user: message,
        assistantMessages: [],
      };
      turns.push(current);
      continue;
    }

    if (!current) {
      current = {
        id: message.id,
        assistantMessages: [message],
      };
      turns.push(current);
      continue;
    }

    current.assistantMessages.push(message);
  }

  return turns;
}

function toolSummary(part: Extract<ChatMessagePart, { type: "tool_call" }>) {
  if (part.error?.trim()) return part.error.trim();
  if (part.output?.trim()) return part.output.trim().slice(0, 120);
  if (part.input && Object.keys(part.input).length > 0) {
    return `${Object.keys(part.input).length} arg${Object.keys(part.input).length === 1 ? "" : "s"}`;
  }
  return "No details";
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
  activeBackgroundRuns: BackgroundRunSnapshot[];
  onSelectSession: (sessionId: string) => void;
  sessionTitleById: Map<string, string>;
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
    activeBackgroundRuns,
    onSelectSession,
    sessionTitleById,
  } = props;

  const turns = buildTurns(messages);
  const runsById = new Map(activeBackgroundRuns.map(run => [run.runId, run]));
  const renderedBackgroundRunIds = new Set<string>();

  return (
    <div className="oc-timeline" ref={chatScrollRef}>
      {hasNewMessages && isUserScrolledUp && (
        <button type="button" onClick={scrollToBottom} className="oc-new-message-chip">New messages</button>
      )}
      {loadingMessages && <p className="text-sm text-muted-foreground">Loading messages...</p>}
      {!loadingMessages && messages.length === 0 && <p className="text-sm text-muted-foreground">No messages yet.</p>}
      {turns.map(turn => (
        <div key={turn.id} className="oc-turn-block">
          {turn.user ? (
            <article className="oc-turn-user-card">
              <div className="oc-turn-row-head">
                <p>You</p>
                <p>{formatCompactTimestamp(turn.user.at) || relativeFromIso(turn.user.at)}</p>
              </div>
              <MarkdownMessage content={sanitizeMessageContentForDisplay(turn.user.role, turn.user.content)} isStreaming={false} variant="message" />
            </article>
          ) : null}

          <div className="oc-turn-response-column">
            {turn.assistantMessages.map(message => {
              const messageContent = sanitizeMessageContentForDisplay(message.role, message.content);
              const backgroundContent = extractBackgroundAnnouncements(messageContent);
              const hideMirroredAssistantContent = shouldHideMirroredAssistantContent(message, showThinkingDetails);
              const renderedMessageContent = hideMirroredAssistantContent ? "" : backgroundContent.remainingContent;
              const pendingMeta = message.uiMeta?.type === "assistant-pending" ? message.uiMeta : null;
              const isPending = pendingMeta?.status === "pending";
              const isQueued = pendingMeta?.status === "queued";
              const isDetached = pendingMeta?.status === "detached";
              const isFailed = pendingMeta?.status === "failed";
              const visibleBackgroundAnnouncements = backgroundContent.announcements.filter(announcement => {
                if (renderedBackgroundRunIds.has(announcement.runId)) return false;
                renderedBackgroundRunIds.add(announcement.runId);
                return true;
              });
              const visibleTimelineParts = sortPartsChronologically(
                (message.parts ?? []).filter(part => {
                  if (part.type === "thinking") return showThinkingDetails;
                  if (part.type === "tool_call") return showToolCallDetails;
                  return false;
                }),
                message.at,
              );

              return (
                <article key={message.id} className="oc-turn-response-card" data-pending={isPending || undefined}>
                  <div className="oc-turn-row-head oc-turn-row-head-subtle">
                    <p>OpenCode</p>
                    <p>{formatCompactTimestamp(message.at) || relativeFromIso(message.at)}</p>
                  </div>

                  {visibleBackgroundAnnouncements.length > 0 ? (
                    <div className="oc-subagent-links">
                      {visibleBackgroundAnnouncements.map(announcement => {
                        const run = runsById.get(announcement.runId);
                        const targetSessionId = run?.childSessionId ?? announcement.childSessionId;
                        const sessionTitle = sessionTitleById.get(targetSessionId) ?? targetSessionId;
                        const summary = announcement.summary || run?.resultSummary || "Background session ready.";

                        return (
                          <button
                            key={`${message.id}-${announcement.runId}`}
                            type="button"
                            className="oc-subagent-link-card"
                            onClick={() => onSelectSession(targetSessionId)}
                          >
                            <div className="oc-subagent-link-copy">
                              <p className="oc-subagent-link-kicker">Subagent session</p>
                              <p className="oc-subagent-link-title">{sessionTitle}</p>
                              <p className="oc-subagent-link-summary">{summary}</p>
                            </div>
                            <span className="oc-subagent-link-action">
                              Open
                              <ArrowRight className="size-3.5" />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  {visibleTimelineParts.length > 0 ? (
                    <div className="oc-turn-parts">
                      {visibleTimelineParts.map(part => {
                        const partIso = resolvePartTimestamp(part, message.at);
                        const partTimestamp = formatCompactTimestamp(partIso) || relativeFromIso(partIso);
                        const elapsed = formatElapsedFrom(message.at, partIso);

                        if (part.type === "thinking") {
                          return (
                            <article key={`${message.id}-${part.id}`} className="oc-turn-part oc-turn-part-thinking">
                              <div className="oc-turn-part-head">
                                <p><Sparkles className="size-3" /> Thinking</p>
                                <p>{elapsed ? `${elapsed} · ` : ""}{partTimestamp}</p>
                              </div>
                              <MarkdownMessage content={part.text} isStreaming={isPending} variant="thinking" />
                            </article>
                          );
                        }

                        const detailsInput = stringifyToolInput(part.input);
                        const summary = toolSummary(part);
                        return (
                          <details key={`${message.id}-${part.id}`} className="oc-turn-part oc-turn-part-tool">
                            <summary className="oc-turn-tool-summary">
                              <div className="oc-turn-part-head oc-turn-part-head-tool">
                                <p><Wrench className="size-3" /> {part.tool}</p>
                                <p>{elapsed ? `${elapsed} · ` : ""}{partTimestamp}</p>
                              </div>
                              <div className="oc-turn-tool-summary-copy">
                                <p className="text-xs text-muted-foreground">status: {part.status}</p>
                                <p className="oc-turn-tool-summary-text">{summary}</p>
                              </div>
                              <ChevronDown className="oc-turn-tool-chevron size-3.5" />
                            </summary>
                            {(detailsInput || part.output || part.error) ? (
                              <div className="oc-turn-tool-details">
                                {detailsInput ? <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[11px]">{detailsInput}</pre> : null}
                                {part.output ? <p className="mt-1 whitespace-pre-wrap text-[11px]">{part.output}</p> : null}
                                {part.error ? <p className="mt-1 whitespace-pre-wrap text-[11px] text-destructive">{part.error}</p> : null}
                              </div>
                            ) : null}
                          </details>
                        );
                      })}
                    </div>
                  ) : null}

                  {isPending ? (
                    <p className="inline-flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />OpenCode is responding...</p>
                  ) : null}
                  {isFailed ? (
                    <div className="space-y-2">
                      <p className="inline-flex items-center gap-2 text-xs text-destructive"><AlertTriangle className="size-3.5" />Failed to send request.</p>
                      {pendingMeta?.errorMessage ? <p className="text-xs text-muted-foreground">{pendingMeta.errorMessage}</p> : null}
                      {pendingMeta ? (
                        <Button type="button" size="sm" variant="outline" onClick={() => retryFailedRequest(pendingMeta.requestId)}>
                          <RefreshCcw className="size-3.5" />Retry
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                  {(isQueued || isDetached) && pendingMeta?.errorMessage ? (
                    <p className="text-xs text-muted-foreground">{pendingMeta.errorMessage}</p>
                  ) : null}
                  {renderedMessageContent.trim() ? (
                    <MarkdownMessage className="mt-1" content={renderedMessageContent} isStreaming={Boolean(isPending)} variant="message" />
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

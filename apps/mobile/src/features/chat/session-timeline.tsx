import { KeyboardAvoidingLegendList } from "@legendapp/list/keyboard";
import type { ChatMessagePart } from "@agent-mockingbird/contracts/dashboard";
import { AlertTriangle, Brain, ChevronDown, LoaderCircle, RefreshCcw, Wrench } from "lucide-react-native";
import { memo, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { MarkdownMessage } from "@/components/markdown-message";
import { PanelCard } from "@/components/panel-card";
import {
  buildTurns,
  formatCompactTimestamp,
  relativeFromIso,
  sanitizeMessageContentForDisplay,
  type LocalChatMessage,
  type MessageTurn,
} from "@/features/chat/chat-helpers";

const ESTIMATED_ITEM_SIZE = 260;
const DRAW_DISTANCE = 400;

function resolvePartTimestamp(part: ChatMessagePart, fallbackIso: string) {
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

function stringifyToolInput(input: Record<string, unknown> | undefined) {
  if (!input) return "";
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return "";
  }
}

function toolSummary(part: Extract<ChatMessagePart, { type: "tool_call" }>) {
  if (part.error?.trim()) return part.error.trim();
  if (part.output?.trim()) return part.output.trim().slice(0, 140);
  if (part.input && Object.keys(part.input).length > 0) {
    return `${Object.keys(part.input).length} arg${Object.keys(part.input).length === 1 ? "" : "s"}`;
  }
  return "No details";
}

function ToolCallCard({
  expanded,
  onToggle,
  part,
}: {
  expanded: boolean;
  onToggle: () => void;
  part: Extract<ChatMessagePart, { type: "tool_call" }>;
}) {
  const detailsInput = useMemo(() => stringifyToolInput(part.input), [part.input]);
  const hasDetails = Boolean(detailsInput || part.output || part.error);

  return (
    <PanelCard className="mt-3 rounded-[24px] border-ocean/20 bg-ocean/10 px-4 py-4">
      <Pressable onPress={onToggle} className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <View className="flex-row items-center gap-2">
            <Wrench color="#7AC7D9" size={14} />
            <Text className="text-xs font-bold uppercase tracking-[1.4px] text-ocean">{part.tool}</Text>
          </View>
          <Text className="mt-2 text-sm text-bone">{toolSummary(part)}</Text>
          <Text className="mt-2 text-[11px] uppercase tracking-[1.4px] text-haze">status {part.status}</Text>
        </View>
        <ChevronDown color="#F6EFE4" size={16} style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }} />
      </Pressable>
      {expanded && hasDetails ? (
        <View className="mt-4 gap-3">
          {detailsInput ? <Text selectable className="font-mono text-[12px] leading-5 text-brass">{detailsInput}</Text> : null}
          {part.output ? <MarkdownMessage content={part.output} /> : null}
          {part.error ? <MarkdownMessage content={part.error} /> : null}
        </View>
      ) : null}
    </PanelCard>
  );
}

const SessionTimelineTurnRow = memo(function SessionTimelineTurnRow({
  expandedToolCallIds,
  onRetryRequest,
  onToggleToolCall,
  showThinkingDetails,
  showToolCallDetails,
  turn,
}: {
  expandedToolCallIds: Record<string, boolean>;
  onRetryRequest: (requestId: string, content: string) => void;
  onToggleToolCall: (partId: string) => void;
  showThinkingDetails: boolean;
  showToolCallDetails: boolean;
  turn: MessageTurn;
}) {
  return (
    <View className="gap-3 pb-5">
      {turn.user ? (
        <View className="self-end max-w-[92%] rounded-[28px] border border-ember/25 bg-ember/12 px-4 py-4">
          <Text className="text-[11px] font-bold uppercase tracking-[1.8px] text-emberSoft">
            You · {formatCompactTimestamp(turn.user.at) || relativeFromIso(turn.user.at)}
          </Text>
          <View className="mt-2">
            <MarkdownMessage
              content={sanitizeMessageContentForDisplay(turn.user.role, turn.user.content)}
              renderSnapshot={turn.user.renderSnapshot}
            />
          </View>
        </View>
      ) : null}

      {turn.assistantMessages.map(message => {
        const visibleParts = sortPartsChronologically(
          (message.parts ?? []).filter(part => {
            if (part.type === "thinking") return showThinkingDetails;
            if (part.type === "tool_call") return showToolCallDetails;
            return false;
          }),
          message.at,
        );
        const pendingMeta = message.uiMeta?.type === "assistant-pending" ? message.uiMeta : null;

        return (
          <PanelCard key={message.id} className="rounded-[28px] border-bone/10 bg-ash/90 px-4 py-4">
            <Text className="text-[11px] font-bold uppercase tracking-[1.8px] text-haze">
              OpenCode · {formatCompactTimestamp(message.at) || relativeFromIso(message.at)}
            </Text>

            {message.content.trim() ? (
              <View className="mt-3">
                <MarkdownMessage
                  content={sanitizeMessageContentForDisplay(message.role, message.content)}
                  isStreaming={pendingMeta?.status === "pending"}
                  liveCodeHighlights={message.liveCodeHighlights}
                  renderSnapshot={message.renderSnapshot}
                />
              </View>
            ) : null}

            {visibleParts.map(part =>
              part.type === "thinking" ? (
                <PanelCard key={part.id} className="mt-3 rounded-[24px] border-moss/20 bg-moss/10 px-4 py-4">
                  <View className="flex-row items-center gap-2">
                    <Brain color="#79936C" size={14} />
                    <Text className="text-xs font-bold uppercase tracking-[1.4px] text-moss">Thinking</Text>
                  </View>
                  <View className="mt-3">
                    <MarkdownMessage content={part.text} />
                  </View>
                </PanelCard>
              ) : (
                <ToolCallCard
                  key={part.id}
                  expanded={Boolean(expandedToolCallIds[part.id])}
                  onToggle={() => onToggleToolCall(part.id)}
                  part={part}
                />
              ),
            )}

            {pendingMeta?.status === "pending" ? (
              <View className="mt-3 flex-row items-center gap-2">
                <LoaderCircle color="#8D8A84" size={14} />
                <Text className="text-xs uppercase tracking-[1.4px] text-haze">Responding…</Text>
              </View>
            ) : null}

            {pendingMeta?.status === "failed" ? (
              <View className="mt-4 rounded-[22px] border border-ember/25 bg-ember/10 px-4 py-4">
                <View className="flex-row items-center gap-2">
                  <AlertTriangle color="#FF8C5A" size={14} />
                  <Text className="text-xs font-bold uppercase tracking-[1.4px] text-emberSoft">Send failed</Text>
                </View>
                {pendingMeta.errorMessage ? (
                  <Text className="mt-2 text-sm leading-6 text-brass">{pendingMeta.errorMessage}</Text>
                ) : null}
                <Pressable
                  onPress={() => onRetryRequest(pendingMeta.requestId, pendingMeta.retryContent)}
                  className="mt-3 self-start rounded-full border border-bone/10 bg-bone/5 px-4 py-2.5"
                >
                  <View className="flex-row items-center gap-2">
                    <RefreshCcw color="#F6EFE4" size={14} />
                    <Text className="text-xs font-bold uppercase tracking-[1.4px] text-bone">Retry</Text>
                  </View>
                </Pressable>
              </View>
            ) : null}
          </PanelCard>
        );
      })}
    </View>
  );
});

function SessionTimelineEmptyState({ loading }: { loading: boolean }) {
  if (loading) {
    return <Text className="px-1 text-sm text-haze">Loading messages...</Text>;
  }

  return (
    <PanelCard className="rounded-[28px] border-bone/10 bg-bone/5">
      <Text className="text-lg font-semibold text-bone">No messages yet</Text>
      <Text className="mt-2 text-sm leading-6 text-brass">Send the first message to start the conversation on this session.</Text>
    </PanelCard>
  );
}

function SessionTimelineHeader({
  hasMessages,
  hasOlder,
  loadingOlder,
}: {
  hasMessages: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
}) {
  if (!hasMessages) return null;

  return (
    <View className="pb-5">
      {loadingOlder ? (
        <View className="items-center">
          <Text className="text-[11px] font-bold uppercase tracking-[1.6px] text-haze">Loading older messages…</Text>
        </View>
      ) : null}
      {!loadingOlder && !hasOlder ? (
        <View className="items-center">
          <Text className="text-[11px] font-bold uppercase tracking-[1.6px] text-haze">Start of conversation</Text>
        </View>
      ) : null}
    </View>
  );
}

export function SessionTimeline({
  hasOlder,
  loading,
  loadingOlder,
  messages,
  onLoadOlder,
  onRetryRequest,
  sessionId,
  showThinkingDetails,
  showToolCallDetails,
}: {
  hasOlder: boolean;
  loading: boolean;
  loadingOlder: boolean;
  messages: LocalChatMessage[];
  onLoadOlder: () => void;
  onRetryRequest: (requestId: string, content: string) => void;
  sessionId: string;
  showThinkingDetails: boolean;
  showToolCallDetails: boolean;
}) {
  const turns = useMemo(() => buildTurns(messages), [messages]);
  const [expandedToolCallIds, setExpandedToolCallIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setExpandedToolCallIds({});
  }, [sessionId]);

  function handleToggleToolCall(partId: string) {
    setExpandedToolCallIds(current => ({
      ...current,
      [partId]: !current[partId],
    }));
  }

  return (
    <KeyboardAvoidingLegendList
      alignItemsAtEnd
      contentContainerStyle={{ paddingBottom: 20, paddingTop: 20 }}
      data={turns}
      drawDistance={DRAW_DISTANCE}
      estimatedItemSize={ESTIMATED_ITEM_SIZE}
      initialScrollIndex={turns.length > 0 ? turns.length - 1 : undefined}
      keyExtractor={turn => turn.id}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      ListEmptyComponent={<SessionTimelineEmptyState loading={loading} />}
      ListHeaderComponent={<SessionTimelineHeader hasMessages={messages.length > 0} hasOlder={hasOlder} loadingOlder={loadingOlder} />}
      maintainScrollAtEnd
      maintainScrollAtEndThreshold={0.1}
      maintainVisibleContentPosition
      onStartReached={() => {
        if (!hasOlder || loadingOlder) return;
        onLoadOlder();
      }}
      onStartReachedThreshold={0.2}
      recycleItems={false}
      renderItem={({ item }) => (
        <SessionTimelineTurnRow
          expandedToolCallIds={expandedToolCallIds}
          onRetryRequest={onRetryRequest}
          onToggleToolCall={handleToggleToolCall}
          showThinkingDetails={showThinkingDetails}
          showToolCallDetails={showToolCallDetails}
          turn={item}
        />
      )}
      showsVerticalScrollIndicator={false}
      style={{ flex: 1 }}
      waitForInitialLayout
    />
  );
}

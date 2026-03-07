import { Redirect, useLocalSearchParams } from "expo-router";
import type { ModelOption } from "@agent-mockingbird/contracts/dashboard";
import { ArrowLeft, Brain, ChevronDown, SendHorizontal, Wrench } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ModelPickerOverlay } from "@/features/chat/model-picker-overlay";
import { PermissionPromptOverlay, QuestionPromptOverlay } from "@/features/chat/prompt-overlay";
import { SessionTimeline } from "@/features/chat/session-timeline";
import { useMobileChat } from "@/features/chat/provider";
import { useBootstrapStore } from "@/lib/bootstrap";
import { chromePalette } from "@/theme/palette";
import { router } from "expo-router";

export default function SessionDetailScreen() {
  const store = useBootstrapStore();
  const chat = useMobileChat();
  const params = useLocalSearchParams<{ sessionId: string }>();
  const [draftMessage, setDraftMessage] = useState("");
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const scrollRef = useRef<ScrollView>(null);
  const hasInitialBottomScrollRef = useRef(false);
  const shouldFollowLatestRef = useRef(true);
  const insets = useSafeAreaInsets();
  const sessionId = typeof params.sessionId === "string" ? params.sessionId : "";
  const session = chat.sessions.find(entry => entry.id === sessionId);
  const messages = chat.messagesBySession[sessionId] ?? [];
  const loadingMessages = chat.loadingMessagesBySession[sessionId] ?? false;
  const sending = chat.sendingBySession[sessionId] ?? false;
  const activeQuestionRequest = chat.pendingQuestionsBySession[sessionId]?.[0];
  const activePermissionRequest = chat.pendingPermissionsBySession[sessionId]?.[0];
  const promptBusy = chat.promptBusyRequestId === activeQuestionRequest?.id || chat.promptBusyRequestId === activePermissionRequest?.id;

  useEffect(() => {
    if (!sessionId) return;
    chat.setActiveSessionId(sessionId);
    void chat.ensureSessionLoaded(sessionId);
  }, [sessionId]);

  useEffect(() => {
    hasInitialBottomScrollRef.current = false;
    shouldFollowLatestRef.current = true;
  }, [sessionId]);

  useEffect(() => {
    if (messages.length === 0) return;
    if (!hasInitialBottomScrollRef.current) {
      hasInitialBottomScrollRef.current = true;
      requestAnimationFrame(() => {
        scrollRef.current?.scrollToEnd({ animated: false });
      });
      return;
    }
    if (!shouldFollowLatestRef.current) return;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  }, [messages.length, activeQuestionRequest?.id, activePermissionRequest?.id]);

  if (store.hydrated && !store.apiBaseUrl.trim()) {
    return <Redirect href="/onboarding" />;
  }

  if (!sessionId) {
    return <Redirect href="/(tabs)" />;
  }

  const runError = chat.runErrorsBySession[sessionId] ?? "";
  const runStatus = chat.runStatusBySession[sessionId];
  const hasRecentServerActivity =
    chat.lastServerActivityAt > 0 && Date.now() - chat.lastServerActivityAt < 30_000;
  const connectionPill =
    chat.connectionState === "connected" || hasRecentServerActivity
      ? "live"
      : chat.connectionState === "connecting"
        ? "connecting"
        : chat.connectionState === "reconnecting"
          ? "reconnecting"
          : chat.connectionState === "resyncing"
          ? "resyncing"
        : "offline";

  const availableModels = useMemo(() => {
    const byId = new Map(chat.modelOptions.map(option => [option.id, option]));
    if (session?.model && !byId.has(session.model)) {
      const [providerId, ...rest] = session.model.split("/");
      byId.set(session.model, {
        id: session.model,
        label: `${session.model} (current)`,
        providerId: providerId || "custom",
        modelId: rest.join("/") || session.model,
      } satisfies ModelOption);
    }
    return [...byId.values()];
  }, [chat.modelOptions, session?.model]);

  const filteredModelOptions = useMemo(() => {
    const query = modelQuery.trim().toLowerCase();
    if (!query) return availableModels;
    return availableModels.filter(option => {
      const haystack = `${option.label} ${option.id} ${option.providerId} ${option.modelId}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [availableModels, modelQuery]);

  const selectedModelLabel = useMemo(() => {
    if (!session?.model) return "Select model";
    return availableModels.find(option => option.id === session.model)?.label ?? session.model;
  }, [availableModels, session?.model]);

  const toggleButtons = useMemo(
    () => [
      {
        key: "thinking",
        active: chat.showThinkingDetails,
        label: "Thinking",
        onPress: () => chat.setShowThinkingDetails(!chat.showThinkingDetails),
        icon: Brain,
      },
      {
        key: "tools",
        active: chat.showToolCallDetails,
        label: "Tools",
        onPress: () => chat.setShowToolCallDetails(!chat.showToolCallDetails),
        icon: Wrench,
      },
    ],
    [chat],
  );

  function handleTimelineScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    shouldFollowLatestRef.current = distanceFromBottom < 140;
  }

  useEffect(() => {
    setIsModelPickerOpen(false);
    setModelQuery("");
  }, [sessionId]);

  return (
    <>
      <KeyboardAvoidingView
        className="flex-1 bg-ink"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <View className="border-b border-bone/10 px-5 pb-5 pt-16">
          <View className="mb-4 flex-row items-center justify-between gap-3">
            <Pressable
              onPress={() => {
                router.back();
              }}
              className="size-12 items-center justify-center rounded-full border border-bone/10 bg-bone/5"
            >
              <ArrowLeft color="#F6EFE4" size={18} />
            </Pressable>

            <View className="flex-1">
              <Text className="text-[11px] font-bold uppercase tracking-[1.8px] text-haze">Session detail</Text>
              <Text className="mt-1 text-2xl font-semibold text-bone">{session?.title ?? "Loading session"}</Text>
            </View>

            <View className="rounded-full border border-ocean/20 bg-ocean/10 px-3 py-2">
              <Text className="text-[11px] font-bold uppercase tracking-[1.8px] text-ocean">{connectionPill}</Text>
            </View>
          </View>

          <View className="flex-row flex-wrap gap-2">
            <View className="rounded-full border border-ember/30 bg-ember/10 px-3 py-1.5">
              <Text className="text-[11px] font-bold uppercase tracking-[1.8px] text-emberSoft">
                {session?.status ?? "idle"}
              </Text>
            </View>
            <Pressable
              onPress={() => setIsModelPickerOpen(true)}
              className="rounded-full border border-bone/10 bg-bone/5 px-3 py-1.5"
            >
              <View className="flex-row items-center gap-2">
                <Text className="max-w-[180px] text-[11px] uppercase tracking-[1.8px] text-haze" numberOfLines={1}>
                  {selectedModelLabel}
                </Text>
                <ChevronDown color={chromePalette.haze} size={14} />
              </View>
            </Pressable>
            {toggleButtons.map(toggle => {
              const Icon = toggle.icon;
              return (
                <Pressable
                  key={toggle.key}
                  onPress={toggle.onPress}
                  className={`rounded-full border px-3 py-1.5 ${toggle.active ? "border-moss/30 bg-moss/10" : "border-bone/10 bg-bone/5"}`}
                >
                  <View className="flex-row items-center gap-2">
                    <Icon color={toggle.active ? chromePalette.moss : chromePalette.haze} size={14} />
                    <Text className={`text-[11px] font-bold uppercase tracking-[1.4px] ${toggle.active ? "text-moss" : "text-haze"}`}>
                      {toggle.label}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {runStatus?.status === "busy" ? (
            <Text className="mt-4 text-sm leading-6 text-brass">The assistant is still working on this session.</Text>
          ) : null}
          {chat.modelError ? <Text className="mt-4 text-sm leading-6 text-emberSoft">{chat.modelError}</Text> : null}
          {runError ? <Text className="mt-4 text-sm leading-6 text-emberSoft">{runError}</Text> : null}
        </View>

        <ScrollView
          ref={scrollRef}
          className="flex-1 px-5 pt-5"
          contentContainerStyle={{ paddingBottom: 20 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={handleTimelineScroll}
          onContentSizeChange={() => {
            if (!hasInitialBottomScrollRef.current || shouldFollowLatestRef.current) {
              scrollRef.current?.scrollToEnd({ animated: hasInitialBottomScrollRef.current });
            }
          }}
        >
          <SessionTimeline
            loading={loadingMessages}
            messages={messages}
            onRetryRequest={(requestId, content) => {
              void chat.retryMessage(sessionId, requestId, content);
            }}
            showThinkingDetails={chat.showThinkingDetails}
            showToolCallDetails={chat.showToolCallDetails}
          />
        </ScrollView>

        <View className="border-t border-bone/10 bg-ash/95 px-5 pt-4" style={{ paddingBottom: insets.bottom + 8 }}>
          <View className="flex-row items-end gap-3 rounded-[28px] border border-bone/10 bg-bone/5 px-4 py-3">
            <TextInput
              value={draftMessage}
              onChangeText={setDraftMessage}
              editable={!sending && !promptBusy && !activeQuestionRequest && !activePermissionRequest}
              multiline
              placeholder="Send a message to this session…"
              placeholderTextColor="#8D8A84"
              className="max-h-32 min-h-[48px] flex-1 py-2 text-sm leading-6 text-bone"
            />
            <Pressable
              onPress={() => {
                const content = draftMessage.trim();
                if (!content) return;
                setDraftMessage("");
                void chat.sendMessage(sessionId, content);
              }}
              disabled={!draftMessage.trim() || sending || promptBusy || Boolean(activeQuestionRequest) || Boolean(activePermissionRequest)}
              className={`mb-1 size-11 items-center justify-center rounded-full ${!draftMessage.trim() || sending || promptBusy || activeQuestionRequest || activePermissionRequest ? "bg-bone/10" : "bg-ember"}`}
            >
              <SendHorizontal color={!draftMessage.trim() || sending || promptBusy || activeQuestionRequest || activePermissionRequest ? "#8D8A84" : "#13100F"} size={18} />
            </Pressable>
          </View>
        </View>

        {activePermissionRequest ? (
          <PermissionPromptOverlay
            busy={promptBusy}
            error={chat.promptError}
            request={activePermissionRequest}
            onReply={reply => chat.replyPermissionPrompt(activePermissionRequest.id, reply, sessionId)}
          />
        ) : null}

        {activeQuestionRequest ? (
          <QuestionPromptOverlay
            busy={promptBusy}
            error={chat.promptError}
            request={activeQuestionRequest}
            onDismiss={() => chat.rejectQuestionPrompt(activeQuestionRequest.id, sessionId)}
            onReply={answers => chat.replyQuestionPrompt(activeQuestionRequest.id, answers, sessionId)}
          />
        ) : null}

        {isModelPickerOpen ? (
          <ModelPickerOverlay
            error={chat.modelError}
            loading={chat.loadingModels}
            onClose={() => {
              setIsModelPickerOpen(false);
              setModelQuery("");
            }}
            onQueryChange={setModelQuery}
            onSelect={modelId => {
              setModelQuery("");
              setIsModelPickerOpen(false);
              void chat.updateSessionModel(sessionId, modelId);
            }}
            options={filteredModelOptions}
            query={modelQuery}
            saving={chat.savingModel}
            selectedModelId={session?.model ?? ""}
          />
        ) : null}
      </KeyboardAvoidingView>
    </>
  );
}

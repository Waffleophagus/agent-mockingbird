import { router } from "expo-router";
import { ChevronRight, Plus, Radio } from "lucide-react-native";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { PanelCard } from "@/components/panel-card";
import { ScreenFrame } from "@/components/screen-frame";
import { relativeFromIso } from "@/features/chat/chat-helpers";
import { useMobileChat } from "@/features/chat/provider";
import { useBootstrapStore } from "@/lib/bootstrap";

export default function ChatsTab() {
  const store = useBootstrapStore();
  const chat = useMobileChat();
  const connectionLabel =
    chat.connectionState === "connected"
      ? "socket connected"
      : chat.connectionState === "connecting"
        ? "connecting socket"
        : chat.connectionState === "reconnecting"
          ? "reconnecting socket"
          : chat.connectionState === "resyncing"
            ? "resyncing state"
        : chat.connectionState === "offline"
          ? "socket offline"
          : store.connectionStatus === "online"
            ? "backend online"
            : store.connectionStatus === "checking"
              ? "checking backend"
              : store.connectionStatus === "offline"
                ? "backend offline"
                : "backend idle";

  const activePromptCount =
    Object.values(chat.pendingPermissionsBySession).reduce((sum, items) => sum + items.length, 0) +
    Object.values(chat.pendingQuestionsBySession).reduce((sum, items) => sum + items.length, 0);

  return (
    <ScreenFrame
      eyebrow="Operations Deck"
      title="Chats"
      subtitle="The mobile client now reads live sessions and drops directly into the same conversation loop as the web app."
      accentLabel={connectionLabel}
    >
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
        <PanelCard className="mb-4 overflow-hidden">
          <View className="absolute inset-0 bg-ember/10" />
          <View className="flex-row items-center justify-between gap-3">
            <Text className="text-xs font-semibold uppercase tracking-[2px] text-emberSoft">Live stack</Text>
            <Pressable
              onPress={() => {
                void chat.createSession().then(session => {
                  if (!session) return;
                  router.push({ pathname: "/session/[sessionId]", params: { sessionId: session.id } });
                });
              }}
              className="rounded-full border border-bone/10 bg-bone/5 px-3 py-2"
            >
              <View className="flex-row items-center gap-2">
                <Plus color="#F6EFE4" size={14} />
                <Text className="text-[11px] font-bold uppercase tracking-[1.6px] text-bone">New</Text>
              </View>
            </Pressable>
          </View>
          <View className="mt-4 flex-row gap-3">
            <View className="min-w-[102px] flex-1 rounded-[24px] border border-bone/10 bg-bone/5 p-4">
              <Text className="text-[11px] uppercase tracking-[1.8px] text-haze">Sessions</Text>
              <Text className="mt-2 text-2xl font-semibold text-bone">{chat.sessions.length}</Text>
              <Text className="mt-2 text-xs leading-5 text-brass">Live sessions from the configured backend.</Text>
            </View>
            <View className="min-w-[102px] flex-1 rounded-[24px] border border-bone/10 bg-bone/5 p-4">
              <Text className="text-[11px] uppercase tracking-[1.8px] text-haze">Prompts</Text>
              <Text className="mt-2 text-2xl font-semibold text-bone">{activePromptCount}</Text>
              <Text className="mt-2 text-xs leading-5 text-brass">Questions and permissions waiting on user input.</Text>
            </View>
            <View className="min-w-[102px] flex-1 rounded-[24px] border border-bone/10 bg-bone/5 p-4">
              <Text className="text-[11px] uppercase tracking-[1.8px] text-haze">Socket</Text>
              <Text className="mt-2 text-2xl font-semibold text-bone">
                {chat.connectionState === "connected" ? "Live" : chat.connectionState === "resyncing" ? "Sync" : "Idle"}
              </Text>
              <Text className="mt-2 text-xs leading-5 text-brass">Realtime mobile updates from the WebSocket transport.</Text>
            </View>
          </View>
        </PanelCard>

        <PanelCard className="mb-4">
          <Text className="text-xs font-semibold uppercase tracking-[2px] text-haze">Configured backend</Text>
          <Text className="mt-3 text-base font-semibold text-bone">{store.apiBaseUrl || "Not configured"}</Text>
          <Text className="mt-2 text-sm leading-6 text-brass">
            {store.connectionMessage ?? "Save a backend URL in onboarding or settings to connect this shell to a real server."}
          </Text>
        </PanelCard>

        <View className="mb-3 flex-row items-center justify-between">
          <Text className="text-xs font-semibold uppercase tracking-[2px] text-haze">Sessions</Text>
          <View className="flex-row items-center gap-2 rounded-full border border-moss/30 bg-moss/10 px-3 py-1.5">
            <Radio size={12} color="#79936C" />
            <Text className="text-[11px] font-semibold uppercase tracking-[1.6px] text-moss">{connectionLabel}</Text>
          </View>
        </View>

        {chat.loadingBootstrap ? (
          <PanelCard className="items-center rounded-[28px] py-8">
            <ActivityIndicator color="#F25C2A" />
            <Text className="mt-3 text-sm leading-6 text-brass">Loading sessions from the backend…</Text>
          </PanelCard>
        ) : null}

        {!chat.loadingBootstrap && chat.sessions.length === 0 ? (
          <PanelCard className="rounded-[28px] border-ocean/20 bg-ocean/10">
            <Text className="text-lg font-semibold text-bone">No sessions yet</Text>
            <Text className="mt-2 text-sm leading-6 text-brass">
              Create a new session here, then drop into the conversation screen to start chatting.
            </Text>
          </PanelCard>
        ) : null}

        {chat.sessions.map(session => {
          const questionCount = chat.pendingQuestionsBySession[session.id]?.length ?? 0;
          const permissionCount = chat.pendingPermissionsBySession[session.id]?.length ?? 0;

          return (
            <Pressable
              key={session.id}
              onPress={() => {
                chat.setActiveSessionId(session.id);
                router.push({ pathname: "/session/[sessionId]", params: { sessionId: session.id } });
              }}
            >
              <PanelCard className="mb-3">
                <View className="flex-row items-start justify-between gap-4">
                  <View className="flex-1">
                    <View className="mb-2 flex-row flex-wrap items-center gap-2">
                      <View className="rounded-full border border-ember/30 bg-ember/10 px-2.5 py-1">
                        <Text className="text-[10px] font-bold uppercase tracking-[1.8px] text-emberSoft">
                          {session.status}
                        </Text>
                      </View>
                      <Text className="text-[11px] uppercase tracking-[1.8px] text-haze">{session.model}</Text>
                    </View>
                    <Text className="text-xl font-semibold text-bone">{session.title}</Text>
                    <Text className="mt-2 text-sm leading-6 text-brass">
                      {questionCount + permissionCount > 0
                        ? `${questionCount} question${questionCount === 1 ? "" : "s"} and ${permissionCount} permission${permissionCount === 1 ? "" : "s"} waiting.`
                        : "Open the session to continue the conversation or send a new message."}
                    </Text>
                    <View className="mt-4 flex-row items-center gap-4">
                      <Text className="text-[11px] uppercase tracking-[1.6px] text-haze">{relativeFromIso(session.lastActiveAt)}</Text>
                      <Text className="text-[11px] uppercase tracking-[1.6px] text-haze">{session.messageCount} msgs</Text>
                    </View>
                  </View>
                  <ChevronRight color="#F6EFE4" size={20} />
                </View>
              </PanelCard>
            </Pressable>
          );
        })}
      </ScrollView>
    </ScreenFrame>
  );
}

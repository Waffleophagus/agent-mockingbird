import { Stack, useLocalSearchParams } from "expo-router";
import { ArrowUpRight, Bot, ChevronLeft, FolderTree, Layers3, SendHorizontal } from "lucide-react-native";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { PanelCard } from "@/components/panel-card";
import { signalSessions, transcriptBySessionId } from "@/data/mock";

export default function SessionDetailScreen() {
  const params = useLocalSearchParams<{ sessionId: string }>();
  const session = signalSessions.find(entry => entry.id === params.sessionId) ?? signalSessions[0];
  const transcript = transcriptBySessionId[session.id] ?? [];

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: false,
        }}
      />
      <View className="flex-1 bg-ink">
        <View className="border-b border-bone/10 px-5 pb-5 pt-16">
          <View className="mb-4 flex-row items-center justify-between">
            <View className="rounded-full border border-bone/10 bg-bone/5 px-3 py-1.5">
              <Text className="text-[11px] font-bold uppercase tracking-[1.8px] text-brass">Session detail</Text>
            </View>
            <View className="rounded-full border border-ocean/20 bg-ocean/10 px-3 py-1.5">
              <Text className="text-[11px] font-bold uppercase tracking-[1.8px] text-ocean">deep link ready</Text>
            </View>
          </View>
          <Text className="text-3xl font-semibold text-bone">{session.title}</Text>
          <Text className="mt-2 text-sm leading-6 text-brass">{session.preview}</Text>
          <View className="mt-4 flex-row gap-3">
            <View className="rounded-full border border-ember/30 bg-ember/10 px-3 py-1.5">
              <Text className="text-[11px] font-bold uppercase tracking-[1.8px] text-emberSoft">{session.status}</Text>
            </View>
            <View className="rounded-full border border-bone/10 bg-bone/5 px-3 py-1.5">
              <Text className="text-[11px] uppercase tracking-[1.8px] text-haze">{session.model}</Text>
            </View>
          </View>
        </View>

        <ScrollView className="flex-1 px-5 pt-5" contentContainerStyle={{ paddingBottom: 164 }} showsVerticalScrollIndicator={false}>
          <PanelCard className="mb-4 border-moss/20 bg-moss/10">
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-3">
                <Bot color="#79936C" size={18} />
                <Text className="text-sm font-semibold text-bone">Shared-state seam</Text>
              </View>
              <ArrowUpRight color="#79936C" size={16} />
            </View>
            <Text className="mt-2 text-sm leading-6 text-brass">
              This route is ready to hydrate from the future MST store and typed websocket channel. It is intentionally using local mock transcript data today.
            </Text>
          </PanelCard>

          {transcript.map(message => (
            <View
              key={message.id}
              className={`mb-3 rounded-[28px] px-4 py-4 ${message.role === "assistant" ? "bg-bone/7 border border-bone/10" : "border border-ember/20 bg-ember/10"}`}
            >
              <Text className="mb-2 text-[11px] font-bold uppercase tracking-[1.8px] text-haze">{message.role}</Text>
              <Text className="text-[15px] leading-7 text-bone">{message.content}</Text>
            </View>
          ))}

          <View className="mb-4 flex-row gap-3">
            <PanelCard className="flex-1">
              <View className="flex-row items-center gap-2">
                <FolderTree color="#D7B98D" size={16} />
                <Text className="text-sm font-semibold text-bone">Sessions</Text>
              </View>
              <Text className="mt-2 text-sm leading-6 text-brass">Use a sheet here for the tree once shared session state lands.</Text>
            </PanelCard>
            <PanelCard className="flex-1">
              <View className="flex-row items-center gap-2">
                <Layers3 color="#7AC7D9" size={16} />
                <Text className="text-sm font-semibold text-bone">Context</Text>
              </View>
              <Text className="mt-2 text-sm leading-6 text-brass">Background runs and prompt queue can dock here on phones.</Text>
            </PanelCard>
          </View>
        </ScrollView>

        <View className="absolute bottom-0 left-0 right-0 border-t border-bone/10 bg-ash/95 px-5 pb-8 pt-4">
          <View className="flex-row items-center gap-3 rounded-[28px] border border-bone/10 bg-bone/5 px-4 py-3">
            <ChevronLeft color="#8D8A84" size={18} />
            <TextInput
              editable={false}
              value="Composer scaffold. Wire to tRPC chat.send + optimistic MST actions."
              className="flex-1 text-sm leading-6 text-brass"
            />
            <Pressable className="size-12 items-center justify-center rounded-full bg-ember">
              <SendHorizontal color="#13100F" size={18} />
            </Pressable>
          </View>
        </View>
      </View>
    </>
  );
}

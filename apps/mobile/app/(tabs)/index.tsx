import { Link } from "expo-router";
import { ChevronRight, Radio, Sparkles } from "lucide-react-native";
import { ScrollView, Text, View } from "react-native";

import { PanelCard } from "@/components/panel-card";
import { ScreenFrame } from "@/components/screen-frame";
import { signalSessions, summaryStats } from "@/data/mock";

export default function ChatsTab() {
  return (
    <ScreenFrame
      eyebrow="Operations Deck"
      title="Chats"
      subtitle="The mobile shell keeps the desktop rhythm, but compresses it into a field console built for one hand."
      accentLabel="Runtime online"
    >
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
        <PanelCard className="mb-4 overflow-hidden">
          <View className="absolute inset-0 bg-ember/10" />
          <Text className="text-xs font-semibold uppercase tracking-[2px] text-emberSoft">Live stack</Text>
          <View className="mt-4 flex-row gap-3">
            {summaryStats.map(stat => (
              <View key={stat.label} className="min-w-[102px] flex-1 rounded-[24px] border border-bone/10 bg-bone/5 p-4">
                <Text className="text-[11px] uppercase tracking-[1.8px] text-haze">{stat.label}</Text>
                <Text className="mt-2 text-2xl font-semibold text-bone">{stat.value}</Text>
                <Text className="mt-2 text-xs leading-5 text-brass">{stat.hint}</Text>
              </View>
            ))}
          </View>
        </PanelCard>

        <View className="mb-3 flex-row items-center justify-between">
          <Text className="text-xs font-semibold uppercase tracking-[2px] text-haze">Sessions</Text>
          <View className="flex-row items-center gap-2 rounded-full border border-moss/30 bg-moss/10 px-3 py-1.5">
            <Radio size={12} color="#79936C" />
            <Text className="text-[11px] font-semibold uppercase tracking-[1.6px] text-moss">SSE placeholder</Text>
          </View>
        </View>

        {signalSessions.map(session => (
          <Link key={session.id} href={{ pathname: "/session/[sessionId]", params: { sessionId: session.id } }} asChild>
            <View>
              <PanelCard className="mb-3">
                <View className="flex-row items-start justify-between gap-4">
                  <View className="flex-1">
                    <View className="mb-2 flex-row items-center gap-2">
                      <View className="rounded-full border border-ember/30 bg-ember/10 px-2.5 py-1">
                        <Text className="text-[10px] font-bold uppercase tracking-[1.8px] text-emberSoft">
                          {session.status}
                        </Text>
                      </View>
                      <Text className="text-[11px] uppercase tracking-[1.8px] text-haze">{session.model}</Text>
                    </View>
                    <Text className="text-xl font-semibold text-bone">{session.title}</Text>
                    <Text className="mt-2 text-sm leading-6 text-brass">{session.preview}</Text>
                    <View className="mt-4 flex-row items-center gap-4">
                      <Text className="text-[11px] uppercase tracking-[1.6px] text-haze">{session.lastActive}</Text>
                      <Text className="text-[11px] uppercase tracking-[1.6px] text-haze">{session.messageCount} msgs</Text>
                    </View>
                  </View>
                  <ChevronRight color="#F6EFE4" size={20} />
                </View>
              </PanelCard>
            </View>
          </Link>
        ))}

        <PanelCard className="border-ocean/20 bg-ocean/10">
          <View className="flex-row items-center gap-3">
            <Sparkles color="#7AC7D9" size={18} />
            <View className="flex-1">
              <Text className="text-sm font-semibold text-bone">Shared-store seam left visible</Text>
              <Text className="mt-1 text-sm leading-6 text-brass">
                Replace the mock session feed with the shared MST + tRPC client when the monorepo packages land.
              </Text>
            </View>
          </View>
        </PanelCard>
      </ScrollView>
    </ScreenFrame>
  );
}

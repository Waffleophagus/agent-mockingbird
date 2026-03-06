import { Bot, Clock3, Waves } from "lucide-react-native";
import { ScrollView, Text, View } from "react-native";

import { PanelCard } from "@/components/panel-card";
import { ScreenFrame } from "@/components/screen-frame";
import { backgroundRuns, activityBursts } from "@/data/mock";

export default function ActivityTab() {
  return (
    <ScreenFrame
      eyebrow="Runtime Pulse"
      title="Activity"
      subtitle="Background runs, queue pressure, and heartbeat signals stay visible without flooding the main chat surface."
      accentLabel="3 active runs"
    >
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
        <PanelCard className="mb-4">
          <View className="flex-row gap-3">
            {activityBursts.map(item => (
              <View key={item.label} className="flex-1 rounded-[24px] border border-bone/10 bg-bone/5 p-4">
                <Text className="text-[11px] uppercase tracking-[1.8px] text-haze">{item.label}</Text>
                <Text className="mt-2 text-2xl font-semibold text-bone">{item.value}</Text>
                <Text className="mt-2 text-xs leading-5 text-brass">{item.detail}</Text>
              </View>
            ))}
          </View>
        </PanelCard>

        {backgroundRuns.map(run => (
          <PanelCard key={run.id} className="mb-3">
            <View className="flex-row items-start justify-between gap-4">
              <View className="flex-1">
                <View className="mb-2 flex-row items-center gap-2">
                  <Clock3 color="#D7B98D" size={16} />
                  <Text className="text-[11px] uppercase tracking-[1.8px] text-haze">{run.updatedAt}</Text>
                </View>
                <Text className="text-lg font-semibold text-bone">{run.title}</Text>
                <Text className="mt-2 text-sm leading-6 text-brass">{run.summary}</Text>
              </View>
              <View className="rounded-full border border-ocean/30 bg-ocean/10 px-3 py-1.5">
                <Text className="text-[10px] font-bold uppercase tracking-[1.8px] text-ocean">{run.status}</Text>
              </View>
            </View>
          </PanelCard>
        ))}

        <PanelCard className="border-moss/20 bg-moss/10">
          <View className="flex-row items-center gap-3">
            <Bot color="#79936C" size={18} />
            <View className="flex-1">
              <Text className="text-sm font-semibold text-bone">Realtime transport seam</Text>
              <Text className="mt-1 text-sm leading-6 text-brass">
                Swap the mocked pulse cards for the typed websocket event stream once the shared transport package exists.
              </Text>
            </View>
            <Waves color="#79936C" size={18} />
          </View>
        </PanelCard>
      </ScrollView>
    </ScreenFrame>
  );
}

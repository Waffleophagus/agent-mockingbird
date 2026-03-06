import { AlertTriangle, ArrowRight, ShieldAlert } from "lucide-react-native";
import { ScrollView, Text, View } from "react-native";

import { PanelCard } from "@/components/panel-card";
import { ScreenFrame } from "@/components/screen-frame";
import { pendingInboxItems } from "@/data/mock";

export default function InboxTab() {
  return (
    <ScreenFrame
      eyebrow="Prompt Queue"
      title="Inbox"
      subtitle="Permission checks and question prompts stack here so the agent can keep moving when you step back in."
      accentLabel={`${pendingInboxItems.length} waiting`}
    >
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
        {pendingInboxItems.map(item => (
          <PanelCard key={item.id} className="mb-3">
            <View className="mb-3 flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                {item.kind === "permission" ? <ShieldAlert color="#F25C2A" size={18} /> : <AlertTriangle color="#D7B98D" size={18} />}
                <Text className="text-[11px] font-bold uppercase tracking-[1.8px] text-haze">{item.kind}</Text>
              </View>
              <Text className="text-[11px] uppercase tracking-[1.8px] text-haze">{item.sessionTitle}</Text>
            </View>
            <Text className="text-lg font-semibold text-bone">{item.title}</Text>
            <Text className="mt-2 text-sm leading-6 text-brass">{item.body}</Text>
            <View className="mt-4 flex-row items-center justify-between rounded-[22px] border border-bone/10 bg-bone/5 px-4 py-3">
              <Text className="text-xs uppercase tracking-[1.8px] text-bone">Open in-app to respond</Text>
              <ArrowRight color="#F6EFE4" size={16} />
            </View>
          </PanelCard>
        ))}
      </ScrollView>
    </ScreenFrame>
  );
}

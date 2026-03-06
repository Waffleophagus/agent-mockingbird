import { Bell, Link2, ShieldCheck, Smartphone } from "lucide-react-native";
import { ScrollView, Switch, Text, TextInput, View } from "react-native";

import { PanelCard } from "@/components/panel-card";
import { ScreenFrame } from "@/components/screen-frame";
import { useBootstrapStore } from "@/lib/bootstrap";

export default function SettingsTab() {
  const { apiBaseUrl, notificationsEnabled, setApiBaseUrl, setNotificationsEnabled } = useBootstrapStore();

  return (
    <ScreenFrame
      eyebrow="Local Device"
      title="Settings"
      subtitle="This v1 client assumes a trusted local stack, so the first settings surface is about connectivity and push readiness."
      accentLabel="trusted mode"
    >
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
        <PanelCard className="mb-3">
          <View className="mb-4 flex-row items-center gap-3">
            <Link2 color="#F25C2A" size={18} />
            <Text className="text-lg font-semibold text-bone">Server channel</Text>
          </View>
          <Text className="mb-3 text-sm leading-6 text-brass">
            Point the mobile client at your Bun server or tunnel URL. This is stored locally until a shared settings package exists.
          </Text>
          <TextInput
            value={apiBaseUrl}
            onChangeText={setApiBaseUrl}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="http://192.168.1.20:3001"
            placeholderTextColor="#8D8A84"
            className="rounded-[22px] border border-bone/10 bg-bone/5 px-4 py-4 text-base text-bone"
          />
        </PanelCard>

        <PanelCard className="mb-3">
          <View className="flex-row items-center justify-between gap-4">
            <View className="flex-1">
              <View className="mb-2 flex-row items-center gap-3">
                <Bell color="#7AC7D9" size={18} />
                <Text className="text-lg font-semibold text-bone">Push notifications</Text>
              </View>
              <Text className="text-sm leading-6 text-brass">
                Placeholder preference only. Replace with Expo token registration against the shared notifications API.
              </Text>
            </View>
            <Switch
              value={notificationsEnabled}
              onValueChange={setNotificationsEnabled}
              trackColor={{ false: "#302722", true: "#F25C2A" }}
              thumbColor="#F6EFE4"
            />
          </View>
        </PanelCard>

        <PanelCard className="mb-3">
          <View className="mb-3 flex-row items-center gap-3">
            <Smartphone color="#D7B98D" size={18} />
            <Text className="text-lg font-semibold text-bone">Build notes</Text>
          </View>
          <Text className="text-sm leading-6 text-brass">
            Use a dev build instead of Expo Go for end-to-end notification testing. The route and bootstrap scaffolding are already in place.
          </Text>
        </PanelCard>

        <PanelCard className="border-moss/20 bg-moss/10">
          <View className="flex-row items-center gap-3">
            <ShieldCheck color="#79936C" size={18} />
            <View className="flex-1">
              <Text className="text-sm font-semibold text-bone">No auth in v1</Text>
              <Text className="mt-1 text-sm leading-6 text-brass">
                This shell assumes the same trusted local-device model as the current repo plan. Add auth later without changing the route structure.
              </Text>
            </View>
          </View>
        </PanelCard>
      </ScrollView>
    </ScreenFrame>
  );
}

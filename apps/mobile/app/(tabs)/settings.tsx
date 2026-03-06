import { Bell, Link2, ShieldCheck, Smartphone, Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";

import { PanelCard } from "@/components/panel-card";
import { ScreenFrame } from "@/components/screen-frame";
import { clearBootstrapApiBaseUrl, refreshServerHealth, saveBootstrapApiBaseUrl, useBootstrapStore } from "@/lib/bootstrap";

export default function SettingsTab() {
  const store = useBootstrapStore();
  const [draftUrl, setDraftUrl] = useState(store.apiBaseUrl);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setDraftUrl(store.apiBaseUrl);
  }, [store.apiBaseUrl]);

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
            Point the mobile client at your Bun server or tunnel URL. This is stored in Expo Secure Store and reused on boot.
          </Text>
          <TextInput
            value={draftUrl}
            onChangeText={text => {
              setDraftUrl(text);
              setLocalError(null);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="http://192.168.1.20:3001"
            placeholderTextColor="#8D8A84"
            className="rounded-[22px] border border-bone/10 bg-bone/5 px-4 py-4 text-base text-bone"
          />
          {(localError || store.saveError) ? (
            <Text className="mt-3 text-sm leading-6 text-emberSoft">{localError ?? store.saveError}</Text>
          ) : null}
          <View className="mt-4 flex-row gap-3">
            <Pressable
              onPress={() => {
                setLocalError(null);
                void saveBootstrapApiBaseUrl(draftUrl).catch(error => {
                  setLocalError(error instanceof Error ? error.message : "Failed to save backend URL.");
                });
              }}
              disabled={store.saving}
              className="flex-1 items-center justify-center rounded-[22px] bg-ember px-4 py-3.5"
            >
              <Text className="text-sm font-bold uppercase tracking-[1.8px] text-ink">
                {store.saving ? "Saving..." : "Save URL"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setLocalError(null);
                void clearBootstrapApiBaseUrl().catch(error => {
                  setLocalError(error instanceof Error ? error.message : "Failed to clear backend URL.");
                });
              }}
              disabled={store.saving}
              className="items-center justify-center rounded-[22px] border border-bone/10 bg-bone/5 px-4 py-3.5"
            >
              <Trash2 color="#F6EFE4" size={18} />
            </Pressable>
          </View>
          <Pressable
            onPress={() => {
              void refreshServerHealth();
            }}
            className="mt-3 items-center rounded-[22px] border border-bone/10 bg-bone/5 px-4 py-3.5"
          >
            <Text className="text-sm font-bold uppercase tracking-[1.8px] text-bone">Check connection</Text>
          </Pressable>
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
              value={store.notificationsEnabled}
              onValueChange={store.setNotificationsEnabled}
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

        <PanelCard className="mt-3">
          <Text className="text-xs font-semibold uppercase tracking-[2px] text-haze">Current link state</Text>
          <Text className="mt-3 text-base font-semibold text-bone">{store.apiBaseUrl || "Not configured"}</Text>
          <Text className="mt-2 text-sm leading-6 text-brass">
            {store.connectionMessage ?? "Save a backend URL in onboarding or settings to connect this shell to a real server."}
          </Text>
        </PanelCard>
      </ScrollView>
    </ScreenFrame>
  );
}

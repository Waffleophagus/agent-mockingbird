import { router } from "expo-router";
import { ArrowRight, Cable, RadioTower, ShieldCheck } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { PanelCard } from "@/components/panel-card";
import { ScreenFrame } from "@/components/screen-frame";
import { saveBootstrapApiBaseUrl, useBootstrapStore } from "@/lib/bootstrap";

export default function OnboardingScreen() {
  const store = useBootstrapStore();
  const [draftUrl, setDraftUrl] = useState(store.apiBaseUrl);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setDraftUrl(store.apiBaseUrl);
  }, [store.apiBaseUrl]);

  async function handleSave() {
    setLocalError(null);

    try {
      await saveBootstrapApiBaseUrl(draftUrl);
      router.replace("/(tabs)");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Failed to save backend URL.");
    }
  }

  return (
    <ScreenFrame
      eyebrow="Field Setup"
      title="Link your backend"
      subtitle="Point this device at the Bun server you want to control. The URL is stored in Expo Secure Store and reused on every boot."
      accentLabel="secure bootstrap"
    >
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
        <PanelCard className="mb-3 overflow-hidden">
          <View className="absolute inset-0 bg-ember/10" />
          <View className="mb-4 flex-row items-center gap-3">
            <Cable color="#F25C2A" size={18} />
            <Text className="text-lg font-semibold text-bone">Backend endpoint</Text>
          </View>
          <Text className="mb-3 text-sm leading-6 text-brass">
            Use a local LAN URL, Tailscale URL, or tunnel URL that your phone can reach.
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
          <Pressable
            onPress={() => {
              void handleSave();
            }}
            disabled={store.saving}
            className="mt-4 flex-row items-center justify-center gap-2 rounded-[24px] bg-ember px-4 py-4"
          >
            {store.saving ? <ActivityIndicator color="#13100F" /> : <ArrowRight color="#13100F" size={18} />}
            <Text className="text-sm font-bold uppercase tracking-[1.8px] text-ink">Save and enter</Text>
          </Pressable>
        </PanelCard>

        <PanelCard className="mb-3">
          <View className="mb-3 flex-row items-center gap-3">
            <RadioTower color="#7AC7D9" size={18} />
            <Text className="text-lg font-semibold text-bone">What this enables</Text>
          </View>
          <Text className="text-sm leading-6 text-brass">
            On boot the app reads the saved URL, checks backend health, and uses it as the base for the shared client transport.
          </Text>
        </PanelCard>

        <PanelCard className="border-moss/20 bg-moss/10">
          <View className="flex-row items-center gap-3">
            <ShieldCheck color="#79936C" size={18} />
            <View className="flex-1">
              <Text className="text-sm font-semibold text-bone">Local-first trust model</Text>
              <Text className="mt-1 text-sm leading-6 text-brass">
                This v1 mobile shell assumes you control both the phone and the Bun server. Auth can come later without changing the onboarding shape.
              </Text>
            </View>
          </View>
        </PanelCard>
      </ScrollView>
    </ScreenFrame>
  );
}

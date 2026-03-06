import { Redirect } from "expo-router";
import { ActivityIndicator, Text, View } from "react-native";

import { useBootstrapStore } from "@/lib/bootstrap";

export default function IndexScreen() {
  const store = useBootstrapStore();

  if (!store.hydrated || store.hydrating) {
    return (
      <View className="flex-1 items-center justify-center bg-ink px-8">
        <ActivityIndicator color="#F25C2A" />
        <Text className="mt-4 text-xs font-semibold uppercase tracking-[2px] text-haze">Bootstrapping client</Text>
      </View>
    );
  }

  if (!store.apiBaseUrl.trim()) {
    return <Redirect href="/onboarding" />;
  }

  return <Redirect href="/(tabs)" />;
}

import "@/styles/global-import";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { MobileChatProvider } from "@/features/chat/provider";
import { useBootstrapScaffold } from "@/lib/bootstrap";

export default function RootLayout() {
  useBootstrapScaffold();

  return (
    <MobileChatProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: "fade_from_bottom",
          contentStyle: { backgroundColor: "#13100F" },
        }}
      />
    </MobileChatProvider>
  );
}

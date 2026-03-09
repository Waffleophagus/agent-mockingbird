import "@/styles/global-import";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { MobileChatProvider } from "@/features/chat/provider";
import { useBootstrapScaffold } from "@/lib/bootstrap";

export default function RootLayout() {
  useBootstrapScaffold();

  return (
    <MobileChatProvider>
      <KeyboardProvider navigationBarTranslucent preserveEdgeToEdge statusBarTranslucent>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            animation: "fade_from_bottom",
            contentStyle: { backgroundColor: "#13100F" },
          }}
        />
      </KeyboardProvider>
    </MobileChatProvider>
  );
}

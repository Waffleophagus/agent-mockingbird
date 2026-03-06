import { Redirect, Tabs } from "expo-router";
import { Activity, BellRing, MessageCircleMore, SlidersHorizontal } from "lucide-react-native";

import { useBootstrapStore } from "@/lib/bootstrap";
import { chromePalette } from "@/theme/palette";

export default function TabsLayout() {
  const store = useBootstrapStore();

  if (!store.hydrated || store.hydrating) {
    return null;
  }

  if (!store.apiBaseUrl.trim()) {
    return <Redirect href="/onboarding" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          height: 74,
          paddingTop: 8,
          paddingBottom: 12,
          backgroundColor: chromePalette.ash,
          borderTopWidth: 0,
        },
        tabBarActiveTintColor: chromePalette.bone,
        tabBarInactiveTintColor: chromePalette.haze,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "700",
          letterSpacing: 0.6,
          textTransform: "uppercase",
        },
        sceneStyle: {
          backgroundColor: chromePalette.ink,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Chats",
          tabBarIcon: ({ color, size }) => <MessageCircleMore color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: "Inbox",
          tabBarIcon: ({ color, size }) => <BellRing color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: "Activity",
          tabBarIcon: ({ color, size }) => <Activity color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => <SlidersHorizontal color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}

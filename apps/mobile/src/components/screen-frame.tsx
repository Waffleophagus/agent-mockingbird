import type { PropsWithChildren } from "react";
import { Text, View } from "react-native";

export function ScreenFrame({
  accentLabel,
  children,
  eyebrow,
  subtitle,
  title,
}: PropsWithChildren<{
  accentLabel: string;
  eyebrow: string;
  subtitle: string;
  title: string;
}>) {
  return (
    <View className="flex-1 bg-ink px-5 pt-16">
      <View className="mb-6">
        <View className="mb-3 flex-row items-center justify-between">
          <Text className="text-[11px] font-bold uppercase tracking-[2.2px] text-emberSoft">{eyebrow}</Text>
          <View className="rounded-full border border-bone/10 bg-bone/5 px-3 py-1.5">
            <Text className="text-[10px] font-bold uppercase tracking-[1.8px] text-brass">{accentLabel}</Text>
          </View>
        </View>
        <Text className="text-[40px] font-semibold leading-[44px] text-bone">{title}</Text>
        <Text className="mt-3 max-w-[340px] text-[15px] leading-7 text-brass">{subtitle}</Text>
      </View>
      {children}
    </View>
  );
}

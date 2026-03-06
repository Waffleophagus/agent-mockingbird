import type { PropsWithChildren } from "react";
import { View } from "react-native";

import { cn } from "@/lib/cn";

export function PanelCard({ children, className }: PropsWithChildren<{ className?: string }>) {
  return (
    <View
      className={cn(
        "rounded-[30px] border border-bone/10 bg-ash px-4 py-4 shadow-signal-card",
        className,
      )}
    >
      {children}
    </View>
  );
}

import { useCallback, useState } from "react";

import type { ChatPageModel } from "@/frontend/app/pages/ChatPage";
import { buildSessionScreenVM } from "@/frontend/opencode-react/state/adapters";
import type { SessionScreenVM } from "@/frontend/opencode-react/types";

export interface UseSessionScreenControllerInput {
  chat: ChatPageModel;
  streamStatus: "connecting" | "connected" | "reconnecting";
  heartbeatAt: string;
}

export function useSessionScreenController(input: UseSessionScreenControllerInput): SessionScreenVM {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [flyoutOpen, setFlyoutOpen] = useState(true);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen(current => !current);
  }, []);

  const toggleFlyout = useCallback(() => {
    setFlyoutOpen(current => !current);
  }, []);

  const closePanels = useCallback(() => {
    setSidebarOpen(false);
    setFlyoutOpen(false);
  }, []);

  return buildSessionScreenVM({
    chat: input.chat,
    titlebar: {
      streamStatus: input.streamStatus,
      heartbeatAt: input.heartbeatAt,
      sidebarOpen,
      flyoutOpen,
      toggleSidebar,
      toggleFlyout,
      closePanels,
    },
    layout: {
      sidebarOpen,
      flyoutOpen,
    },
  });
}

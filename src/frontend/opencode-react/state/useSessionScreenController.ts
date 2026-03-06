import { useCallback, useState } from "react";

import type { ChatPageModel } from "@/frontend/app/pages/ChatPage";
import { buildSessionScreenVM } from "@/frontend/opencode-react/state/adapters";
import type { SessionScreenMode, SessionScreenVM } from "@/frontend/opencode-react/types";

export interface UseSessionScreenControllerInput {
  activeScreen: SessionScreenMode;
  setActiveScreen: (screen: SessionScreenMode) => void;
  chat: ChatPageModel;
  streamStatus: "connecting" | "connected" | "reconnecting";
  heartbeatAt: string;
}

export function useSessionScreenController(input: UseSessionScreenControllerInput): SessionScreenVM {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidePanelOpen, setSidePanelOpen] = useState(false);

  const toggleDrawer = useCallback(() => {
    setDrawerOpen(current => {
      const next = !current;
      if (next) {
        setSidePanelOpen(false);
      }
      return next;
    });
  }, []);

  const openDrawer = useCallback(() => {
    setDrawerOpen(true);
    setSidePanelOpen(false);
  }, []);

  const toggleSidePanel = useCallback(() => {
    setSidePanelOpen(current => {
      const next = !current;
      if (next) {
        setDrawerOpen(false);
      }
      return next;
    });
  }, []);

  const openSidePanel = useCallback(() => {
    setSidePanelOpen(true);
    setDrawerOpen(false);
  }, []);

  const closePanels = useCallback(() => {
    setDrawerOpen(false);
    setSidePanelOpen(false);
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
  }, []);

  const closeSidePanel = useCallback(() => {
    setSidePanelOpen(false);
  }, []);

  return buildSessionScreenVM({
    chat: input.chat,
    titlebar: {
      activeScreen: input.activeScreen,
      streamStatus: input.streamStatus,
      heartbeatAt: input.heartbeatAt,
      drawerOpen,
      sidePanelOpen,
      openScreen: input.setActiveScreen,
      toggleDrawer,
      toggleSidePanel,
      closePanels,
    },
    layout: {
      drawerOpen,
      sidePanelOpen,
      openDrawer,
      openSidePanel,
      closeDrawer,
      closeSidePanel,
    },
  });
}

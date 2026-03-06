import { Activity, Clock3, Cpu, PanelLeft, PanelRight, SearchX, Settings2, Users, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { relativeFromIso } from "@/frontend/app/chatHelpers";
import type { SessionScreenTitlebarVM } from "@/frontend/opencode-react/types";

export function Titlebar({ model }: { model: SessionScreenTitlebarVM }) {
  const {
    activeScreen,
    heartbeatAt,
    streamStatus,
    drawerOpen,
    sidePanelOpen,
    openScreen,
    toggleDrawer,
    toggleSidePanel,
    closePanels,
  } = model;

  const screenButtons = [
    { id: "chat", label: "Chat", icon: Activity },
    { id: "skills", label: "Skills", icon: Wrench },
    { id: "mcp", label: "MCP", icon: Cpu },
    { id: "agents", label: "Agents", icon: Users },
    { id: "other", label: "Other", icon: Settings2 },
    { id: "cron", label: "Cron", icon: Clock3 },
  ] as const;

  return (
    <header className="oc-global-titlebar">
      <div className="oc-global-titlebar-left">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="oc-titlebar-action oc-panel-toggle"
          data-active={drawerOpen}
          aria-label="Toggle session drawer"
          onClick={toggleDrawer}
        >
          <PanelLeft className="size-3.5" />
        </Button>
      </div>
      <div className="oc-global-titlebar-center">
        <div className="oc-titlebar-session-meta">
          <p className="oc-titlebar-session-title">Wafflebot</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 px-4">
          {screenButtons.map(button => {
            const Icon = button.icon;
            return (
              <Button
                key={button.id}
                type="button"
                size="sm"
                variant={activeScreen === button.id ? "default" : "outline"}
                className="h-8 gap-1.5 px-2.5"
                onClick={() => openScreen(button.id)}
              >
                <Icon className="size-3.5" />
                <span>{button.label}</span>
              </Button>
            );
          })}
        </div>
      </div>
      <div className="oc-global-titlebar-right">
        <div className="oc-connection-pill">
          <span className="oc-dot" data-status={streamStatus} />
          <span className="oc-connection-state">{streamStatus === "connected" ? "RUNTIME ONLINE" : "RECONNECTING"}</span>
          {heartbeatAt ? <span className="oc-connection-heartbeat">HEARTBEAT {relativeFromIso(heartbeatAt)}</span> : null}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="oc-titlebar-action oc-panel-toggle"
          data-active={sidePanelOpen}
          aria-label="Toggle context panel"
          onClick={toggleSidePanel}
        >
          <PanelRight className="size-3.5" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="oc-titlebar-action oc-panel-toggle"
          aria-label="Close panels"
          onClick={closePanels}
        >
          <SearchX className="size-3.5" />
        </Button>
      </div>
    </header>
  );
}

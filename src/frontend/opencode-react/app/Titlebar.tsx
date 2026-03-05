import { PanelLeft, PanelRight, Scan } from "lucide-react";

import { Button } from "@/components/ui/button";
import { relativeFromIso } from "@/frontend/app/chatHelpers";
import type { SessionScreenTitlebarVM } from "@/frontend/opencode-react/types";

export function Titlebar({ model }: { model: SessionScreenTitlebarVM }) {
  const {
    heartbeatAt,
    streamStatus,
    sidebarOpen,
    flyoutOpen,
    toggleSidebar,
    toggleFlyout,
    closePanels,
  } = model;

  return (
    <header className="oc-global-titlebar">
      <div className="oc-global-titlebar-left">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="oc-titlebar-action oc-panel-toggle"
          data-active={sidebarOpen}
          aria-label="Toggle sidebar"
          onClick={toggleSidebar}
        >
          <PanelLeft className="size-3.5" />
        </Button>
      </div>
      <div className="oc-global-titlebar-center" />
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
          data-active={flyoutOpen}
          onClick={toggleFlyout}
        >
          <PanelRight className="size-3.5" />
        </Button>
        <Button type="button" size="sm" variant="outline" className="oc-titlebar-action oc-panel-toggle" onClick={closePanels}>
          <Scan className="size-3.5" />
        </Button>
      </div>
    </header>
  );
}

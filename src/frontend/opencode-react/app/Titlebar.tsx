import { Clock3, Cpu, Menu, MessageSquareText, PanelLeft, PanelRight, Settings2, Users, Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
  } = model;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const screenButtons = [
    { id: "chat", label: "Chat", icon: MessageSquareText },
    { id: "skills", label: "Skills", icon: Wrench },
    { id: "mcp", label: "MCP", icon: Cpu },
    { id: "agents", label: "Agents", icon: Users },
    { id: "other", label: "Other", icon: Settings2 },
    { id: "cron", label: "Cron", icon: Clock3 },
  ] as const;

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

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
        <div className="oc-titlebar-menu-wrap" ref={menuRef}>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="oc-titlebar-action oc-panel-toggle"
            data-active={menuOpen}
            aria-label="Open navigation menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(current => !current)}
          >
            <Menu className="size-3.5" />
          </Button>
          {menuOpen ? (
            <div className="oc-titlebar-menu-panel">
              {screenButtons.map(button => {
                const Icon = button.icon;
                return (
                  <button
                    key={button.id}
                    type="button"
                    className="oc-titlebar-menu-item"
                    data-active={activeScreen === button.id}
                    onClick={() => {
                      openScreen(button.id);
                      setMenuOpen(false);
                    }}
                  >
                    <Icon className="size-3.5" />
                    <span>{button.label}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

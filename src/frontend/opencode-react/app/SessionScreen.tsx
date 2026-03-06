import type { ReactNode } from "react";

import { ChatPage } from "@/frontend/app/pages/ChatPage";
import { Titlebar } from "@/frontend/opencode-react/app/Titlebar";
import type { SessionScreenVM } from "@/frontend/opencode-react/types";

export function SessionScreen({ model, managementScreen }: { model: SessionScreenVM; managementScreen?: ReactNode }) {
  return (
    <>
      <Titlebar model={model.titlebar} />
      <div className="flex min-h-0 flex-1" hidden={model.activeScreen !== "chat"}>
        <ChatPage model={model.chat} layout={model.layout} />
      </div>
      <div className="flex min-h-0 flex-1" hidden={model.activeScreen === "chat"}>
        {managementScreen}
      </div>
    </>
  );
}

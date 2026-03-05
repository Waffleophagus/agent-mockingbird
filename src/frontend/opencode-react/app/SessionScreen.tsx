import { ChatPage } from "@/frontend/app/pages/ChatPage";
import { Titlebar } from "@/frontend/opencode-react/app/Titlebar";
import type { SessionScreenVM } from "@/frontend/opencode-react/types";

export function SessionScreen({ model }: { model: SessionScreenVM }) {
  return (
    <>
      <Titlebar model={model.titlebar} />
      <ChatPage model={model.chat} layout={model.layout} />
    </>
  );
}

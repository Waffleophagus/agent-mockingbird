import type { ChatPageModel } from "@/frontend/app/pages/ChatPage";
import type {
  SessionScreenLayoutVM,
  SessionScreenVM,
  SessionScreenTitlebarVM,
} from "@/frontend/opencode-react/types";

export interface BuildSessionScreenAdapterInput {
  chat: ChatPageModel;
  titlebar: SessionScreenTitlebarVM;
  layout: SessionScreenLayoutVM;
}

export function buildSessionScreenVM(input: BuildSessionScreenAdapterInput): SessionScreenVM {
  return {
    titlebar: input.titlebar,
    layout: input.layout,
    chat: input.chat,
  };
}

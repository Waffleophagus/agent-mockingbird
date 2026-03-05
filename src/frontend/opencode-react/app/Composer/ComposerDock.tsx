import { Send, X } from "lucide-react";
import type { ClipboardEvent as ReactClipboardEvent, FormEvent, KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ComposerAttachment } from "@/frontend/app/useChatSession";

export interface ComposerDockProps {
  composerFormRef: RefObject<HTMLFormElement | null>;
  sendMessage: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  isSending: boolean;
  draftMessage: string;
  setDraftMessage: (value: string) => void;
  draftAttachments: ComposerAttachment[];
  removeComposerAttachment: (id: string) => void;
  handleComposerKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  handleComposerPaste: (event: ReactClipboardEvent<HTMLTextAreaElement>) => Promise<void>;
}

export function ComposerDock(props: ComposerDockProps) {
  const {
    composerFormRef,
    draftAttachments,
    draftMessage,
    handleComposerKeyDown,
    handleComposerPaste,
    isSending,
    removeComposerAttachment,
    sendMessage,
    setDraftMessage,
  } = props;

  return (
    <form className="oc-composer" onSubmit={sendMessage} ref={composerFormRef} aria-busy={isSending}>
      {draftAttachments.length > 0 && (
        <div className="oc-attachments">
          {draftAttachments.map(attachment => (
            <div key={attachment.id} className="oc-attachment-chip">
              <span className="max-w-40 truncate">{attachment.filename ?? attachment.mime}</span>
              <span className="text-muted-foreground">{Math.ceil(attachment.size / 1024)}KB</span>
              <button type="button" onClick={() => removeComposerAttachment(attachment.id)} aria-label="Remove attachment">
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <Textarea
        value={draftMessage}
        onChange={event => setDraftMessage(event.target.value)}
        onKeyDown={handleComposerKeyDown}
        onPaste={event => { void handleComposerPaste(event); }}
        placeholder={isSending ? "Agent is running. Send to queue your next message..." : "Ask anything..."}
        className="oc-composer-input"
      />
      <div className="oc-composer-actions">
        <p className="text-xs text-muted-foreground">Enter to send, Shift+Enter for newline.</p>
        <Button type="submit" size="sm" disabled={!draftMessage.trim() && draftAttachments.length === 0}>
          <Send className="size-4" />
          {isSending ? "Queue" : "Send"}
        </Button>
      </div>
    </form>
  );
}

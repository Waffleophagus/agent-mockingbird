import { ArrowUp, Square, X } from "lucide-react";
import type { ClipboardEvent as ReactClipboardEvent, FormEvent, KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ComposerAttachment } from "@/frontend/app/useChatSession";

export interface ComposerDockProps {
  composerFormRef: RefObject<HTMLFormElement | null>;
  sendMessage: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  canAbort: boolean;
  isSending: boolean;
  isAborting: boolean;
  draftMessage: string;
  requestAbortRun: () => void;
  setDraftMessage: (value: string) => void;
  draftAttachments: ComposerAttachment[];
  removeComposerAttachment: (id: string) => void;
  handleComposerKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  handleComposerPaste: (event: ReactClipboardEvent<HTMLTextAreaElement>) => Promise<void>;
}

export function ComposerDock(props: ComposerDockProps) {
  const {
    composerFormRef,
    canAbort,
    draftAttachments,
    draftMessage,
    handleComposerKeyDown,
    handleComposerPaste,
    isAborting,
    isSending,
    removeComposerAttachment,
    requestAbortRun,
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
        <p className="text-xs text-muted-foreground oc-composer-hint">Enter to send, Shift+Enter for newline.</p>
        <div className="oc-composer-action-buttons">
          {canAbort ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="oc-composer-icon-button"
              onClick={requestAbortRun}
              disabled={isAborting}
              aria-label={isAborting ? "Aborting active run" : "Abort active run"}
              title={isAborting ? "Aborting..." : "Abort active run"}
            >
              <Square className="size-3.5 fill-current" />
            </Button>
          ) : null}
          <Button
            type="submit"
            size="sm"
            className="oc-composer-icon-button oc-composer-send-button"
            disabled={!draftMessage.trim() && draftAttachments.length === 0}
            aria-label={isSending ? "Queue message" : "Send message"}
            title={isSending ? "Queue message" : "Send message"}
          >
            <ArrowUp className="size-4" />
          </Button>
        </div>
      </div>
    </form>
  );
}

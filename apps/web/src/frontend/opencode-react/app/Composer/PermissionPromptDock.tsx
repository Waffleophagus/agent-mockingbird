import type { PermissionPromptRequest } from "@agent-mockingbird/contracts/dashboard";
import { Ban, Check, ShieldCheck } from "lucide-react";


export interface PermissionPromptDockProps {
  request: PermissionPromptRequest;
  isBusy: boolean;
  onReply: (reply: "once" | "always" | "reject") => Promise<void>;
}

export function PermissionPromptDock(props: PermissionPromptDockProps) {
  const { request, isBusy, onReply } = props;

  return (
    <section className="oc-prompt-dock" aria-busy={isBusy}>
      <header className="oc-prompt-dock-head">
        <p className="oc-prompt-dock-title">Permission Required</p>
        <p className="oc-prompt-dock-subtitle">{request.permission}</p>
      </header>

      {request.patterns.length > 0 && (
        <div className="oc-prompt-dock-patterns">
          {request.patterns.map(pattern => (
            <code key={pattern}>{pattern}</code>
          ))}
        </div>
      )}

      <div className="oc-prompt-dock-actions">
        <button type="button" className="oc-inline-btn" onClick={() => void onReply("reject")} disabled={isBusy}>
          <Ban className="size-3.5" />
          Deny
        </button>
        <button type="button" className="oc-inline-btn" onClick={() => void onReply("always")} disabled={isBusy}>
          <ShieldCheck className="size-3.5" />
          Allow always
        </button>
        <button type="button" className="oc-inline-btn" onClick={() => void onReply("once")} disabled={isBusy}>
          <Check className="size-3.5" />
          Allow once
        </button>
      </div>
    </section>
  );
}

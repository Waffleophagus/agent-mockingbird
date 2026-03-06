import * as React from "react";

import { cn } from "@/lib/utils";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  React.useEffect(() => {
    if (!open) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open, onCancel]);

  React.useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            onCancel();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label="Close dialog"
      />
      <div
        className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <h2 id="dialog-title" className="font-display text-lg font-semibold">
          {title}
        </h2>
        {description && (
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        )}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-9 rounded-lg border border-border bg-transparent px-4 text-sm font-semibold transition hover:bg-accent hover:text-accent-foreground"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={cn(
              "h-9 rounded-lg px-4 text-sm font-semibold transition",
              variant === "danger"
                ? "bg-red-600 text-white hover:bg-red-700"
                : "bg-primary text-primary-foreground hover:bg-primary/85"
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export { ConfirmDialog };

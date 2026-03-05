import { Plus } from "lucide-react";
import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { relativeFromIso } from "@/frontend/app/chatHelpers";
import type { SessionContextResponse, SessionReviewResponse } from "@/frontend/opencode-react/types";
import type {
  BackgroundRunSnapshot,
  MemoryStatusSnapshot,
  MemoryWriteEvent,
  SessionSummary,
  UsageSnapshot,
} from "@/types/dashboard";

export interface RightFlyoutProps {
  activeSession?: SessionSummary;
  usage: UsageSnapshot;
  memoryError: string;
  memoryStatus: MemoryStatusSnapshot | null;
  memoryActivity: MemoryWriteEvent[];
  backgroundPrompt: string;
  setBackgroundPrompt: (value: string) => void;
  backgroundSpawnBusy: boolean;
  spawnBackgroundRun: () => Promise<void>;
  activeBackgroundRuns: BackgroundRunSnapshot[];
  backgroundActionBusyByRun: Record<string, "steer" | "abort">;
  backgroundSteerDraftByRun: Record<string, string>;
  setBackgroundSteerDraftByRun: Dispatch<SetStateAction<Record<string, string>>>;
  requestAbortBackgroundRun: (runId: string) => void;
  steerBackgroundRun: (runId: string, rawContent?: string) => Promise<void>;
}

export function RightFlyout(props: RightFlyoutProps) {
  const {
    activeSession,
    usage,
    memoryError,
    memoryStatus,
    memoryActivity,
    backgroundPrompt,
    setBackgroundPrompt,
    backgroundSpawnBusy,
    spawnBackgroundRun,
    activeBackgroundRuns,
    backgroundActionBusyByRun,
    backgroundSteerDraftByRun,
    setBackgroundSteerDraftByRun,
    requestAbortBackgroundRun,
    steerBackgroundRun,
  } = props;

  const [flyoutTab, setFlyoutTab] = useState<"review" | "context">("context");
  const [contextData, setContextData] = useState<SessionContextResponse | null>(null);
  const [reviewData, setReviewData] = useState<SessionReviewResponse | null>(null);
  const [contextError, setContextError] = useState("");
  const [reviewError, setReviewError] = useState("");

  const contextBreakdown = useMemo(() => {
    if (contextData) {
      return [
        { label: "System", value: contextData.contextBreakdown.system, color: "var(--context-system)" },
        { label: "User", value: contextData.contextBreakdown.user, color: "var(--context-user)" },
        { label: "Assistant", value: contextData.contextBreakdown.assistant, color: "var(--context-assistant)" },
        { label: "Tool Call", value: contextData.contextBreakdown.tools, color: "var(--context-tool)" },
        { label: "Other", value: contextData.contextBreakdown.other, color: "var(--context-other)" },
      ];
    }

    const baseUser = usage.inputTokens;
    const baseAssistant = usage.outputTokens;
    const tool = Math.max(1, activeBackgroundRuns.length * 45);
    const system = Math.max(1, Math.floor((baseUser + baseAssistant) * 0.08));
    const other = Math.max(1, Math.floor((baseUser + baseAssistant) * 0.02));
    const total = Math.max(1, system + baseUser + baseAssistant + tool + other);
    const ratio = (value: number) => Math.max(1, Math.round((value / total) * 1000) / 10);
    return [
      { label: "System", value: ratio(system), color: "var(--context-system)" },
      { label: "User", value: ratio(baseUser), color: "var(--context-user)" },
      { label: "Assistant", value: ratio(baseAssistant), color: "var(--context-assistant)" },
      { label: "Tool Call", value: ratio(tool), color: "var(--context-tool)" },
      { label: "Other", value: ratio(other), color: "var(--context-other)" },
    ];
  }, [contextData, usage.inputTokens, usage.outputTokens, activeBackgroundRuns.length]);

  useEffect(() => {
    const sessionId = activeSession?.id;
    if (!sessionId) {
      return;
    }

    const controller = new AbortController();
    const signal = controller.signal;

    void fetch(`/api/ui/sessions/${encodeURIComponent(sessionId)}/context`, { signal })
      .then(async response => {
        const payload = await response.json() as SessionContextResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Failed to load context");
        setContextData(payload);
        setContextError("");
      })
      .catch(error => {
        if (signal.aborted) return;
        setContextError(error instanceof Error ? error.message : "Failed to load context");
      });

    void fetch(`/api/ui/sessions/${encodeURIComponent(sessionId)}/review`, { signal })
      .then(async response => {
        const payload = await response.json() as SessionReviewResponse;
        if (!response.ok) throw new Error(payload.error ?? "Failed to load review");
        setReviewData(payload);
        setReviewError("");
      })
      .catch(error => {
        if (signal.aborted) return;
        setReviewError(error instanceof Error ? error.message : "Failed to load review");
      });

    return () => controller.abort();
  }, [activeSession?.id]);

  const providerLabel = contextData ? "OpenCode" : "OpenCode";
  const modelLabel = contextData?.session.model ?? activeSession?.model ?? "Unknown";
  const messageCount = contextData?.metrics.totalMessages ?? activeSession?.messageCount ?? 0;
  const inputTokens = contextData?.metrics.inputTokens ?? usage.inputTokens;
  const outputTokens = contextData?.metrics.outputTokens ?? usage.outputTokens;
  const estimatedCostUsd = contextData?.metrics.estimatedCostUsd ?? usage.estimatedCostUsd;
  const lastActiveAt = contextData?.session.lastActiveAt ?? activeSession?.lastActiveAt;

  return (
    <aside className="oc-session-flyout">
      <div className="oc-flyout-tabs">
        <button type="button" data-active={flyoutTab === "review"} onClick={() => setFlyoutTab("review")}>Review</button>
        <button type="button" data-active={flyoutTab === "context"} onClick={() => setFlyoutTab("context")}>Context</button>
        <button type="button" className="oc-flyout-add" aria-label="Add tab">+</button>
      </div>

      {flyoutTab === "review" ? (
        <div className="oc-flyout-panel">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Review</p>
          {reviewError && <p className="mt-2 text-xs text-destructive">{reviewError}</p>}
          {!reviewError && (
            <p className="mt-2 text-sm text-muted-foreground">
              {reviewData?.enabled
                ? "Review mapping is enabled for this session."
                : `Review is not available yet${reviewData?.reason ? ` (${reviewData.reason})` : ""}.`}
            </p>
          )}
        </div>
      ) : (
        <div className="oc-flyout-panel">
          {contextError && <p className="text-xs text-destructive">{contextError}</p>}
          <div className="oc-context-grid">
            <p className="oc-context-label">Session</p>
            <p className="oc-context-value">{activeSession?.title ?? "Main"}</p>
            <p className="oc-context-label">Provider</p>
            <p className="oc-context-value">{providerLabel}</p>
            <p className="oc-context-label">Model</p>
            <p className="oc-context-value">{modelLabel}</p>
            <p className="oc-context-label">Messages</p>
            <p className="oc-context-value">{messageCount}</p>
            <p className="oc-context-label">Input Tokens</p>
            <p className="oc-context-value">{inputTokens.toLocaleString()}</p>
            <p className="oc-context-label">Output Tokens</p>
            <p className="oc-context-value">{outputTokens.toLocaleString()}</p>
            <p className="oc-context-label">Total Cost</p>
            <p className="oc-context-value">${estimatedCostUsd.toFixed(2)}</p>
            <p className="oc-context-label">Last Activity</p>
            <p className="oc-context-value">{lastActiveAt ? relativeFromIso(lastActiveAt) : "-"}</p>
          </div>

          <div className="oc-context-section">
            <p className="oc-context-title">Context Breakdown</p>
            <div className="oc-context-breakdown-bar">
              {contextBreakdown.map(item => (
                <span key={item.label} style={{ width: `${item.value}%`, background: item.color }} />
              ))}
            </div>
            <div className="oc-context-breakdown-legend">
              {contextBreakdown.map(item => (
                <p key={item.label}>
                  <span className="oc-legend-dot" style={{ background: item.color }} />
                  {item.label} {item.value.toFixed(1)}%
                </p>
              ))}
            </div>
          </div>

          <div className="oc-context-section">
            <p className="oc-context-title">Memory</p>
            {memoryError && <p className="text-xs text-destructive">{memoryError}</p>}
            <p className="text-xs text-muted-foreground">Mode {memoryStatus?.toolMode ?? "unknown"}</p>
            <p className="text-xs text-muted-foreground">Files {memoryStatus?.files ?? 0} · Chunks {memoryStatus?.chunks ?? 0}</p>
            {memoryActivity[0] && <p className="text-xs text-muted-foreground">Latest {memoryActivity[0].content}</p>}
          </div>

          <div className="oc-context-section">
            <p className="oc-context-title">Background</p>
            <Textarea
              value={backgroundPrompt}
              onChange={event => setBackgroundPrompt(event.target.value)}
              className="oc-background-input"
              placeholder="Spawn background task..."
            />
            <div className="oc-background-actions">
              <Button type="button" size="sm" variant="outline" onClick={() => void spawnBackgroundRun()} disabled={!backgroundPrompt.trim() || backgroundSpawnBusy}>
                <Plus className="size-3.5" /> {backgroundSpawnBusy ? "Spawning..." : "Spawn"}
              </Button>
            </div>
            {activeBackgroundRuns.slice(0, 4).map(run => {
              const busyAction = backgroundActionBusyByRun[run.runId];
              const steerDraft = backgroundSteerDraftByRun[run.runId] ?? "";
              const terminal = run.status === "completed" || run.status === "failed" || run.status === "aborted";
              return (
                <div key={run.runId} className="oc-background-run">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs">{run.runId}</p>
                    <span className="oc-status-pill" data-status={terminal ? "idle" : "warning"}>{run.status}</span>
                  </div>
                  {!terminal && (
                    <>
                      <Input
                        value={steerDraft}
                        onChange={event => setBackgroundSteerDraftByRun(current => ({ ...current, [run.runId]: event.target.value }))}
                        className="mt-2 h-7 text-xs"
                        placeholder="Steer run"
                      />
                      <div className="mt-2 flex justify-end gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => requestAbortBackgroundRun(run.runId)} disabled={Boolean(busyAction)}>
                          Abort
                        </Button>
                        <Button type="button" size="sm" onClick={() => void steerBackgroundRun(run.runId)} disabled={!steerDraft.trim()}>
                          Steer
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
}

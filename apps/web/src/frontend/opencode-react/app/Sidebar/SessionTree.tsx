import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

import { Input } from "@/components/ui/input";
import { formatCompactTimestamp, relativeFromIso } from "@/frontend/app/chatHelpers";
import { isBackgroundRunInFlight } from "@/frontend/app/dashboardUtils";
import type { BackgroundRunSnapshot, SessionSummary } from "@agent-mockingbird/contracts/dashboard";

function formatTimestampSummary(iso: string) {
  const compact = formatCompactTimestamp(iso);
  if (!compact) return relativeFromIso(iso);
  return `${compact} · ${relativeFromIso(iso)}`;
}

export interface SessionTreeProps {
  activeSessionId: string;
  rootSessions: SessionSummary[];
  loading: boolean;
  sessionError: string;
  sessionSearchNeedle: string;
  totalSessionSearchMatches: number;
  childSessionSearchQuery: string;
  setChildSessionSearchQuery: (value: string) => void;
  showAllChildren: boolean;
  setShowAllChildren: Dispatch<SetStateAction<boolean>>;
  totalHiddenChildSessionsByAge: number;
  totalInFlightBackgroundRuns: number;
  createNewSession: () => Promise<void>;
  isCreatingSession: boolean;
  refreshInFlightBackgroundRuns: () => Promise<void>;
  setActiveSessionId: (sessionId: string) => void;
  childSessionsByParentSessionId: Record<string, SessionSummary[]>;
  childSessionVisibilityByParentSessionId: {
    visible: Record<string, SessionSummary[]>;
    hiddenByAgeCount: Record<string, number>;
  };
  expandedSessionGroupsById: Record<string, boolean>;
  toggleSessionGroup: (sessionId: string) => void;
  parentSessionSearchMatchBySessionId: Map<string, boolean>;
  childSessionSearchMatchBySessionId: Map<string, boolean>;
  childSessionHideAfterDays: number;
  inFlightBackgroundRunsBySession: Record<string, BackgroundRunSnapshot[]>;
  latestBackgroundRunByChildSessionId: Map<string, BackgroundRunSnapshot>;
  backgroundActionBusyByRun: Record<string, "steer" | "abort">;
  backgroundSteerDraftByRun: Record<string, string>;
  setBackgroundSteerDraftByRun: Dispatch<SetStateAction<Record<string, string>>>;
  steerBackgroundRun: (runId: string, rawContent?: string) => Promise<void>;
}

export function SessionTree(props: SessionTreeProps) {
  const {
    activeSessionId,
    childSessionSearchMatchBySessionId,
    childSessionSearchQuery,
    childSessionVisibilityByParentSessionId,
    childSessionsByParentSessionId,
    createNewSession,
    expandedSessionGroupsById,
    inFlightBackgroundRunsBySession,
    isCreatingSession,
    latestBackgroundRunByChildSessionId,
    loading,
    parentSessionSearchMatchBySessionId,
    refreshInFlightBackgroundRuns,
    rootSessions,
    sessionError,
    sessionSearchNeedle,
    setActiveSessionId,
    setChildSessionSearchQuery,
    setShowAllChildren,
    showAllChildren,
    toggleSessionGroup,
    totalHiddenChildSessionsByAge,
    totalInFlightBackgroundRuns,
    totalSessionSearchMatches,
    childSessionHideAfterDays,
  } = props;

  return (
    <aside className="oc-session-sidebar">
      <div className="oc-session-list-pane">
        <div className="oc-pane-header oc-pane-header-drawer">
          <div className="oc-drawer-title-row">
            <div>
              <p className="oc-pane-title">Sessions</p>
              <p className="oc-pane-subtitle">Focused shell by default, navigation on demand.</p>
            </div>
            <button type="button" className="oc-inline-btn" onClick={createNewSession} disabled={isCreatingSession}>
              <Plus className="size-3" />
              {isCreatingSession ? "Creating..." : "New"}
            </button>
          </div>
          <Input
            value={childSessionSearchQuery}
            onChange={event => setChildSessionSearchQuery(event.target.value)}
            placeholder="Search threads..."
            className="oc-session-search"
          />
          <div className="oc-session-toolbar oc-session-toolbar-compact">
            <button type="button" className="oc-inline-btn" onClick={() => void refreshInFlightBackgroundRuns()}>
              runs {totalInFlightBackgroundRuns}
            </button>
            <button type="button" className="oc-link-btn" onClick={() => setShowAllChildren(v => !v)}>
              {showAllChildren
                ? "Hide old children"
                : `Show all children${totalHiddenChildSessionsByAge > 0 ? ` (${totalHiddenChildSessionsByAge} hidden)` : ""}`}
            </button>
          </div>
          {sessionSearchNeedle && <p className="text-[11px] text-muted-foreground">{totalSessionSearchMatches} matches</p>}
          {sessionError && <p className="text-xs text-destructive">{sessionError}</p>}
        </div>

        <div className="oc-session-list-scroll">
          {loading && <p className="text-xs text-muted-foreground">Loading sessions...</p>}
          {!loading && rootSessions.map(session => {
            const children = childSessionsByParentSessionId[session.id] ?? [];
            const visibleChildren = childSessionVisibilityByParentSessionId.visible[session.id] ?? [];
            const hiddenChildrenByAge = childSessionVisibilityByParentSessionId.hiddenByAgeCount[session.id] ?? 0;
            const expanded = Boolean(expandedSessionGroupsById[session.id]);
            const parentSearchMatch = sessionSearchNeedle ? parentSessionSearchMatchBySessionId.get(session.id) === true : false;
            const inFlightRuns = inFlightBackgroundRunsBySession[session.id] ?? [];

            return (
              <article key={session.id} className="oc-session-row" data-active={activeSessionId === session.id} data-search-match={parentSearchMatch}>
                <button type="button" className="oc-session-row-main" onClick={() => setActiveSessionId(session.id)}>
                  <div className="oc-session-row-top">
                    <p className="oc-session-row-title">{session.title}</p>
                    <span className="oc-status-pill" data-status={session.status}>{session.status}</span>
                  </div>
                  <p className="oc-session-row-meta">
                    {session.messageCount} msgs • {formatTimestampSummary(session.lastActiveAt)}
                    {inFlightRuns.length > 0 ? ` • ${inFlightRuns.length} bg` : ""}
                  </p>
                </button>

                {children.length > 0 && (
                  <>
                    <button type="button" className="oc-link-btn" onClick={() => toggleSessionGroup(session.id)}>
                      {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                      {expanded ? "Hide subagents" : `Show subagents (${children.length})`}
                    </button>
                    {expanded && (
                      <div className="oc-child-list">
                        {visibleChildren.map(child => {
                          const childRun = latestBackgroundRunByChildSessionId.get(child.id) ?? null;
                          const childSearchMatch = sessionSearchNeedle ? childSessionSearchMatchBySessionId.get(child.id) === true : false;
                          const childRunInFlight = childRun ? isBackgroundRunInFlight(childRun) : false;

                          return (
                            <button
                              key={child.id}
                              type="button"
                              className="oc-child-row oc-child-row-main"
                              data-active={activeSessionId === child.id}
                              data-search-match={childSearchMatch}
                              onClick={() => setActiveSessionId(child.id)}
                            >
                              <div className="oc-session-row-top">
                                <p className="oc-child-row-title">{child.title}</p>
                                {childRun ? (
                                  <span className="oc-status-pill" data-status={childRunInFlight ? "warning" : "idle"}>{childRun.status}</span>
                                ) : null}
                              </div>
                              <p className="oc-child-row-meta">{child.messageCount} msgs • {formatTimestampSummary(child.lastActiveAt)}</p>
                            </button>
                          );
                        })}

                        {hiddenChildrenByAge > 0 && !showAllChildren && (
                          <p className="text-[11px] text-muted-foreground">
                            {hiddenChildrenByAge} old child sessions hidden ({childSessionHideAfterDays}d)
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

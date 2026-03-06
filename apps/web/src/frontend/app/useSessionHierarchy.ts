import { useMemo } from "react";

import { DAY_MS, isBackgroundRunInFlight, sortBackgroundRuns, sortSessionsByActivity } from "@/frontend/app/dashboardUtils";
import type { BackgroundRunSnapshot, SessionSummary } from "@wafflebot/contracts/dashboard";

interface UseSessionHierarchyInput {
  activeSessionId: string;
  sessions: SessionSummary[];
  backgroundRunsBySession: Record<string, BackgroundRunSnapshot[]>;
  childSessionSearchQuery: string;
  showAllChildren: boolean;
  childSessionHideAfterDays: number;
  referenceNowMs: number;
}

export function useSessionHierarchy({
  activeSessionId,
  sessions,
  backgroundRunsBySession,
  childSessionSearchQuery,
  showAllChildren,
  childSessionHideAfterDays,
  referenceNowMs,
}: UseSessionHierarchyInput) {
  const activeBackgroundRuns = useMemo(
    () => sortBackgroundRuns(backgroundRunsBySession[activeSessionId] ?? []),
    [backgroundRunsBySession, activeSessionId],
  );

  const inFlightBackgroundRunsBySession = useMemo(() => {
    const next: Record<string, BackgroundRunSnapshot[]> = {};
    for (const [sessionId, runs] of Object.entries(backgroundRunsBySession)) {
      const inFlight = runs.filter(isBackgroundRunInFlight);
      if (inFlight.length > 0) {
        next[sessionId] = sortBackgroundRuns(inFlight);
      }
    }
    return next;
  }, [backgroundRunsBySession]);

  const latestBackgroundRunByChildSessionId = useMemo(() => {
    const next = new Map<string, BackgroundRunSnapshot>();
    for (const runs of Object.values(backgroundRunsBySession)) {
      for (const run of runs) {
        if (!run.childSessionId) continue;
        const current = next.get(run.childSessionId);
        if (!current || Date.parse(run.updatedAt) > Date.parse(current.updatedAt)) {
          next.set(run.childSessionId, run);
        }
      }
    }
    return next;
  }, [backgroundRunsBySession]);

  const childParentSessionIdByChildSessionId = useMemo(() => {
    const next = new Map<string, string>();
    for (const runs of Object.values(backgroundRunsBySession)) {
      for (const run of runs) {
        if (!run.childSessionId) continue;
        next.set(run.childSessionId, run.parentSessionId);
      }
    }
    return next;
  }, [backgroundRunsBySession]);

  const sessionsById = useMemo(() => new Map(sessions.map(session => [session.id, session])), [sessions]);

  const rootSessions = useMemo(
    () =>
      sessions.filter(session => {
        const parentSessionId = childParentSessionIdByChildSessionId.get(session.id);
        if (!parentSessionId) return true;
        return !sessionsById.has(parentSessionId);
      }),
    [sessions, childParentSessionIdByChildSessionId, sessionsById],
  );

  const childSessionsByParentSessionId = useMemo(() => {
    const next: Record<string, SessionSummary[]> = {};
    for (const session of sessions) {
      const parentSessionId = childParentSessionIdByChildSessionId.get(session.id);
      if (!parentSessionId || !sessionsById.has(parentSessionId)) continue;
      if (!next[parentSessionId]) next[parentSessionId] = [];
      next[parentSessionId].push(session);
    }
    for (const [parentSessionId, children] of Object.entries(next)) {
      next[parentSessionId] = sortSessionsByActivity(children);
    }
    return next;
  }, [sessions, childParentSessionIdByChildSessionId, sessionsById]);

  const sessionSearchNeedle = useMemo(() => childSessionSearchQuery.trim().toLowerCase(), [childSessionSearchQuery]);

  const childSessionVisibilityByParentSessionId = useMemo(() => {
    const visible: Record<string, SessionSummary[]> = {};
    const hiddenByAgeCount: Record<string, number> = {};
    const hideAfterMs = childSessionHideAfterDays * DAY_MS;
    const now = referenceNowMs;

    for (const [parentSessionId, children] of Object.entries(childSessionsByParentSessionId)) {
      const nextVisible: SessionSummary[] = [];
      let hidden = 0;

      for (const child of children) {
        const childRun = latestBackgroundRunByChildSessionId.get(child.id) ?? null;
        const inFlight = childRun ? isBackgroundRunInFlight(childRun) : false;
        const lastActiveAtMs = Date.parse(child.lastActiveAt);
        const hiddenByAge =
          !showAllChildren &&
          hideAfterMs > 0 &&
          Number.isFinite(lastActiveAtMs) &&
          now - lastActiveAtMs > hideAfterMs &&
          child.id !== activeSessionId &&
          !inFlight;
        if (hiddenByAge) {
          hidden += 1;
          continue;
        }
        nextVisible.push(child);
      }

      visible[parentSessionId] = nextVisible;
      hiddenByAgeCount[parentSessionId] = hidden;
    }

    return { visible, hiddenByAgeCount };
  }, [
    childSessionsByParentSessionId,
    latestBackgroundRunByChildSessionId,
    showAllChildren,
    childSessionHideAfterDays,
    activeSessionId,
    referenceNowMs,
  ]);

  const childSessionSearchMatchBySessionId = useMemo(() => {
    const matches = new Map<string, boolean>();
    if (!sessionSearchNeedle) return matches;
    for (const [parentSessionId, children] of Object.entries(childSessionVisibilityByParentSessionId.visible)) {
      for (const child of children) {
        const childRun = latestBackgroundRunByChildSessionId.get(child.id) ?? null;
        const haystack = `${child.title}\n${child.model}\n${childRun?.prompt ?? ""}`.toLowerCase();
        matches.set(child.id, haystack.includes(sessionSearchNeedle));
      }
      if (!children.length) {
        matches.set(parentSessionId, false);
      }
    }
    return matches;
  }, [childSessionVisibilityByParentSessionId.visible, latestBackgroundRunByChildSessionId, sessionSearchNeedle]);

  const parentSessionSearchMatchBySessionId = useMemo(() => {
    const matches = new Map<string, boolean>();
    if (!sessionSearchNeedle) return matches;

    for (const session of rootSessions) {
      const inFlightRuns = inFlightBackgroundRunsBySession[session.id] ?? [];
      const children = childSessionVisibilityByParentSessionId.visible[session.id] ?? [];
      const parentMatch = `${session.title}\n${session.model}`.toLowerCase().includes(sessionSearchNeedle);
      const childMatch = children.some(child => childSessionSearchMatchBySessionId.get(child.id) === true);
      const runMatch = inFlightRuns.some(run => (run.prompt ?? "").toLowerCase().includes(sessionSearchNeedle));
      matches.set(session.id, parentMatch || childMatch || runMatch);
    }

    return matches;
  }, [
    sessionSearchNeedle,
    rootSessions,
    inFlightBackgroundRunsBySession,
    childSessionVisibilityByParentSessionId.visible,
    childSessionSearchMatchBySessionId,
  ]);

  const totalSessionSearchMatches = useMemo(() => {
    if (!sessionSearchNeedle) return 0;
    let count = 0;
    for (const matched of parentSessionSearchMatchBySessionId.values()) {
      if (matched) count += 1;
    }
    for (const matched of childSessionSearchMatchBySessionId.values()) {
      if (matched) count += 1;
    }
    return count;
  }, [sessionSearchNeedle, parentSessionSearchMatchBySessionId, childSessionSearchMatchBySessionId]);

  const totalHiddenChildSessionsByAge = useMemo(
    () =>
      Object.values(childSessionVisibilityByParentSessionId.hiddenByAgeCount).reduce((count, value) => count + value, 0),
    [childSessionVisibilityByParentSessionId.hiddenByAgeCount],
  );

  const totalInFlightBackgroundRuns = useMemo(
    () =>
      Object.values(inFlightBackgroundRunsBySession).reduce((count, runs) => {
        return count + runs.length;
      }, 0),
    [inFlightBackgroundRunsBySession],
  );

  const activeBackgroundInFlightCount = useMemo(
    () => activeBackgroundRuns.filter(run => isBackgroundRunInFlight(run)).length,
    [activeBackgroundRuns],
  );

  return {
    activeBackgroundRuns,
    inFlightBackgroundRunsBySession,
    latestBackgroundRunByChildSessionId,
    childParentSessionIdByChildSessionId,
    rootSessions,
    childSessionsByParentSessionId,
    sessionSearchNeedle,
    childSessionVisibilityByParentSessionId,
    childSessionSearchMatchBySessionId,
    parentSessionSearchMatchBySessionId,
    totalSessionSearchMatches,
    totalHiddenChildSessionsByAge,
    totalInFlightBackgroundRuns,
    activeBackgroundInFlightCount,
  };
}

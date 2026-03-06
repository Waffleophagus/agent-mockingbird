import { useEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { BackgroundRunsResponse } from "@/frontend/app/dashboardTypes";
import { mergeBackgroundRunsBySession, sortBackgroundRuns, sortSessionsByActivity } from "@/frontend/app/dashboardUtils";
import type { BackgroundRunSnapshot, SessionSummary } from "@wafflebot/contracts/dashboard";

type ConfigPanelTab = "usage" | "memory" | "background";

interface UseBackgroundRunsInput {
  activeSessionId: string;
  sessions: SessionSummary[];
  loadedBackgroundSessionsRef: MutableRefObject<Set<string>>;
  setBackgroundRunsBySession: Dispatch<SetStateAction<Record<string, BackgroundRunSnapshot[]>>>;
  setSessions: Dispatch<SetStateAction<SessionSummary[]>>;
  setActiveSessionId: Dispatch<SetStateAction<string>>;
  setActiveConfigPanelTab: Dispatch<SetStateAction<ConfigPanelTab>>;
}

export function useBackgroundRuns(input: UseBackgroundRunsInput) {
  const inputRef = useRef(input);
  inputRef.current = input;

  const [loadingBackgroundRuns, setLoadingBackgroundRuns] = useState(false);
  const [backgroundRunsError, setBackgroundRunsError] = useState("");
  const [backgroundPrompt, setBackgroundPrompt] = useState("");
  const [backgroundSpawnBusy, setBackgroundSpawnBusy] = useState(false);
  const [backgroundSteerDraftByRun, setBackgroundSteerDraftByRun] = useState<Record<string, string>>({});
  const [backgroundActionBusyByRun, setBackgroundActionBusyByRun] = useState<Record<string, "steer" | "abort">>({});
  const [backgroundCheckInBusyByRun, setBackgroundCheckInBusyByRun] = useState<Record<string, boolean>>({});
  const [focusedBackgroundRunId, setFocusedBackgroundRunId] = useState("");

  async function refreshBackgroundRunsForSession(sessionId: string) {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) return;

    setLoadingBackgroundRuns(true);
    setBackgroundRunsError("");
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(normalizedSessionId)}/background`);
      const payload = (await response.json()) as BackgroundRunsResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load background runs");
      }
      const runs = Array.isArray(payload.runs) ? sortBackgroundRuns(payload.runs) : [];
      inputRef.current.setBackgroundRunsBySession(current => ({
        ...current,
        [normalizedSessionId]: runs,
      }));
      inputRef.current.loadedBackgroundSessionsRef.current.add(normalizedSessionId);
    } catch (error) {
      setBackgroundRunsError(error instanceof Error ? error.message : "Failed to load background runs");
    } finally {
      setLoadingBackgroundRuns(false);
    }
  }

  async function refreshSessionsList() {
    try {
      const response = await fetch("/api/sessions");
      const payload = (await response.json()) as { sessions?: SessionSummary[]; error?: string };
      if (!response.ok || !Array.isArray(payload.sessions)) {
        throw new Error(payload.error ?? "Failed to refresh sessions");
      }
      inputRef.current.setSessions(sortSessionsByActivity(payload.sessions));
    } catch {
      // best-effort only; caller can continue with local view
    }
  }

  async function refreshInFlightBackgroundRuns() {
    setBackgroundRunsError("");
    try {
      const response = await fetch("/api/background?inFlightOnly=1&limit=500");
      const payload = (await response.json()) as BackgroundRunsResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to refresh in-flight background runs");
      }
      if (Array.isArray(payload.runs)) {
        inputRef.current.setBackgroundRunsBySession(current => mergeBackgroundRunsBySession(current, payload.runs ?? []));
      }
    } catch (error) {
      setBackgroundRunsError(error instanceof Error ? error.message : "Failed to refresh in-flight background runs");
    }
  }

  async function spawnBackgroundRun() {
    const activeSession = inputRef.current.sessions.find(session => session.id === inputRef.current.activeSessionId);
    if (!activeSession) return;
    const prompt = backgroundPrompt.trim();
    if (!prompt) return;

    setBackgroundSpawnBusy(true);
    setBackgroundRunsError("");
    try {
      const response = await fetch("/api/background", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: activeSession.id,
          prompt,
          requestedBy: "dashboard-ui",
        }),
      });
      const payload = (await response.json()) as BackgroundRunsResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to spawn background run");
      }
      if (payload.run) {
        const run = payload.run;
        inputRef.current.loadedBackgroundSessionsRef.current.add(run.parentSessionId);
        inputRef.current.setBackgroundRunsBySession(current => mergeBackgroundRunsBySession(current, [run]));
      }
      setBackgroundPrompt("");
      await refreshBackgroundRunsForSession(activeSession.id);
    } catch (error) {
      setBackgroundRunsError(error instanceof Error ? error.message : "Failed to spawn background run");
    } finally {
      setBackgroundSpawnBusy(false);
    }
  }

  async function steerBackgroundRun(runId: string, rawContent?: string) {
    const content = (rawContent ?? backgroundSteerDraftByRun[runId] ?? "").trim();
    if (!content) return;

    setBackgroundActionBusyByRun(current => ({
      ...current,
      [runId]: "steer",
    }));
    setBackgroundRunsError("");
    try {
      const response = await fetch(`/api/background/${encodeURIComponent(runId)}/steer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const payload = (await response.json()) as BackgroundRunsResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to steer background run");
      }
      if (payload.run) {
        const run = payload.run;
        inputRef.current.loadedBackgroundSessionsRef.current.add(run.parentSessionId);
        inputRef.current.setBackgroundRunsBySession(current => mergeBackgroundRunsBySession(current, [run]));
      }
      setBackgroundSteerDraftByRun(current => {
        if (!current[runId]) return current;
        const next = { ...current };
        delete next[runId];
        return next;
      });
    } catch (error) {
      setBackgroundRunsError(error instanceof Error ? error.message : "Failed to steer background run");
    } finally {
      setBackgroundActionBusyByRun(current => {
        if (!current[runId]) return current;
        const next = { ...current };
        delete next[runId];
        return next;
      });
    }
  }

  async function checkInBackgroundRun(run: BackgroundRunSnapshot) {
    setFocusedBackgroundRunId(run.runId);
    setBackgroundRunsError("");
    setBackgroundCheckInBusyByRun(current => ({
      ...current,
      [run.runId]: true,
    }));
    try {
      const response = await fetch(`/api/background/${encodeURIComponent(run.runId)}`);
      const payload = (await response.json()) as BackgroundRunsResponse;
      if (!response.ok || !payload.run) {
        throw new Error(payload.error ?? "Failed to check in on background run");
      }
      const latest = payload.run;
      inputRef.current.setBackgroundRunsBySession(current => mergeBackgroundRunsBySession(current, [latest]));
      await refreshBackgroundRunsForSession(latest.parentSessionId);
      const targetSessionId = latest.childSessionId ?? run.childSessionId;
      if (targetSessionId) {
        await refreshSessionsList();
        inputRef.current.setActiveSessionId(targetSessionId);
      } else {
        inputRef.current.setActiveSessionId(latest.parentSessionId);
        inputRef.current.setActiveConfigPanelTab("background");
      }
    } catch (error) {
      setBackgroundRunsError(error instanceof Error ? error.message : "Failed to check in on background run");
    } finally {
      setBackgroundCheckInBusyByRun(current => {
        if (!current[run.runId]) return current;
        const next = { ...current };
        delete next[run.runId];
        return next;
      });
    }
  }

  async function abortBackgroundRun(runId: string) {
    setBackgroundActionBusyByRun(current => ({
      ...current,
      [runId]: "abort",
    }));
    setBackgroundRunsError("");
    try {
      const response = await fetch(`/api/background/${encodeURIComponent(runId)}/abort`, {
        method: "POST",
      });
      const payload = (await response.json()) as BackgroundRunsResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to abort background run");
      }
      if (!payload.aborted) {
        throw new Error("No active background run was available to abort.");
      }
    } catch (error) {
      setBackgroundRunsError(error instanceof Error ? error.message : "Failed to abort background run");
    } finally {
      setBackgroundActionBusyByRun(current => {
        if (!current[runId]) return current;
        const next = { ...current };
        delete next[runId];
        return next;
      });
    }
  }

  useEffect(() => {
    let cancelled = false;

    const refreshInFlightBackgroundRunsSilently = async () => {
      try {
        const response = await fetch("/api/background?inFlightOnly=1&limit=500");
        const payload = (await response.json()) as BackgroundRunsResponse;
        if (!response.ok || !Array.isArray(payload.runs) || cancelled) {
          return;
        }
        inputRef.current.setBackgroundRunsBySession(current => mergeBackgroundRunsBySession(current, payload.runs ?? []));
      } catch {
        // non-blocking; sidebar hierarchy should degrade gracefully when listing is unavailable
      }
    };

    void refreshInFlightBackgroundRunsSilently();
    const interval = setInterval(() => {
      void refreshInFlightBackgroundRunsSilently();
    }, 15_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return {
    abortBackgroundRun,
    backgroundActionBusyByRun,
    backgroundCheckInBusyByRun,
    backgroundPrompt,
    backgroundRunsError,
    backgroundSpawnBusy,
    backgroundSteerDraftByRun,
    checkInBackgroundRun,
    focusedBackgroundRunId,
    loadingBackgroundRuns,
    refreshBackgroundRunsForSession,
    refreshInFlightBackgroundRuns,
    refreshSessionsList,
    setBackgroundPrompt,
    setBackgroundRunsError,
    setBackgroundActionBusyByRun,
    setBackgroundSteerDraftByRun,
    setFocusedBackgroundRunId,
    spawnBackgroundRun,
    steerBackgroundRun,
  };
}

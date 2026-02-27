import {
  Activity,
  AlertTriangle,
  Brain,
  BookOpen,
  Bot,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  CircleSlash,
  Cpu,
  LoaderCircle,
  Plus,
  RefreshCcw,
  Scissors,
  Send,
  X,
  Wrench,
} from "lucide-react";
import type {
  ClipboardEvent as ReactClipboardEvent,
  Dispatch,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  RefObject,
  SetStateAction,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  formatCompactTimestamp,
  formatElapsedFrom,
  type LocalChatMessage,
  relativeFromIso,
  sanitizeMessageContentForDisplay,
  shouldHideMirroredAssistantContent,
} from "@/frontend/app/chatHelpers";
import { cn, isBackgroundRunInFlight } from "@/frontend/app/dashboardUtils";
import { MarkdownMessage } from "@/frontend/app/components/MarkdownMessage";
import { Skeleton } from "@/frontend/app/Skeleton";
import type { ComposerAttachment } from "@/frontend/app/useChatSession";
import type {
  BackgroundRunSnapshot,
  ChatMessagePart,
  MemoryStatusSnapshot,
  MemoryWriteEvent,
  ModelOption,
  SessionSummary,
  UsageSnapshot,
} from "@/types/dashboard";

type ConfigPanelTab = "usage" | "memory" | "background";

function stringifyToolInput(input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return "";
  }
}

function formatTimestampSummary(iso: string): string {
  const compact = formatCompactTimestamp(iso);
  if (!compact) return relativeFromIso(iso);
  return `${compact} · ${relativeFromIso(iso)}`;
}

function resolvePartTimestamp(part: ChatMessagePart, fallbackIso: string): string {
  const iso = part.startedAt ?? part.observedAt ?? fallbackIso;
  return iso;
}

function sortPartsChronologically(parts: ChatMessagePart[], fallbackIso: string): ChatMessagePart[] {
  return [...parts].sort((left, right) => {
    const leftTs = Date.parse(resolvePartTimestamp(left, fallbackIso));
    const rightTs = Date.parse(resolvePartTimestamp(right, fallbackIso));
    if (Number.isFinite(leftTs) && Number.isFinite(rightTs) && leftTs !== rightTs) {
      return leftTs - rightTs;
    }
    return left.id.localeCompare(right.id);
  });
}

export interface ChatPageModel {
  activeBackgroundInFlightCount: number;
  activeBackgroundRuns: BackgroundRunSnapshot[];
  activeConfigPanelTab: ConfigPanelTab;
  activeMessages: LocalChatMessage[];
  activeRunStatusHint: string;
  activeRunStatusLabel: string;
  activeSession?: SessionSummary;
  activeSessionCompactedAt: string;
  activeSessionId: string;
  activeSessionRunError: string;
  availableModels: ModelOption[];
  backgroundActionBusyByRun: Record<string, "steer" | "abort">;
  backgroundCheckInBusyByRun: Record<string, boolean>;
  backgroundPrompt: string;
  backgroundRunsError: string;
  backgroundSpawnBusy: boolean;
  backgroundSteerDraftByRun: Record<string, string>;
  canAbortActiveSession: boolean;
  chatControlError: string;
  chatScrollRef: RefObject<HTMLDivElement | null>;
  checkInBackgroundRun: (run: BackgroundRunSnapshot) => Promise<void>;
  childSessionHideAfterDays: number;
  childSessionSearchMatchBySessionId: Map<string, boolean>;
  childSessionSearchQuery: string;
  childSessionVisibilityByParentSessionId: {
    visible: Record<string, SessionSummary[]>;
    hiddenByAgeCount: Record<string, number>;
  };
  childSessionsByParentSessionId: Record<string, SessionSummary[]>;
  compactSession: (sessionId: string) => Promise<void>;
  composerFormRef: RefObject<HTMLFormElement | null>;
  createNewSession: () => Promise<void>;
  draftMessage: string;
  draftAttachments: ComposerAttachment[];
  expandedSessionGroupsById: Record<string, boolean>;
  filteredModelOptions: ModelOption[];
  focusedBackgroundRunId: string;
  focusedModelIndex: number;
  handleComposerKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  handleComposerPaste: (event: ReactClipboardEvent<HTMLTextAreaElement>) => Promise<void>;
  handleModelSearchKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  hasNewMessages: boolean;
  inFlightBackgroundRunsBySession: Record<string, BackgroundRunSnapshot[]>;
  isAborting: boolean;
  isActiveSessionRunning: boolean;
  isCompacting: boolean;
  isCreatingSession: boolean;
  isModelPickerOpen: boolean;
  isSavingModel: boolean;
  isSending: boolean;
  isUserScrolledUp: boolean;
  latestBackgroundRunByChildSessionId: Map<string, BackgroundRunSnapshot>;
  loading: boolean;
  loadingBackgroundRuns: boolean;
  loadingMessages: boolean;
  loadingModels: boolean;
  memoryActivity: MemoryWriteEvent[];
  memoryError: string;
  memoryStatus: MemoryStatusSnapshot | null;
  modelError: string;
  modelPickerRef: RefObject<HTMLDivElement | null>;
  modelQuery: string;
  modelSearchInputRef: RefObject<HTMLInputElement | null>;
  parentSessionSearchMatchBySessionId: Map<string, boolean>;
  refreshBackgroundRunsForSession: (sessionId: string) => Promise<void>;
  refreshInFlightBackgroundRuns: () => Promise<void>;
  refreshSessionsList: () => Promise<void>;
  requestAbortBackgroundRun: (runId: string) => void;
  requestAbortRun: () => void;
  retryFailedRequest: (requestId: string) => void;
  removeComposerAttachment: (id: string) => void;
  rootSessions: SessionSummary[];
  scrollToBottom: () => void;
  selectModelFromPicker: (model: string) => Promise<void>;
  selectedModelLabel: string;
  runtimeDefaultModel: string;
  sessionMatchesRuntimeDefault: boolean;
  sendMessage: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  sessionError: string;
  sessionSearchNeedle: string;
  setActiveConfigPanelTab: Dispatch<SetStateAction<ConfigPanelTab>>;
  setActiveSessionId: (sessionId: string) => void;
  setBackgroundPrompt: (value: string) => void;
  setBackgroundSteerDraftByRun: Dispatch<SetStateAction<Record<string, string>>>;
  setChildSessionSearchQuery: (value: string) => void;
  setDraftMessage: (value: string) => void;
  setIsModelPickerOpen: Dispatch<SetStateAction<boolean>>;
  setModelQuery: (value: string) => void;
  setShowThinkingDetails: Dispatch<SetStateAction<boolean>>;
  setShowToolCallDetails: Dispatch<SetStateAction<boolean>>;
  setShowAllChildren: Dispatch<SetStateAction<boolean>>;
  showThinkingDetails: boolean;
  showToolCallDetails: boolean;
  showAllChildren: boolean;
  syncRuntimeDefaultToActiveModel: () => Promise<void>;
  isSyncingRuntimeDefaultModel: boolean;
  spawnBackgroundRun: () => Promise<void>;
  steerBackgroundRun: (runId: string, rawContent?: string) => Promise<void>;
  toggleSessionGroup: (sessionId: string) => void;
  totalHiddenChildSessionsByAge: number;
  totalInFlightBackgroundRuns: number;
  totalSessionSearchMatches: number;
  usage: UsageSnapshot;
}

export function ChatPage({ model }: { model: ChatPageModel }) {
  const {
    activeBackgroundInFlightCount,
    activeBackgroundRuns,
    activeConfigPanelTab,
    activeMessages,
    activeRunStatusHint,
    activeRunStatusLabel,
    activeSession,
    activeSessionCompactedAt,
    activeSessionId,
    activeSessionRunError,
    availableModels,
    backgroundActionBusyByRun,
    backgroundCheckInBusyByRun,
    backgroundPrompt,
    backgroundRunsError,
    backgroundSpawnBusy,
    backgroundSteerDraftByRun,
    canAbortActiveSession,
    chatControlError,
    chatScrollRef,
    checkInBackgroundRun,
    childSessionHideAfterDays,
    childSessionSearchMatchBySessionId,
    childSessionSearchQuery,
    childSessionVisibilityByParentSessionId,
    childSessionsByParentSessionId,
    compactSession,
    composerFormRef,
    createNewSession,
    draftMessage,
    draftAttachments,
    expandedSessionGroupsById,
    filteredModelOptions,
    focusedBackgroundRunId,
    focusedModelIndex,
    handleComposerKeyDown,
    handleComposerPaste,
    handleModelSearchKeyDown,
    hasNewMessages,
    inFlightBackgroundRunsBySession,
    isAborting,
    isActiveSessionRunning,
    isCompacting,
    isCreatingSession,
    isModelPickerOpen,
    isSavingModel,
    isSending,
    isUserScrolledUp,
    latestBackgroundRunByChildSessionId,
    loading,
    loadingBackgroundRuns,
    loadingMessages,
    loadingModels,
    memoryActivity,
    memoryError,
    memoryStatus,
    modelError,
    modelPickerRef,
    modelQuery,
    modelSearchInputRef,
    parentSessionSearchMatchBySessionId,
    refreshBackgroundRunsForSession,
    refreshInFlightBackgroundRuns,
    refreshSessionsList,
    requestAbortBackgroundRun,
    requestAbortRun,
    retryFailedRequest,
    removeComposerAttachment,
    rootSessions,
    scrollToBottom,
    selectModelFromPicker,
    selectedModelLabel,
    runtimeDefaultModel,
    sessionMatchesRuntimeDefault,
    sendMessage,
    sessionError,
    sessionSearchNeedle,
    setActiveConfigPanelTab,
    setActiveSessionId,
    setBackgroundPrompt,
    setBackgroundSteerDraftByRun,
    setChildSessionSearchQuery,
    setDraftMessage,
    setIsModelPickerOpen,
    setModelQuery,
    setShowThinkingDetails,
    setShowToolCallDetails,
    setShowAllChildren,
    showThinkingDetails,
    showToolCallDetails,
    showAllChildren,
    syncRuntimeDefaultToActiveModel,
    isSyncingRuntimeDefaultModel,
    spawnBackgroundRun,
    steerBackgroundRun,
    toggleSessionGroup,
    totalHiddenChildSessionsByAge,
    totalInFlightBackgroundRuns,
    totalSessionSearchMatches,
    usage,
  } = model;

  return (
<section className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
<Card className="panel-noise flex min-h-0 flex-col">
  <CardHeader>
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <CardTitle className="flex items-center gap-2">
          <Bot className="size-4" />
          Sessions
        </CardTitle>
        <CardDescription>Switch sessions and set the model for each conversation.</CardDescription>
      </div>
    </div>
    <div className="grid grid-cols-2 gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => void refreshInFlightBackgroundRuns()}
        className="w-full justify-center"
      >
        <RefreshCcw className="size-4" />
        runs {totalInFlightBackgroundRuns}
      </Button>
      <Button
        type="button"
        size="sm"
        onClick={createNewSession}
        disabled={isCreatingSession}
        className="w-full justify-center"
      >
        <Plus className="size-4" />
        {isCreatingSession ? "Creating..." : "New"}
      </Button>
    </div>
    <div className="space-y-2">
      <div className="relative">
        <Input
          value={childSessionSearchQuery}
          onChange={event => setChildSessionSearchQuery(event.target.value)}
          placeholder="Search threads and topics..."
          className="h-8 pr-8 text-xs"
        />
        {childSessionSearchQuery && (
          <button
            type="button"
            onClick={() => setChildSessionSearchQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <CircleSlash className="size-4" />
          </button>
        )}
      </div>
      {sessionSearchNeedle && (
        <p className="px-1 text-[11px] text-muted-foreground">
          {totalSessionSearchMatches} match{totalSessionSearchMatches === 1 ? "" : "es"}
        </p>
      )}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 w-full justify-start px-2 text-xs text-muted-foreground"
        onClick={() => setShowAllChildren(current => !current)}
      >
        {showAllChildren
          ? "Hide old children"
          : `Show all children${totalHiddenChildSessionsByAge > 0 ? ` (${totalHiddenChildSessionsByAge} hidden)` : ""}`}
      </Button>
    </div>
    {sessionError && <p className="text-xs text-destructive">{sessionError}</p>}
  </CardHeader>
  <CardContent className="space-y-2 overflow-y-auto">
    {loading && (
      <div className="space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="rounded-xl border border-border bg-muted/70 p-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="mt-2 h-3 w-1/2" />
            <Skeleton className="mt-2 h-3 w-1/4" />
          </div>
        ))}
      </div>
    )}
    {!loading && rootSessions.map(session => {
      const childSessions = childSessionsByParentSessionId[session.id] ?? [];
      const visibleChildSessions = childSessionVisibilityByParentSessionId.visible[session.id] ?? [];
      const hiddenChildrenByAge = childSessionVisibilityByParentSessionId.hiddenByAgeCount[session.id] ?? 0;
      const parentSearchMatch = sessionSearchNeedle
        ? parentSessionSearchMatchBySessionId.get(session.id) === true
        : false;
      const matchingVisibleChildCount = sessionSearchNeedle
        ? visibleChildSessions.filter(child => childSessionSearchMatchBySessionId.get(child.id) === true).length
        : 0;
      const hasChildren = childSessions.length > 0;
      const inFlightRuns = inFlightBackgroundRunsBySession[session.id] ?? [];
      const expanded = Boolean(expandedSessionGroupsById[session.id]);
      return (
        <div
          key={session.id}
          className="space-y-2 rounded-xl border border-border bg-muted/70 p-2 transition data-[active=true]:border-primary/40 data-[active=true]:bg-primary/10 data-[search-match=true]:border-amber-500/40 data-[search-match=true]:bg-amber-500/5"
          data-active={activeSessionId === session.id}
          data-search-match={parentSearchMatch}
        >
          <button
            type="button"
            onClick={() => setActiveSessionId(session.id)}
            className="w-full rounded-lg p-1.5 text-left transition hover:bg-muted"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="line-clamp-2 break-words font-display text-sm">{session.title}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground" title={session.model}>
                  {session.model}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {parentSearchMatch && <Badge variant="warning">match</Badge>}
                {matchingVisibleChildCount > 0 && (
                  <Badge variant="outline">{matchingVisibleChildCount} child match</Badge>
                )}
                {hasChildren && <Badge variant="outline">{childSessions.length} child</Badge>}
                <Badge variant={session.status === "active" ? "success" : "warning"}>{session.status}</Badge>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {session.messageCount} msgs • {formatTimestampSummary(session.lastActiveAt)}
              {inFlightRuns.length > 0 ? ` • ${inFlightRuns.length} bg running` : ""}
            </p>
          </button>

          {hasChildren && (
            <div className="space-y-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-full justify-start px-2 text-xs text-muted-foreground"
                onClick={() => toggleSessionGroup(session.id)}
              >
                {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                {expanded ? "Hide child sessions" : "Show child sessions"}
              </Button>
              {expanded && (
                <div className="space-y-2 border-l border-border/70 pl-2">
                  {visibleChildSessions.map(childSession => {
                    const childRun = latestBackgroundRunByChildSessionId.get(childSession.id) ?? null;
                    const childRunInFlight = childRun ? isBackgroundRunInFlight(childRun) : false;
                    const childSearchMatch = sessionSearchNeedle
                      ? childSessionSearchMatchBySessionId.get(childSession.id) === true
                      : false;
                    const checkInBusy = childRun ? Boolean(backgroundCheckInBusyByRun[childRun.runId]) : false;
                    const steerBusy = childRun ? backgroundActionBusyByRun[childRun.runId] === "steer" : false;
                    const nudgeDraft = childRun ? (backgroundSteerDraftByRun[childRun.runId] ?? "") : "";
                    return (
                      <div
                        key={childSession.id}
                        className="space-y-2 rounded-md border border-border/70 bg-background/60 p-2 data-[active=true]:border-primary/40 data-[active=true]:bg-primary/10 data-[search-match=true]:border-amber-500/40 data-[search-match=true]:bg-amber-500/5"
                        data-active={activeSessionId === childSession.id}
                        data-search-match={childSearchMatch}
                      >
                        <button
                          type="button"
                          onClick={() => setActiveSessionId(childSession.id)}
                          className="w-full rounded-md p-1 text-left transition hover:bg-muted"
                        >
                          <div className="space-y-1">
                            <p className="line-clamp-2 break-words text-xs font-medium leading-tight">
                              {childSession.title}
                            </p>
                            <div className="flex flex-wrap items-center gap-1">
                              {childSearchMatch && <Badge variant="warning">match</Badge>}
                              {childRun && (
                                <Badge variant={childRunInFlight ? "warning" : "outline"}>
                                  {childRun.status}
                                </Badge>
                              )}
                              <Badge variant={childSession.status === "active" ? "success" : "outline"}>
                                {childSession.status}
                              </Badge>
                            </div>
                          </div>
                          {childRun?.prompt && (
                            <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                              {childRun.prompt}
                            </p>
                          )}
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {childSession.messageCount} msgs • {formatTimestampSummary(childSession.lastActiveAt)}
                          </p>
                        </button>
                        {childRun && (
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => {
                                void checkInBackgroundRun(childRun);
                              }}
                              disabled={checkInBusy}
                            >
                              {checkInBusy ? "Opening..." : "Open"}
                            </Button>
                            {childRunInFlight && (
                              <>
                                <Input
                                  value={nudgeDraft}
                                  onChange={event =>
                                    setBackgroundSteerDraftByRun(current => ({
                                      ...current,
                                      [childRun.runId]: event.target.value,
                                    }))
                                  }
                                  className="h-7 text-[11px]"
                                  placeholder="Nudge..."
                                  disabled={steerBusy}
                                />
                                <Button
                                  type="button"
                                  size="sm"
                                  className="h-7 px-2 text-[11px]"
                                  onClick={() => {
                                    void steerBackgroundRun(childRun.runId);
                                  }}
                                  disabled={steerBusy || !nudgeDraft.trim()}
                                >
                                  {steerBusy ? "..." : "Nudge"}
                                </Button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {visibleChildSessions.length === 0 && (
                    <p className="rounded-md border border-border/70 bg-background/60 px-2 py-1.5 text-[11px] text-muted-foreground">
                      No child sessions visible with current filters.
                    </p>
                  )}
                  {hiddenChildrenByAge > 0 && !showAllChildren && (
                    <p className="text-[11px] text-muted-foreground">
                      {hiddenChildrenByAge} old child session{hiddenChildrenByAge === 1 ? "" : "s"} hidden by age
                      filter ({childSessionHideAfterDays}d).
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      );
    })}
  </CardContent>
</Card>

<Card className="panel-noise flex min-h-0 flex-col">
  <CardHeader>
    <CardTitle className="flex items-center gap-2">
      <Activity className="size-4" />
      {activeSession?.title ?? "Chat"}
    </CardTitle>
    <CardDescription>Chat with the selected OpenCode session.</CardDescription>
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <label htmlFor="session-model" className="text-xs font-medium text-muted-foreground">
        Model
      </label>
      <div className="relative w-full max-w-sm" ref={modelPickerRef}>
        <button
          id="session-model"
          type="button"
          onClick={() => setIsModelPickerOpen(open => !open)}
          disabled={!activeSession || isSavingModel || loadingModels || availableModels.length === 0}
          className="flex h-9 w-full items-center justify-between rounded-md border border-border bg-background px-2 text-left text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring/70 disabled:opacity-50"
          aria-expanded={isModelPickerOpen}
          aria-haspopup="listbox"
        >
          <span className="truncate">{selectedModelLabel}</span>
          <ChevronsUpDown className="size-4 text-muted-foreground" />
        </button>
        {isModelPickerOpen && (
          <div className="absolute z-30 mt-1 w-full rounded-lg border border-border bg-card p-2 shadow-lg">
            <Input
              ref={modelSearchInputRef}
              value={modelQuery}
              onChange={event => setModelQuery(event.target.value)}
              onKeyDown={handleModelSearchKeyDown}
              placeholder="Search model..."
              className="h-8"
            />
            <div className="mt-2 max-h-64 overflow-y-auto" role="listbox">
              {filteredModelOptions.length === 0 ? (
                <p className="px-2 py-2 text-xs text-muted-foreground">No models match your search.</p>
              ) : (
                filteredModelOptions.map((option, index) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      void selectModelFromPicker(option.id);
                    }}
                    className={cn(
                      "w-full rounded-md px-2 py-1.5 text-left text-sm transition",
                      index === focusedModelIndex ? "bg-primary/10" : "hover:bg-muted",
                    )}
                    data-active={activeSession?.model === option.id}
                  >
                    <p className="truncate">{option.label}</p>
                    <p className="truncate text-xs text-muted-foreground">{option.id}</p>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
      {isSavingModel && <p className="text-xs text-muted-foreground">Saving model...</p>}
      {activeSession && runtimeDefaultModel && (
        <Badge variant={sessionMatchesRuntimeDefault ? "success" : "warning"}>
          default {sessionMatchesRuntimeDefault ? "synced" : "drift"}
        </Badge>
      )}
      {activeSession && runtimeDefaultModel && !sessionMatchesRuntimeDefault && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            void syncRuntimeDefaultToActiveModel();
          }}
          disabled={isSyncingRuntimeDefaultModel || isSavingModel}
        >
          <RefreshCcw className="size-3.5" />
          {isSyncingRuntimeDefaultModel ? "Syncing default..." : "Sync default"}
        </Button>
      )}
      <Badge
        variant={
          activeRunStatusLabel === "idle"
            ? "success"
            : activeRunStatusLabel === "retry"
              ? "warning"
              : "outline"
        }
      >
        run {activeRunStatusLabel}
      </Badge>
      <Badge variant={activeBackgroundInFlightCount > 0 ? "warning" : "outline"}>
        bg {activeBackgroundInFlightCount}
      </Badge>
      <Button
        type="button"
        size="sm"
        variant={showThinkingDetails ? "default" : "outline"}
        onClick={() => setShowThinkingDetails(current => !current)}
      >
        <Brain className="size-3.5" />
        Thinking
      </Button>
      <Button
        type="button"
        size="sm"
        variant={showToolCallDetails ? "default" : "outline"}
        onClick={() => setShowToolCallDetails(current => !current)}
      >
        <Wrench className="size-3.5" />
        Tools
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={requestAbortRun}
        disabled={!canAbortActiveSession}
      >
        <CircleSlash className="size-3.5" />
        {isAborting ? "Aborting..." : "Abort"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          if (!activeSession) return;
          void refreshBackgroundRunsForSession(activeSession.id);
        }}
        disabled={!activeSession || loadingBackgroundRuns}
      >
        <RefreshCcw className="size-3.5" />
        {loadingBackgroundRuns ? "Refreshing..." : "Refresh BG"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          if (!activeSession) return;
          void compactSession(activeSession.id);
        }}
        disabled={!activeSession || isCompacting || isActiveSessionRunning}
      >
        <Scissors className="size-3.5" />
        {isCompacting ? "Compacting..." : "Compact"}
      </Button>
    </div>
    {modelError && <p className="text-xs text-destructive">{modelError}</p>}
    {activeSession && runtimeDefaultModel && (
      <p className="text-xs text-muted-foreground">
        session: {activeSession.model} · runtime default: {runtimeDefaultModel}
      </p>
    )}
    {activeRunStatusHint && <p className="text-xs text-muted-foreground">{activeRunStatusHint}</p>}
    {activeSessionRunError && <p className="text-xs text-destructive">{activeSessionRunError}</p>}
    {backgroundRunsError && <p className="text-xs text-destructive">{backgroundRunsError}</p>}
    {chatControlError && <p className="text-xs text-destructive">{chatControlError}</p>}
    {activeSessionCompactedAt && (
      <p className="text-xs text-muted-foreground">Last compacted {formatTimestampSummary(activeSessionCompactedAt)}</p>
    )}
  </CardHeader>
  <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
    <div
      className="scrollbar-thin relative flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-input/50 p-3"
      ref={chatScrollRef}
    >
      {hasNewMessages && isUserScrolledUp && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="sticky top-2 z-10 mx-auto rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg transition hover:bg-primary/85"
        >
          New messages
        </button>
      )}
      {loadingMessages && <p className="text-sm text-muted-foreground">Loading messages...</p>}
      {!loadingMessages && activeMessages.length === 0 && <p className="text-sm text-muted-foreground">No messages yet.</p>}
      {activeMessages.map(message => {
        const messageContent = sanitizeMessageContentForDisplay(message.role, message.content);
        const hideMirroredAssistantContent = shouldHideMirroredAssistantContent(message, showThinkingDetails);
        const renderedMessageContent = hideMirroredAssistantContent ? "" : messageContent;
        const isOptimisticUser = message.uiMeta?.type === "optimistic-user";
        const pendingMeta = message.uiMeta?.type === "assistant-pending" ? message.uiMeta : null;
        const isPending = pendingMeta?.status === "pending";
        const isQueued = pendingMeta?.status === "queued";
        const isDetached = pendingMeta?.status === "detached";
        const isFailed = pendingMeta?.status === "failed";
        const visibleTimelineParts =
          message.role === "assistant"
            ? sortPartsChronologically(
                (message.parts ?? []).filter(part => {
                  if (part.type === "thinking") return showThinkingDetails;
                  if (part.type === "tool_call") return showToolCallDetails;
                  return false;
                }),
                message.at,
              )
            : [];
        const shouldRenderMessageRow =
          message.role !== "assistant" ||
          isPending ||
          isQueued ||
          isDetached ||
          isFailed ||
          Boolean(renderedMessageContent.trim()) ||
          Boolean(message.memoryTrace);
        const messageTimestamp = formatCompactTimestamp(message.at) || relativeFromIso(message.at);

        return (
          <div key={message.id} className="flex flex-col gap-2">
            {visibleTimelineParts.map(part => {
              const partIso = resolvePartTimestamp(part, message.at);
              const partTimestamp = formatCompactTimestamp(partIso) || relativeFromIso(partIso);
              const elapsed = formatElapsedFrom(message.at, partIso);

              if (part.type === "thinking") {
                return (
                  <article
                    key={`${message.id}-part-${part.id}`}
                    className="max-w-[92%] self-start rounded-xl border border-border bg-muted/80 px-3 py-2 text-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium uppercase tracking-wide text-[10px] text-muted-foreground">thinking</p>
                      <p className="text-[10px] text-muted-foreground">
                        {elapsed ? `${elapsed} · ` : ""}
                        {partTimestamp}
                      </p>
                    </div>
                    <MarkdownMessage className="mt-1" content={part.text} isStreaming={isPending} variant="thinking" />
                  </article>
                );
              }

              const detailsInput = stringifyToolInput(part.input);
              const hasDetails = Boolean(detailsInput || part.output || part.error);
              return (
                <article
                  key={`${message.id}-part-${part.id}`}
                  className="max-w-[92%] self-start rounded-xl border border-border bg-muted/80 px-3 py-2 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium uppercase tracking-wide text-[10px] text-muted-foreground">
                      tool · {part.tool}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {elapsed ? `${elapsed} · ` : ""}
                      {partTimestamp}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">status: {part.status}</p>
                  {hasDetails && (
                    <details className="mt-2 rounded border border-border/50 bg-background/60 p-1">
                      <summary className="cursor-pointer text-[11px] text-muted-foreground">details</summary>
                      {detailsInput && (
                        <>
                          <p className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">input</p>
                          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[10px] text-muted-foreground">
                            {detailsInput}
                          </pre>
                        </>
                      )}
                      {part.output && (
                        <>
                          <p className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">output</p>
                          <p className="mt-1 whitespace-pre-wrap text-[10px] text-muted-foreground">{part.output}</p>
                        </>
                      )}
                      {part.error && (
                        <>
                          <p className="mt-2 text-[10px] uppercase tracking-wide text-destructive">error</p>
                          <p className="mt-1 whitespace-pre-wrap text-[10px] text-destructive">{part.error}</p>
                        </>
                      )}
                    </details>
                  )}
                </article>
              );
            })}
            {shouldRenderMessageRow && (
              <article
                className="max-w-[92%] rounded-xl border border-border px-3 py-2 text-sm data-[role=assistant]:self-start data-[role=assistant]:bg-muted/80 data-[role=user]:self-end data-[role=user]:bg-primary/20"
                data-role={message.role}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium uppercase tracking-wide text-[10px] text-muted-foreground">{message.role}</p>
                  <div className="flex items-center gap-2">
                    {isOptimisticUser && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                        <LoaderCircle className="size-3 animate-spin" />
                        submitted
                      </span>
                    )}
                    {isPending && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                        <LoaderCircle className="size-3 animate-spin" />
                        working
                      </span>
                    )}
                    {isQueued && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                        queued
                      </span>
                    )}
                    {isDetached && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                        background
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground" title={message.at}>
                      {messageTimestamp}
                    </span>
                  </div>
                </div>
                {isPending && (
                  <div className="mt-1 space-y-2">
                    <p className="inline-flex items-center gap-2 leading-relaxed text-muted-foreground">
                      <LoaderCircle className="size-4 animate-spin" />
                      OpenCode is responding...
                    </p>
                    {renderedMessageContent && (
                      <MarkdownMessage
                        className="mt-1 text-foreground"
                        content={renderedMessageContent}
                        isStreaming={message.role === "assistant" && isPending}
                      />
                    )}
                  </div>
                )}
                {isFailed && pendingMeta && (
                  <div className="mt-1 space-y-2">
                    <p className="inline-flex items-center gap-2 leading-relaxed text-destructive">
                      <AlertTriangle className="size-4" />
                      Failed to send request.
                    </p>
                    {renderedMessageContent && (
                      <MarkdownMessage className="mt-1 text-foreground" content={renderedMessageContent} isStreaming={false} />
                    )}
                    {pendingMeta.errorMessage && (
                      <p className="text-xs text-muted-foreground">{pendingMeta.errorMessage}</p>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => retryFailedRequest(pendingMeta.requestId)}
                      disabled={isSending}
                    >
                      <RefreshCcw className="size-3.5" />
                      Retry
                    </Button>
                  </div>
                )}
                {isDetached && pendingMeta && (
                  <div className="mt-1 space-y-2">
                    <p className="inline-flex items-center gap-2 leading-relaxed text-muted-foreground">
                      <LoaderCircle className="size-4 animate-spin" />
                      Run still active in background.
                    </p>
                    {pendingMeta.errorMessage && (
                      <p className="text-xs text-muted-foreground">{pendingMeta.errorMessage}</p>
                    )}
                    {renderedMessageContent && (
                      <MarkdownMessage className="mt-1 text-foreground" content={renderedMessageContent} isStreaming={false} />
                    )}
                  </div>
                )}
                {isQueued && pendingMeta && (
                  <div className="mt-1 space-y-2">
                    <p className="inline-flex items-center gap-2 leading-relaxed text-muted-foreground">
                      <LoaderCircle className="size-4 animate-spin" />
                      Queued behind the current run.
                    </p>
                    {pendingMeta.errorMessage && (
                      <p className="text-xs text-muted-foreground">{pendingMeta.errorMessage}</p>
                    )}
                    {renderedMessageContent && (
                      <MarkdownMessage className="mt-1 text-foreground" content={renderedMessageContent} isStreaming={false} />
                    )}
                  </div>
                )}
                {!isPending && !isQueued && !isDetached && !isFailed && (
                  <MarkdownMessage
                    className="mt-1"
                    content={renderedMessageContent}
                    isStreaming={false}
                    variant="message"
                  />
                )}
                {!isPending && !isQueued && !isDetached && !isFailed && message.role === "assistant" && message.memoryTrace && (
                  <div className="mt-2 space-y-1 rounded-md border border-border/70 bg-background/60 p-2 text-[11px]">
                    <p className="font-medium uppercase tracking-wide text-muted-foreground">
                      memory trace · {message.memoryTrace.mode}
                    </p>
                    <p className="text-muted-foreground">
                      injected results: {message.memoryTrace.injectedContextResults}
                    </p>
                    {message.memoryTrace.toolCalls.length > 0 && (
                      <div className="space-y-1">
                        {message.memoryTrace.toolCalls.map((call, index) => (
                          <p key={`${message.id}-trace-${index}`} className="text-muted-foreground">
                            {call.tool} · {call.status}
                            {call.summary ? ` · ${call.summary}` : ""}
                            {call.error ? ` · ${call.error}` : ""}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </article>
            )}
          </div>
        );
      })}
    </div>

    <form className="space-y-2" onSubmit={sendMessage} ref={composerFormRef} aria-busy={isSending}>
      {draftAttachments.length > 0 && (
        <div className="flex flex-wrap gap-2 rounded-md border border-border/70 bg-muted/40 p-2">
          {draftAttachments.map(attachment => (
            <div key={attachment.id} className="flex items-center gap-2 rounded-md bg-background px-2 py-1 text-xs">
              <span className="max-w-44 truncate">{attachment.filename ?? attachment.mime}</span>
              <span className="text-muted-foreground">{Math.ceil(attachment.size / 1024)}KB</span>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => removeComposerAttachment(attachment.id)}
                disabled={isSending}
                aria-label="Remove attachment"
              >
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
        onPaste={event => {
          void handleComposerPaste(event);
        }}
        placeholder={isSending ? "Waiting for response..." : "Send a message to the active session..."}
        disabled={isSending}
        className="min-h-24 resize-y"
      />
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {isSending ? "Working on your request..." : "Enter to send, Shift+Enter for newline. Paste images to attach."}
        </p>
        <Button type="submit" disabled={isSending || (!draftMessage.trim() && draftAttachments.length === 0)}>
          <Send className="size-4" />
          {isSending ? "Sending..." : "Send"}
        </Button>
      </div>
    </form>
  </CardContent>
</Card>

<Card className="panel-noise flex min-h-0 flex-col">
  <CardHeader>
    <CardTitle className="flex items-center gap-2">
      <Wrench className="size-4" />
      OpenCode Config
    </CardTitle>
    <CardDescription>Manage skill/MCP config and monitor usage telemetry.</CardDescription>
  </CardHeader>
  <CardContent className="min-h-0 overflow-y-auto">
              <Tabs
                value={activeConfigPanelTab}
                onValueChange={value => setActiveConfigPanelTab(value)}
              >
      <TabsList className="w-full justify-between">
        <TabsTrigger value="usage">Usage</TabsTrigger>
        <TabsTrigger value="memory">Memory</TabsTrigger>
        <TabsTrigger value="background">Background</TabsTrigger>
      </TabsList>

      <TabsContent value="usage" className="space-y-2">
        <div className="rounded-lg border border-border bg-muted/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Requests</p>
          <p className="mt-1 font-display text-2xl">{usage.requestCount.toLocaleString()}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-border bg-muted/70 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Input tokens</p>
            <p className="mt-1 text-base font-semibold">{usage.inputTokens.toLocaleString()}</p>
          </div>
          <div className="rounded-lg border border-border bg-muted/70 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Output tokens</p>
            <p className="mt-1 text-base font-semibold">{usage.outputTokens.toLocaleString()}</p>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-muted/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Estimated cost</p>
          <p className="mt-1 flex items-center gap-1 text-xl font-semibold">
            <Cpu className="size-4 text-muted-foreground" />${usage.estimatedCostUsd.toFixed(4)}
          </p>
        </div>
      </TabsContent>

      <TabsContent value="memory" className="space-y-2">
        {memoryError && <p className="text-xs text-destructive">{memoryError}</p>}
        <div className="rounded-lg border border-border bg-muted/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Mode</p>
          <p className="mt-1 flex items-center gap-2 text-sm font-semibold">
            <BookOpen className="size-4 text-muted-foreground" />
            {memoryStatus?.toolMode ?? "unknown"}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-border bg-muted/70 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Files</p>
            <p className="mt-1 text-base font-semibold">{memoryStatus?.files ?? 0}</p>
          </div>
          <div className="rounded-lg border border-border bg-muted/70 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Chunks</p>
            <p className="mt-1 text-base font-semibold">{memoryStatus?.chunks ?? 0}</p>
          </div>
          <div className="rounded-lg border border-border bg-muted/70 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Records</p>
            <p className="mt-1 text-base font-semibold">{memoryStatus?.records ?? 0}</p>
          </div>
          <div className="rounded-lg border border-border bg-muted/70 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Cache</p>
            <p className="mt-1 text-base font-semibold">{memoryStatus?.cacheEntries ?? 0}</p>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-muted/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Recent writes</p>
          {memoryActivity.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">No memory write activity yet.</p>
          ) : (
            <div className="mt-2 space-y-2">
              {memoryActivity.slice(0, 6).map(event => (
                <div key={event.id} className="rounded-md border border-border/70 bg-background/60 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {event.status}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{formatTimestampSummary(event.createdAt)}</p>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed">{event.content}</p>
                  {event.status === "rejected" && (
                    <p className="mt-1 text-[11px] text-destructive">{event.reason}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </TabsContent>

      <TabsContent value="background" className="space-y-3">
        <div className="rounded-lg border border-border bg-muted/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Spawn background run</p>
          <Textarea
            value={backgroundPrompt}
            onChange={event => setBackgroundPrompt(event.target.value)}
            className="mt-2 min-h-20 resize-y"
            placeholder="Describe a background task for this session..."
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              Runs are attached to this session and report back automatically.
            </p>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                void spawnBackgroundRun();
              }}
              disabled={!activeSession || !backgroundPrompt.trim() || backgroundSpawnBusy}
            >
              <Plus className="size-3.5" />
              {backgroundSpawnBusy ? "Spawning..." : "Spawn"}
            </Button>
          </div>
        </div>

        {loadingBackgroundRuns && (
          <p className="rounded-md border border-border bg-muted/70 p-3 text-xs text-muted-foreground">
            Loading background runs...
          </p>
        )}

        {!loadingBackgroundRuns && activeBackgroundRuns.length === 0 && (
          <p className="rounded-md border border-border bg-muted/70 p-3 text-xs text-muted-foreground">
            No background runs for this session yet.
          </p>
        )}

        {activeBackgroundRuns.map(run => {
          const isTerminal =
            run.status === "completed" || run.status === "failed" || run.status === "aborted";
          const busyAction = backgroundActionBusyByRun[run.runId];
          return (
            <div
              key={run.runId}
              className="space-y-2 rounded-md border border-border bg-muted/70 p-3 data-[focused=true]:border-primary/40 data-[focused=true]:bg-primary/10"
              data-focused={focusedBackgroundRunId === run.runId}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs font-medium">{run.runId}</p>
                <Badge
                  variant={
                    run.status === "completed"
                      ? "success"
                      : run.status === "failed" || run.status === "aborted"
                        ? "warning"
                        : "outline"
                  }
                >
                  {run.status}
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">
                created {formatTimestampSummary(run.createdAt)}
                {run.startedAt ? ` · started ${formatTimestampSummary(run.startedAt)}` : ""}
                {run.completedAt ? ` · completed ${formatTimestampSummary(run.completedAt)}` : ""}
                {` · updated ${formatTimestampSummary(run.updatedAt)}`}
              </p>
              {run.prompt && <p className="text-xs">prompt: {run.prompt}</p>}
              {run.resultSummary && <p className="text-xs text-muted-foreground">result: {run.resultSummary}</p>}
              {run.error && <p className="text-xs text-destructive">{run.error}</p>}

              <div className="space-y-2">
                {!isTerminal && (
                  <>
                    <Textarea
                      value={backgroundSteerDraftByRun[run.runId] ?? ""}
                      onChange={event =>
                        setBackgroundSteerDraftByRun(current => ({
                          ...current,
                          [run.runId]: event.target.value,
                        }))
                      }
                      className="min-h-16 max-h-48 resize-y"
                      placeholder="Steer this background run with additional instructions..."
                      disabled={busyAction === "abort"}
                    />
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => requestAbortBackgroundRun(run.runId)}
                        disabled={Boolean(busyAction)}
                      >
                        <CircleSlash className="size-3.5" />
                        {busyAction === "abort" ? "Aborting..." : "Abort"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          void steerBackgroundRun(run.runId);
                        }}
                        disabled={
                          busyAction === "abort" ||
                          !(backgroundSteerDraftByRun[run.runId]?.trim())
                        }
                      >
                        <Send className="size-3.5" />
                        {busyAction === "steer" ? "Sending..." : "Steer"}
                      </Button>
                    </div>
                  </>
                )}
                {isTerminal && (
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (run.childSessionId) {
                          void refreshSessionsList();
                          setActiveSessionId(run.childSessionId);
                        } else {
                          setActiveSessionId(run.parentSessionId);
                          setActiveConfigPanelTab("background");
                        }
                      }}
                    >
                      View session
                    </Button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </TabsContent>
    </Tabs>
  </CardContent>
</Card>
</section>

  );
}

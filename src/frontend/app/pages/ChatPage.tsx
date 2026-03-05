import {
  Brain,
  ChevronsUpDown,
  CircleSlash,
  RefreshCcw,
  Scissors,
  Wrench,
} from "lucide-react";
import {
  type ClipboardEvent as ReactClipboardEvent,
  type Dispatch,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  type SetStateAction,
  useMemo,
} from "react";

import { Input } from "@/components/ui/input";
import type { LocalChatMessage } from "@/frontend/app/chatHelpers";
import { cn } from "@/frontend/app/dashboardUtils";
import type { ComposerAttachment } from "@/frontend/app/useChatSession";
import { ComposerDock } from "@/frontend/opencode-react/app/Composer/ComposerDock";
import { PermissionPromptDock } from "@/frontend/opencode-react/app/Composer/PermissionPromptDock";
import { QuestionPromptDock } from "@/frontend/opencode-react/app/Composer/QuestionPromptDock";
import { RightFlyout } from "@/frontend/opencode-react/app/Flyout/RightFlyout";
import { SessionTree } from "@/frontend/opencode-react/app/Sidebar/SessionTree";
import { MessageTimeline } from "@/frontend/opencode-react/app/Timeline/MessageTimeline";
import type { SessionScreenLayoutVM } from "@/frontend/opencode-react/types";
import type {
  BackgroundRunSnapshot,
  MemoryStatusSnapshot,
  MemoryWriteEvent,
  ModelOption,
  PermissionPromptRequest,
  QuestionPromptRequest,
  SessionSummary,
  UsageSnapshot,
} from "@/types/dashboard";

type ConfigPanelTab = "usage" | "memory" | "background";

function formatTimestampSummary(iso: string): string {
  const compact = new Date(iso).toLocaleString();
  return compact || iso;
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
  promptBlocked: boolean;
  activePermissionRequest?: PermissionPromptRequest;
  activeQuestionRequest?: QuestionPromptRequest;
  promptBusyRequestId: string;
  promptError: string;
  onPermissionPromptReply: (
    requestId: string,
    sessionId: string,
    reply: "once" | "always" | "reject",
  ) => Promise<void>;
  onQuestionPromptReply: (requestId: string, sessionId: string, answers: Array<Array<string>>) => Promise<void>;
  onQuestionPromptReject: (requestId: string, sessionId: string) => Promise<void>;
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

export function ChatPage({ model, layout }: { model: ChatPageModel; layout?: SessionScreenLayoutVM }) {
  const {
    activeBackgroundInFlightCount,
    activeBackgroundRuns,
    activeMessages,
    activeRunStatusHint,
    activeRunStatusLabel,
    activeSession,
    activeSessionCompactedAt,
    activeSessionId,
    activeSessionRunError,
    availableModels,
    backgroundActionBusyByRun,
    backgroundPrompt,
    backgroundRunsError,
    backgroundSpawnBusy,
    backgroundSteerDraftByRun,
    canAbortActiveSession,
    chatControlError,
    chatScrollRef,
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
    memoryActivity,
    memoryError,
    memoryStatus,
    modelError,
    promptBlocked,
    activePermissionRequest,
    activeQuestionRequest,
    promptBusyRequestId,
    promptError,
    onPermissionPromptReply,
    onQuestionPromptReply,
    onQuestionPromptReject,
    modelPickerRef,
    modelQuery,
    modelSearchInputRef,
    parentSessionSearchMatchBySessionId,
    refreshBackgroundRunsForSession,
    refreshInFlightBackgroundRuns,
    requestAbortBackgroundRun,
    requestAbortRun,
    retryFailedRequest,
    removeComposerAttachment,
    rootSessions,
    scrollToBottom,
    selectModelFromPicker,
    selectedModelLabel,
    sessionMatchesRuntimeDefault,
    sendMessage,
    sessionError,
    sessionSearchNeedle,
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

  const visibleMessages = useMemo(() => activeMessages, [activeMessages]);

  const sidebarOpen = layout?.sidebarOpen ?? true;
  const flyoutOpen = layout?.flyoutOpen ?? true;

  return (
    <section
      className="oc-session-layout"
      data-sidebar-open={sidebarOpen}
      data-flyout-open={flyoutOpen}
      data-chat-fullscreen={!sidebarOpen && !flyoutOpen}
    >
      {sidebarOpen && (
        <SessionTree
          activeSessionId={activeSessionId}
          rootSessions={rootSessions}
          loading={loading}
          sessionError={sessionError}
          sessionSearchNeedle={sessionSearchNeedle}
          totalSessionSearchMatches={totalSessionSearchMatches}
          childSessionSearchQuery={childSessionSearchQuery}
          setChildSessionSearchQuery={setChildSessionSearchQuery}
          showAllChildren={showAllChildren}
          setShowAllChildren={setShowAllChildren}
          totalHiddenChildSessionsByAge={totalHiddenChildSessionsByAge}
          totalInFlightBackgroundRuns={totalInFlightBackgroundRuns}
          createNewSession={createNewSession}
          isCreatingSession={isCreatingSession}
          refreshInFlightBackgroundRuns={refreshInFlightBackgroundRuns}
          setActiveSessionId={setActiveSessionId}
          childSessionsByParentSessionId={childSessionsByParentSessionId}
          childSessionVisibilityByParentSessionId={childSessionVisibilityByParentSessionId}
          expandedSessionGroupsById={expandedSessionGroupsById}
          toggleSessionGroup={toggleSessionGroup}
          parentSessionSearchMatchBySessionId={parentSessionSearchMatchBySessionId}
          childSessionSearchMatchBySessionId={childSessionSearchMatchBySessionId}
          childSessionHideAfterDays={childSessionHideAfterDays}
          inFlightBackgroundRunsBySession={inFlightBackgroundRunsBySession}
          latestBackgroundRunByChildSessionId={latestBackgroundRunByChildSessionId}
          backgroundActionBusyByRun={backgroundActionBusyByRun}
          backgroundSteerDraftByRun={backgroundSteerDraftByRun}
          setBackgroundSteerDraftByRun={setBackgroundSteerDraftByRun}
          steerBackgroundRun={steerBackgroundRun}
        />
      )}

      <section className="oc-session-center">
        <header className="oc-session-header">
          <div className="oc-session-header-main">
            <h2 className="oc-session-title">{activeSession?.title ?? "Main"}</h2>
            <p className="oc-session-subtitle">Model {activeSession?.model ?? "-"}</p>
          </div>
        </header>

        {(modelError ||
          promptError ||
          activeRunStatusHint ||
          activeSessionRunError ||
          backgroundRunsError ||
          chatControlError ||
          activeSessionCompactedAt) && (
          <div className="oc-session-meta-errors">
            {modelError && <p className="text-xs text-destructive">{modelError}</p>}
            {promptError && <p className="text-xs text-destructive">{promptError}</p>}
            {activeRunStatusHint && <p className="text-xs text-muted-foreground">{activeRunStatusHint}</p>}
            {activeSessionRunError && <p className="text-xs text-destructive">{activeSessionRunError}</p>}
            {backgroundRunsError && <p className="text-xs text-destructive">{backgroundRunsError}</p>}
            {chatControlError && <p className="text-xs text-destructive">{chatControlError}</p>}
            {activeSessionCompactedAt && <p className="text-xs text-muted-foreground">Last compacted {formatTimestampSummary(activeSessionCompactedAt)}</p>}
          </div>
        )}

        <MessageTimeline
          messages={visibleMessages}
          chatScrollRef={chatScrollRef}
          hasNewMessages={hasNewMessages}
          isUserScrolledUp={isUserScrolledUp}
          scrollToBottom={scrollToBottom}
          loadingMessages={loadingMessages}
          showThinkingDetails={showThinkingDetails}
          showToolCallDetails={showToolCallDetails}
          retryFailedRequest={retryFailedRequest}
        />

        {activePermissionRequest ? (
          <PermissionPromptDock
            request={activePermissionRequest}
            isBusy={promptBusyRequestId === activePermissionRequest.id}
            onReply={reply => onPermissionPromptReply(activePermissionRequest.id, activePermissionRequest.sessionId, reply)}
          />
        ) : activeQuestionRequest ? (
          <QuestionPromptDock
            request={activeQuestionRequest}
            isBusy={promptBusyRequestId === activeQuestionRequest.id}
            onReply={answers => onQuestionPromptReply(activeQuestionRequest.id, activeQuestionRequest.sessionId, answers)}
            onDismiss={() => onQuestionPromptReject(activeQuestionRequest.id, activeQuestionRequest.sessionId)}
          />
        ) : (
          <>
            <ComposerDock
              composerFormRef={composerFormRef}
              sendMessage={sendMessage}
              isSending={isSending}
              draftMessage={draftMessage}
              setDraftMessage={setDraftMessage}
              draftAttachments={draftAttachments}
              removeComposerAttachment={removeComposerAttachment}
              handleComposerKeyDown={handleComposerKeyDown}
              handleComposerPaste={handleComposerPaste}
            />
            <div className="oc-composer-footer">
              <div className="oc-composer-footer-controls">
                <div className="oc-model-picker" ref={modelPickerRef}>
                  <button
                    type="button"
                    className="oc-model-picker-trigger"
                    onClick={() => setIsModelPickerOpen(v => !v)}
                    disabled={!activeSession || isSavingModel || availableModels.length === 0}
                  >
                    <span className="truncate">{selectedModelLabel}</span>
                    <ChevronsUpDown className="size-4" />
                  </button>
                  {isModelPickerOpen && (
                    <div className="oc-model-picker-menu oc-model-picker-menu-up">
                      <Input
                        ref={modelSearchInputRef}
                        value={modelQuery}
                        onChange={event => setModelQuery(event.target.value)}
                        onKeyDown={handleModelSearchKeyDown}
                        placeholder="Search model"
                        className="h-8"
                      />
                      <div className="oc-model-picker-list">
                        {filteredModelOptions.map((option, index) => (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => void selectModelFromPicker(option.id)}
                            className={cn("oc-model-option", index === focusedModelIndex && "oc-model-option-active")}
                          >
                            <p className="truncate">{option.label}</p>
                            <p className="truncate text-xs text-muted-foreground">{option.id}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <span className="oc-status-pill" data-status={sessionMatchesRuntimeDefault ? "active" : "warning"}>
                  default {sessionMatchesRuntimeDefault ? "synced" : "drift"}
                </span>
                {!sessionMatchesRuntimeDefault && (
                  <button type="button" className="oc-inline-btn" onClick={() => void syncRuntimeDefaultToActiveModel()} disabled={isSyncingRuntimeDefaultModel}>
                    <RefreshCcw className="size-3.5" />
                    Sync
                  </button>
                )}
                <span className="oc-status-pill" data-status={activeRunStatusLabel === "idle" ? "active" : "idle"}>run {activeRunStatusLabel}</span>
                <span className="oc-status-pill" data-status={activeBackgroundInFlightCount > 0 ? "warning" : "idle"}>bg {activeBackgroundInFlightCount}</span>
                <button type="button" className="oc-inline-btn" data-active={showThinkingDetails} onClick={() => setShowThinkingDetails(v => !v)}>
                  <Brain className="size-3.5" /> Thinking
                </button>
                <button type="button" className="oc-inline-btn" data-active={showToolCallDetails} onClick={() => setShowToolCallDetails(v => !v)}>
                  <Wrench className="size-3.5" /> Tools
                </button>
                <button type="button" className="oc-inline-btn" onClick={requestAbortRun} disabled={!canAbortActiveSession}>
                  <CircleSlash className="size-3.5" /> {isAborting ? "Aborting..." : "Abort"}
                </button>
                <button
                  type="button"
                  className="oc-inline-btn"
                  onClick={() => activeSession && void refreshBackgroundRunsForSession(activeSession.id)}
                  disabled={!activeSession || loadingBackgroundRuns}
                >
                  <RefreshCcw className="size-3.5" /> Refresh
                </button>
                <button
                  type="button"
                  className="oc-inline-btn"
                  onClick={() => activeSession && void compactSession(activeSession.id)}
                  disabled={!activeSession || isCompacting || isActiveSessionRunning}
                >
                  <Scissors className="size-3.5" /> {isCompacting ? "Compacting..." : "Compact"}
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {flyoutOpen && (
        <RightFlyout
          activeSession={activeSession}
          usage={usage}
          memoryError={memoryError}
          memoryStatus={memoryStatus}
          memoryActivity={memoryActivity}
          backgroundPrompt={backgroundPrompt}
          setBackgroundPrompt={setBackgroundPrompt}
          backgroundSpawnBusy={backgroundSpawnBusy}
          spawnBackgroundRun={spawnBackgroundRun}
          activeBackgroundRuns={activeBackgroundRuns}
          backgroundActionBusyByRun={backgroundActionBusyByRun}
          backgroundSteerDraftByRun={backgroundSteerDraftByRun}
          setBackgroundSteerDraftByRun={setBackgroundSteerDraftByRun}
          requestAbortBackgroundRun={requestAbortBackgroundRun}
          steerBackgroundRun={steerBackgroundRun}
        />
      )}
    </section>
  );
}

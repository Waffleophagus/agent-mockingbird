import type {
  BackgroundRunSnapshot,
  ChatMessage,
  HeartbeatSnapshot,
  ModelOption,
  PermissionPromptRequest,
  QuestionPromptRequest,
  SessionSummary,
  UsageSnapshot,
} from "@agent-mockingbird/contracts/dashboard";

import type { ChatPageModel } from "@/frontend/app/pages/ChatPage";

export type SessionScreenMode = "chat" | "skills" | "mcp" | "agents" | "other" | "cron";

export interface SessionScreenTitlebarVM {
  streamStatus: "connecting" | "connected" | "reconnecting";
  heartbeatAt: string;
  activeScreen: SessionScreenMode;
  drawerOpen: boolean;
  sidePanelOpen: boolean;
  openScreen: (screen: SessionScreenMode) => void;
  toggleDrawer: () => void;
  toggleSidePanel: () => void;
  closePanels: () => void;
}

export interface SessionScreenLayoutVM {
  drawerOpen: boolean;
  sidePanelOpen: boolean;
  openDrawer: () => void;
  openSidePanel: () => void;
  closeDrawer: () => void;
  closeSidePanel: () => void;
}

export interface SessionScreenVM {
  activeScreen: SessionScreenMode;
  titlebar: SessionScreenTitlebarVM;
  layout: SessionScreenLayoutVM;
  chat: ChatPageModel;
}

export interface SessionScreenBootstrapResponse {
  sessions: SessionSummary[];
  activeSessionId: string;
  activeSession: SessionSummary | null;
  messages: ChatMessage[];
  usage: UsageSnapshot;
  heartbeat: HeartbeatSnapshot;
  models: ModelOption[];
  backgroundRuns: BackgroundRunSnapshot[];
  pendingPermissions?: PermissionPromptRequest[];
  pendingQuestions?: QuestionPromptRequest[];
  workspaceBootstrap?: {
    mode?: string;
    identity?: string;
    files?: Array<{
      name: string;
      missing: boolean;
      truncated: boolean;
    }>;
  };
  featureFlags?: {
    reviewEnabled?: boolean;
  };
}

export interface SessionContextResponse {
  session: {
    id: string;
    title: string;
    model: string;
    status: string;
    createdAt: string;
    lastActiveAt: string;
    messageCount: number;
  };
  metrics: {
    userMessages: number;
    assistantMessages: number;
    totalMessages: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
  contextBreakdown: {
    system: number;
    user: number;
    assistant: number;
    tools: number;
    other: number;
  };
}

export interface SessionReviewResponse {
  enabled: boolean;
  reason?: string;
  sessionId?: string;
  error?: string;
}

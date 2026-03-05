import type { ChatPageModel } from "@/frontend/app/pages/ChatPage";
import type { BackgroundRunSnapshot, ChatMessage, HeartbeatSnapshot, ModelOption, SessionSummary, UsageSnapshot } from "@/types/dashboard";

export type SessionScreenFlyoutTab = "review" | "context";

export interface SessionScreenTitlebarVM {
  streamStatus: "connecting" | "connected" | "reconnecting";
  heartbeatAt: string;
  sidebarOpen: boolean;
  flyoutOpen: boolean;
  toggleSidebar: () => void;
  toggleFlyout: () => void;
  closePanels: () => void;
}

export interface SessionScreenLayoutVM {
  sidebarOpen: boolean;
  flyoutOpen: boolean;
}

export interface SessionScreenVM {
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

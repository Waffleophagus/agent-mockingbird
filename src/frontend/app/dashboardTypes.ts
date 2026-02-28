import { legacySpecialistToAgentType } from "@/shared/agentTypes";
import type {
  AgentTypeDefinition,
  BackgroundRunSnapshot,
  DashboardBootstrap,
} from "@/types/dashboard";

export type AgentRunState = "queued" | "running" | "completed" | "failed";

export interface AgentRunSnapshot {
  id: string;
  sessionId: string;
  state: AgentRunState;
  error?: unknown;
}

export interface BackgroundRunsResponse {
  runs?: BackgroundRunSnapshot[];
  run?: BackgroundRunSnapshot;
  aborted?: boolean;
  error?: string;
}

export interface ConfigSnapshotResponse {
  hash?: string;
  config?: {
    runtime?: {
      opencode?: {
        providerId?: string;
        modelId?: string;
        fallbackModels?: string[];
        imageModel?: string | null;
        runWaitTimeoutMs?: number;
        childSessionHideAfterDays?: number;
      };
    };
    ui?: {
      agentTypes?: AgentTypeDefinition[];
    };
  };
}

export interface OpencodeAgentStorageResponse {
  directory?: string;
  configFilePath?: string;
  persistenceMode?: string;
}

export interface RuntimeInfoResponse {
  configAuthority?: {
    source?: string;
    path?: string;
    hash?: string;
  };
  opencode?: {
    directory?: string;
    effectiveConfigPath?: string;
    persistenceMode?: string;
    projection?: {
      source?: string;
      syncs?: string[];
    };
  };
}

export type ConfirmAction =
  | { type: "abort-run"; sessionId: string }
  | { type: "abort-background"; runId: string }
  | { type: "remove-skill"; skillId: string }
  | { type: "remove-mcp"; mcpId: string }
  | { type: "disconnect-mcp"; mcpId: string }
  | { type: "remove-agent"; agentId: string }
  | { type: "remove-cron"; jobId: string }
  | null;

export function fromLegacyAgent(agent: DashboardBootstrap["agents"][number]): AgentTypeDefinition {
  return legacySpecialistToAgentType(agent) as AgentTypeDefinition;
}

export function getConfirmDialogProps(confirmAction: ConfirmAction): {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  variant: "default" | "danger";
} {
  if (!confirmAction) {
    return { open: false, title: "", confirmLabel: "", variant: "default" };
  }

  switch (confirmAction.type) {
    case "abort-run":
      return {
        open: true,
        title: "Abort active run?",
        description: "This will cancel the current OpenCode request. The session state may be inconsistent.",
        confirmLabel: "Abort",
        variant: "danger",
      };
    case "abort-background":
      return {
        open: true,
        title: "Abort background run?",
        description: "This will stop the background task. Progress will be lost.",
        confirmLabel: "Abort",
        variant: "danger",
      };
    case "remove-skill":
      return {
        open: true,
        title: "Remove skill?",
        description: `This will remove "${confirmAction.skillId}" from the configured skills.`,
        confirmLabel: "Remove",
        variant: "danger",
      };
    case "remove-mcp":
      return {
        open: true,
        title: "Remove MCP server?",
        description: `This will remove "${confirmAction.mcpId}" from the allow-list and delete its configuration.`,
        confirmLabel: "Remove",
        variant: "danger",
      };
    case "disconnect-mcp":
      return {
        open: true,
        title: "Disconnect MCP server?",
        description: `This will disconnect "${confirmAction.mcpId}" from the runtime. You can reconnect later.`,
        confirmLabel: "Disconnect",
        variant: "danger",
      };
    case "remove-agent":
      return {
        open: true,
        title: "Remove agent type?",
        description: "This will delete the agent type configuration.",
        confirmLabel: "Remove",
        variant: "danger",
      };
    case "remove-cron":
      return {
        open: true,
        title: "Remove cron job?",
        description: `This will delete the cron job "${confirmAction.jobId}" and stop any future scheduled runs.`,
        confirmLabel: "Remove",
        variant: "danger",
      };
    default:
      return { open: false, title: "", confirmLabel: "", variant: "default" };
  }
}

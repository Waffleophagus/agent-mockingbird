import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { isActiveHours } from "./activeHours";
import type { HeartbeatConfig, HeartbeatContext, HeartbeatResult } from "./types";
import { getConfigSnapshot } from "../config/service";
import { getRuntime } from "../runtime";

export const DEFAULT_HEARTBEAT_PROMPT =
  "Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.";

export function parseInterval(interval: string): number {
  const match = interval.match(/^(\d+)([mhd])$/);
  if (!match) throw new Error(`Invalid interval: ${interval}`);

  const value = match[1];
  const unit = match[2];
  const num = parseInt(value ?? "0", 10);

  switch (unit) {
    case "m":
      return num * 60 * 1000;
    case "h":
      return num * 60 * 60 * 1000;
    case "d":
      return num * 24 * 60 * 60 * 1000;
    default:
      throw new Error(`Unknown unit: ${unit}`);
  }
}

function buildHeartbeatPrompt(config: HeartbeatConfig, context: HeartbeatContext): string {
  const parts: string[] = [];

  const workspaceDir = getConfigSnapshot().config.runtime.opencode.directory;
  if (workspaceDir) {
    const heartbeatPath = path.join(workspaceDir, "HEARTBEAT.md");
    if (existsSync(heartbeatPath)) {
      const content = readFileSync(heartbeatPath, "utf8").trim();
      if (content) {
        parts.push(`# Heartbeat Checklist\n\n${content}`);
      }
    }
  }

  parts.push(`## Heartbeat Prompt

${config.prompt?.trim() || DEFAULT_HEARTBEAT_PROMPT}`);

  parts.push(`## Heartbeat Context
- Agent: ${context.agentId}
- Current time: ${context.now}
- Scheduled for: ${context.scheduledFor}
${context.lastHeartbeat ? `- Last heartbeat: ${context.lastHeartbeat}` : ""}

**Instructions:** If everything is fine and nothing needs attention, reply with "HEARTBEAT_OK" (optionally with brief status, max ${config.ackMaxChars} chars). If something needs attention, describe what and why.`);

  return parts.join("\n\n");
}

function isHeartbeatAck(response: string, ackMaxChars: number): boolean {
  const trimmed = response.trim();
  if (!trimmed) return false;

  const stripped = stripHeartbeatTokenAtEdges(trimmed);
  if (!stripped.didStrip) return false;

  const remaining = stripped.text.trim();
  return remaining.length <= ackMaxChars;
}

function stripHeartbeatTokenAtEdges(response: string): { didStrip: boolean; text: string } {
  let text = response.trim();
  let didStrip = false;
  const token = "HEARTBEAT_OK";
  const isWordChar = (value: string | undefined) => Boolean(value && /[A-Za-z0-9_]/.test(value));

  while (text) {
    const prefixNext = text[token.length];
    if (text.startsWith(token) && !isWordChar(prefixNext)) {
      text = text.slice(token.length).trimStart();
      didStrip = true;
      continue;
    }

    const index = text.lastIndexOf(token);
    const beforeToken = index > 0 ? text[index - 1] : undefined;
    const afterToken = index >= 0 ? text[index + token.length] : undefined;
    if (
      index >= 0 &&
      !isWordChar(beforeToken) &&
      !isWordChar(afterToken) &&
      text.slice(index + token.length).replace(/[^\w]/g, "").length === 0
    ) {
      const before = text.slice(0, index).trimEnd();
      const after = text.slice(index + token.length).trimStart();
      text = `${before}${after}`.trim();
      didStrip = true;
      continue;
    }

    break;
  }

  return { didStrip, text };
}

export async function executeHeartbeat(
  agentId: string,
  sessionId: string,
  config: HeartbeatConfig,
): Promise<HeartbeatResult> {
  if (!isActiveHours(config)) {
    return {
      acknowledged: false,
      skipped: true,
      suppressed: true,
      response: "Skipped: outside active hours",
    };
  }

  const runtime = getRuntime();
  if (!runtime) {
    return {
      acknowledged: false,
      suppressed: false,
      error: "Runtime not available",
    };
  }

  const context: HeartbeatContext = {
    agentId,
    sessionId,
    scheduledFor: new Date().toISOString(),
    now: new Date().toISOString(),
  };

  const prompt = buildHeartbeatPrompt(config, context);

  try {
    const ack = await runtime.sendUserMessage({
      sessionId,
      content: prompt,
      agent: agentId,
      metadata: { heartbeat: true },
    });

    const lastMessage = [...ack.messages].reverse().find(m => m.role === "assistant");

    const response = lastMessage?.content ?? "";
    const acknowledged = isHeartbeatAck(response, config.ackMaxChars);

    return {
      acknowledged,
      suppressed: acknowledged,
      response: acknowledged ? undefined : response,
    };
  } catch (error) {
    if (error instanceof Error && (error.name === "RuntimeSessionBusyError" || error.name === "RuntimeSessionQueuedError")) {
      return {
        acknowledged: false,
        skipped: true,
        suppressed: true,
        response: "Skipped: session busy",
      };
    }

    return {
      acknowledged: false,
      suppressed: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

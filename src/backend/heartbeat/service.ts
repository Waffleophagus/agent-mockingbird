import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { isActiveHours } from "./activeHours";
import type { HeartbeatConfig, HeartbeatContext, HeartbeatResult } from "./types";
import { getConfigSnapshot } from "../config/service";
import { getRuntime } from "../runtime";

const HEARTBEAT_OK_PATTERN = /\bHEARTBEAT_OK\b/;

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

export function buildHeartbeatPrompt(config: HeartbeatConfig, context: HeartbeatContext): string {
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

  parts.push(`## Heartbeat Context
- Agent: ${context.agentId}
- Current time: ${context.now}
- Scheduled for: ${context.scheduledFor}
${context.lastHeartbeat ? `- Last heartbeat: ${context.lastHeartbeat}` : ""}

**Instructions:** Check the items above. If everything is fine and nothing needs attention, reply with "HEARTBEAT_OK" (optionally with brief status, max ${config.ackMaxChars} chars). If something needs attention, describe what and why.`);

  if (config.prompt) {
    parts.push(`## Custom Instructions\n\n${config.prompt}`);
  }

  return parts.join("\n\n");
}

export function isHeartbeatAck(response: string, ackMaxChars: number): boolean {
  if (!HEARTBEAT_OK_PATTERN.test(response)) return false;

  const remaining = response.replace(HEARTBEAT_OK_PATTERN, "").trim();
  return remaining.length <= ackMaxChars;
}

export async function executeHeartbeat(
  agentId: string,
  sessionId: string,
  config: HeartbeatConfig,
): Promise<HeartbeatResult> {
  if (!isActiveHours(config)) {
    return {
      acknowledged: false,
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
    return {
      acknowledged: false,
      suppressed: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

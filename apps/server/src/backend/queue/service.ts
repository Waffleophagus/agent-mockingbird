import type { DrainHandler, LaneStats, QueueConfig, QueueDrainResult, QueuedMessage, QueueMode } from "./types";
import { getConfigSnapshot } from "../config/service";
import type { RuntimeInputPart } from "../contracts/runtime";

export class LaneQueue {
  private pending = new Map<string, QueuedMessage[]>();
  private modes = new Map<string, QueueMode>();
  private config: QueueConfig;
  private onDrain?: DrainHandler;

  constructor(config: QueueConfig) {
    this.config = config;
  }

  setDrainHandler(handler: DrainHandler): void {
    this.onDrain = handler;
  }

  enqueue(
    sessionId: string,
    content: string,
    parts?: RuntimeInputPart[],
    agent?: string,
    metadata?: Record<string, unknown>,
    modeOverride?: QueueMode,
  ): { queued: boolean; depth: number } {
    if (!this.config.enabled) {
      return { queued: false, depth: 0 };
    }

    const mode = modeOverride ?? this.modes.get(sessionId) ?? this.config.defaultMode;
    const queue = this.pending.get(sessionId) ?? [];

    const message: QueuedMessage = {
      id: `qmsg-${crypto.randomUUID().slice(0, 12)}`,
      sessionId,
      content,
      parts,
      agent,
      metadata,
      arrivedAt: Date.now(),
    };

    switch (mode) {
      case "replace":
        this.pending.set(sessionId, [message]);
        break;

      case "collect":
      case "followup":
        if (queue.length >= this.config.maxDepth) {
          queue.shift();
        }
        queue.push(message);
        this.pending.set(sessionId, queue);
        break;
    }

    return { queued: true, depth: this.pending.get(sessionId)?.length ?? 0 };
  }

  drain(sessionId: string): QueuedMessage[] | null {
    const queue = this.pending.get(sessionId);
    if (!queue || queue.length === 0) {
      return null;
    }

    this.pending.delete(sessionId);
    return queue;
  }

  async drainAndExecute(sessionId: string): Promise<QueueDrainResult | null> {
    const queue = this.drain(sessionId);
    if (!queue || queue.length === 0) {
      return null;
    }

    const mode = this.modes.get(sessionId) ?? this.config.defaultMode;
    let messagesToProcess: QueuedMessage[];
    let coalesced = false;

    const hasAttachments = queue.some(message => Array.isArray(message.parts) && message.parts.length > 0);
    if (mode === "collect" && queue.length > 1 && !hasAttachments) {
      const coalescedContent = this.coalesceMessages(queue);
      messagesToProcess = [
        {
          id: `coalesced-${Date.now()}`,
          sessionId,
          content: coalescedContent,
          arrivedAt: Date.now(),
        },
      ];
      coalesced = true;
    } else if (mode === "followup") {
      messagesToProcess = [queue[0]!];
      if (queue.length > 1) {
        this.pending.set(sessionId, queue.slice(1));
      }
    } else {
      messagesToProcess = queue;
    }

    if (this.onDrain) {
      await this.onDrain(sessionId, messagesToProcess, mode);
    }

    return {
      messagesProcessed: messagesToProcess.length,
      mode,
      coalesced,
    };
  }

  private coalesceMessages(messages: QueuedMessage[]): string {
    const parts: string[] = ["While you were processing, these messages arrived:\n"];

    for (const [i, msg] of messages.entries()) {
      const timestamp = new Date(msg.arrivedAt).toLocaleTimeString();
      parts.push(`\n[${i + 1}] (${timestamp}) ${msg.content}`);
    }

    parts.push("\n\nPlease address these messages together.");
    return parts.join("");
  }

  setMode(sessionId: string, mode: QueueMode): void {
    this.modes.set(sessionId, mode);
  }

  getMode(sessionId: string): QueueMode {
    return this.modes.get(sessionId) ?? this.config.defaultMode;
  }

  depth(sessionId: string): number {
    return this.pending.get(sessionId)?.length ?? 0;
  }

  stats(): LaneStats[] {
    const stats: LaneStats[] = [];
    const now = Date.now();

    for (const [sessionId, queue] of this.pending) {
      stats.push({
        sessionId,
        depth: queue.length,
        mode: this.getMode(sessionId),
        oldestMessageAge: queue[0] ? now - queue[0].arrivedAt : null,
      });
    }

    return stats;
  }

  clear(sessionId: string): number {
    const depth = this.depth(sessionId);
    this.pending.delete(sessionId);
    return depth;
  }

  clearAll(): void {
    this.pending.clear();
    this.modes.clear();
  }
}

let laneQueue: LaneQueue | null = null;

function resolveQueueConfig(): QueueConfig {
  return getConfigSnapshot().config.runtime.queue;
}

export function getLaneQueue(): LaneQueue {
  if (!laneQueue) {
    laneQueue = new LaneQueue(resolveQueueConfig());
  }
  return laneQueue;
}

import type { Message, OpencodeClient, Part } from "@opencode-ai/sdk/client";

import type { RuntimeEngine } from "../contracts/runtime";
import { createOpencodeClient } from "../opencode/client";
import { getLaneQueue } from "../queue/service";
import type { OpencodeRuntimeBackgroundMethods } from "./opencodeRuntime/backgroundMethods";
import { opencodeRuntimeBackgroundMethods } from "./opencodeRuntime/backgroundMethods";
import type { OpencodeRuntimeCoreMethods } from "./opencodeRuntime/coreMethods";
import { opencodeRuntimeCoreMethods } from "./opencodeRuntime/coreMethods";
import type { OpencodeRuntimeEventMethods } from "./opencodeRuntime/eventMethods";
import { opencodeRuntimeEventMethods } from "./opencodeRuntime/eventMethods";
import type { OpencodeRuntimeMemoryMethods } from "./opencodeRuntime/memoryMethods";
import { opencodeRuntimeMemoryMethods } from "./opencodeRuntime/memoryMethods";
import type { OpencodeRuntimePromptMethods } from "./opencodeRuntime/promptMethods";
import { opencodeRuntimePromptMethods } from "./opencodeRuntime/promptMethods";
import type {
  Listener,
  MemoryInjectionStateEntry,
  OpencodeRuntimeOptions,
  RuntimeAgentCatalog,
  RuntimeHealthSnapshot,
} from "./opencodeRuntime/shared";

class OpencodeRuntimeImpl {
  private listeners = new Set<Listener>();
  private client: OpencodeClient | null = null;
  private clientConnectionKey: string | null = null;
  private readonly disposeController = new AbortController();
  private disposed = false;
  private eventSyncStarted = false;
  private busySessions = new Set<string>();
  private healthSnapshot: RuntimeHealthSnapshot | null = null;
  private healthCacheExpiresAtMs = 0;
  private healthProbeInFlight: Promise<RuntimeHealthSnapshot> | null = null;
  private runtimeConfigSyncKey: string | null = null;
  private runtimeConfigSyncInFlight: Promise<void> | null = null;
  private backgroundSyncStarted = false;
  private backgroundSyncInFlight: Promise<void> | null = null;
  private backgroundHydrationInFlight = new Set<string>();
  private backgroundAnnouncementInFlight = new Set<string>();
  private backgroundLastEmitByRunId = new Map<string, string>();
  private backgroundMessageSyncAtByChildSessionId = new Map<string, number>();
  private drainingSessions = new Set<string>();
  private imageCapabilityByModelRef = new Map<string, boolean>();
  private imageCapabilityFetchedAtMs = 0;
  private messageRoleByScopedMessageId = new Map<string, Message["role"]>();
  private partTypeByScopedPartId = new Map<string, Part["type"]>();
  private memoryInjectionStateBySessionId = new Map<
    string,
    MemoryInjectionStateEntry
  >();
  private availableAgentNamesCache: {
    fetchedAtMs: number;
    catalog: RuntimeAgentCatalog;
  } | null = null;
  declare readonly sendUserMessage: RuntimeEngine["sendUserMessage"];
  declare readonly checkHealth: RuntimeEngine["checkHealth"];
  declare readonly syncSessionMessages: RuntimeEngine["syncSessionMessages"];
  declare readonly abortSession: RuntimeEngine["abortSession"];
  declare readonly compactSession: RuntimeEngine["compactSession"];
  declare readonly startEventSync: OpencodeRuntimeEventMethods["startEventSync"];
  declare readonly startBackgroundSync: OpencodeRuntimeEventMethods["startBackgroundSync"];
  declare readonly clearAllTimers: OpencodeRuntimePromptMethods["clearAllTimers"];

  constructor(private options: OpencodeRuntimeOptions) {
    if (options.client) {
      this.client = options.client;
    } else if (!options.getRuntimeConfig) {
      this.client = createOpencodeClient();
    }
    getLaneQueue().setDrainHandler(async (sessionId, messages) => {
      for (const message of messages) {
        await this.sendUserMessage({
          sessionId,
          content: message.content,
          parts: message.parts,
          agent: message.agent,
          metadata: { ...message.metadata, __queueDrain: true },
        });
      }
    });
    if (options.enableEventSync !== false) {
      this.startEventSync();
    }
    if (options.enableBackgroundSync !== false) {
      this.startBackgroundSync();
    }
  }

  subscribe(onEvent: Listener): () => void {
    this.listeners.add(onEvent);
    return () => {
      this.listeners.delete(onEvent);
    };
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeController.abort();
    this.listeners.clear();
    this.backgroundHydrationInFlight.clear();
    this.backgroundAnnouncementInFlight.clear();
    this.backgroundLastEmitByRunId.clear();
    this.backgroundMessageSyncAtByChildSessionId.clear();
    this.busySessions.clear();
    this.drainingSessions.clear();
    this.messageRoleByScopedMessageId.clear();
    this.partTypeByScopedPartId.clear();
    this.memoryInjectionStateBySessionId.clear();
    if (this.backgroundSyncInFlight) {
      await this.backgroundSyncInFlight.catch(() => {});
    }
  }
}
Object.assign(
  OpencodeRuntimeImpl.prototype,
  opencodeRuntimeCoreMethods,
  opencodeRuntimeMemoryMethods,
  opencodeRuntimeEventMethods,
  opencodeRuntimeBackgroundMethods,
  opencodeRuntimePromptMethods,
);

export type OpencodeRuntime = OpencodeRuntimeImpl &
  OpencodeRuntimeCoreMethods &
  OpencodeRuntimeEventMethods &
  OpencodeRuntimeMemoryMethods &
  OpencodeRuntimeBackgroundMethods &
  OpencodeRuntimePromptMethods;

export const OpencodeRuntime = OpencodeRuntimeImpl as unknown as {
  new (options: OpencodeRuntimeOptions): OpencodeRuntime;
  prototype: OpencodeRuntime;
};

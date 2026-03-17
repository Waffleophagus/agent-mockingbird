/* eslint-disable import/order, @typescript-eslint/no-unsafe-declaration-merging */
import type { Message, OpencodeClient, Part } from "@opencode-ai/sdk/client";

import type { RuntimeEngine } from "../contracts/runtime";
import { createOpencodeClient } from "../opencode/client";
import type {
  Listener,
  MemoryInjectionStateEntry,
  OpencodeRuntimeOptions,
  RuntimeAgentCatalog,
  RuntimeHealthSnapshot,
} from "./opencodeRuntime/shared";
import type { OpencodeRuntimeCoreMethods } from "./opencodeRuntime/coreMethods";
import { opencodeRuntimeCoreMethods } from "./opencodeRuntime/coreMethods";
import type { OpencodeRuntimeMemoryMethods } from "./opencodeRuntime/memoryMethods";
import { opencodeRuntimeMemoryMethods } from "./opencodeRuntime/memoryMethods";
import type { OpencodeRuntimeEventMethods } from "./opencodeRuntime/eventMethods";
import { opencodeRuntimeEventMethods } from "./opencodeRuntime/eventMethods";
import type { OpencodeRuntimeBackgroundMethods } from "./opencodeRuntime/backgroundMethods";
import { opencodeRuntimeBackgroundMethods } from "./opencodeRuntime/backgroundMethods";
import type { OpencodeRuntimePromptMethods } from "./opencodeRuntime/promptMethods";
import { opencodeRuntimePromptMethods } from "./opencodeRuntime/promptMethods";

export interface OpencodeRuntime
  extends OpencodeRuntimeCoreMethods,
    OpencodeRuntimeMemoryMethods,
    OpencodeRuntimeEventMethods,
    OpencodeRuntimeBackgroundMethods,
    OpencodeRuntimePromptMethods {}

export class OpencodeRuntime implements RuntimeEngine {
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
  private renderSnapshotTimerByScopedMessageId = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private liveCodeHighlightTimerByScopedMessageId = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private streamedAssistantContentByScopedMessageId = new Map<string, string>();
  private emittedCodeHighlightLinesByScopedMessageId = new Map<
    string,
    Map<string, string>
  >();
  private memoryInjectionStateBySessionId = new Map<
    string,
    MemoryInjectionStateEntry
  >();
  private availableAgentNamesCache: {
    fetchedAtMs: number;
    catalog: RuntimeAgentCatalog;
  } | null = null;

  constructor(private options: OpencodeRuntimeOptions) {
    if (options.client) {
      this.client = options.client;
    } else if (!options.getRuntimeConfig) {
      this.client = createOpencodeClient();
    }
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
    this.streamedAssistantContentByScopedMessageId.clear();
    this.emittedCodeHighlightLinesByScopedMessageId.clear();
    this.memoryInjectionStateBySessionId.clear();
    this.clearAllTimers(this.renderSnapshotTimerByScopedMessageId);
    this.clearAllTimers(this.liveCodeHighlightTimerByScopedMessageId);
    if (this.backgroundSyncInFlight) {
      await this.backgroundSyncInFlight.catch(() => {});
    }
  }
}
Object.assign(
  OpencodeRuntime.prototype,
  opencodeRuntimeCoreMethods,
  opencodeRuntimeMemoryMethods,
  opencodeRuntimeEventMethods,
  opencodeRuntimeBackgroundMethods,
  opencodeRuntimePromptMethods,
);

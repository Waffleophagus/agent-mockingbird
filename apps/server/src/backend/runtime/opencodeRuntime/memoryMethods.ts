import { searchMemory } from "../../memory/service";
import {
  analyzeMemoryInjectionResults,
  buildMemoryContextFingerprint,
  isMemoryRecallIntentQuery,
  isWriteIntentMemoryQuery,
  memoryInjectionResultKey,
} from "../memoryPromptDedup";
import type { OpencodeRuntime } from "../opencodeRuntime";
import {
  currentMemoryConfig,
  logger,
  MEMORY_INJECTION_STATE_MAX_ENTRIES,
  MEMORY_INJECTION_STATE_TTL_MS,
  MODEL_MEMORY_TOOLS,
  type MemoryInjectionState,
  type MemorySearchResult,
  type MessageMemoryTrace,
  type MemoryToolCallTrace,
  type Part,
  type RuntimeInputPart,
} from "./shared";

export interface OpencodeRuntimeMemoryMethods {
  buildPromptInputWithMemory(
    opencodeSessionId: string,
    userContent: string,
  ): Promise<{
    content: string;
    freshSessionContent: string;
    injectedContextResults: number;
    retrievedContextResults: number;
    suppressedAsAlreadyInContext: number;
    suppressedAsIrrelevant: number;
    memoryContextFingerprint: string | null;
  }>;
  setMemoryInjectionState(sessionId: string, state: MemoryInjectionState): void;
  clearMemoryInjectionState(sessionId: string): void;
  getMemoryInjectionState(sessionId: string): MemoryInjectionState | null;
  pruneMemoryInjectionState(now?: number): void;
  markMemoryInjectionStateForReinject(sessionId: string): void;
  searchMemory(
    query: string,
    options?: { maxResults?: number; minScore?: number },
  ): Promise<MemorySearchResult[]>;
  normalizePromptInputParts(
    content: string,
    parts?: RuntimeInputPart[],
  ): RuntimeInputPart[];
  extractPrimaryTextInput(parts: RuntimeInputPart[]): string;
  applyMemoryPromptToParts(
    parts: RuntimeInputPart[],
    memoryWrappedText: string,
  ): RuntimeInputPart[];
  summarizeUserInputForStorage(
    content: string,
    parts: RuntimeInputPart[],
  ): string;
  buildMessageMemoryTrace(
    parts: Array<Part>,
    memoryStats: {
      injectedContextResults: number;
      retrievedContextResults: number;
      suppressedAsAlreadyInContext: number;
      suppressedAsIrrelevant: number;
    },
  ): MessageMemoryTrace | null;
  summarizeMemoryToolOutput(tool: string, output: string): string;
}

export const opencodeRuntimeMemoryMethods: OpencodeRuntimeMemoryMethods = {
  async buildPromptInputWithMemory(this: OpencodeRuntime, opencodeSessionId, userContent) {
    if (currentMemoryConfig().toolMode === "tool_only") {
      return {
        content: userContent,
        freshSessionContent: userContent,
        injectedContextResults: 0,
        retrievedContextResults: 0,
        suppressedAsAlreadyInContext: 0,
        suppressedAsIrrelevant: 0,
        memoryContextFingerprint: null,
      };
    }

    const query = userContent.trim();
    if (!query) {
      this.clearMemoryInjectionState(opencodeSessionId);
      return {
        content: userContent,
        freshSessionContent: userContent,
        injectedContextResults: 0,
        retrievedContextResults: 0,
        suppressedAsAlreadyInContext: 0,
        suppressedAsIrrelevant: 0,
        memoryContextFingerprint: null,
      };
    }
    if (currentMemoryConfig().toolMode === "hybrid" && isWriteIntentMemoryQuery(query)) {
      return {
        content: userContent,
        freshSessionContent: userContent,
        injectedContextResults: 0,
        retrievedContextResults: 0,
        suppressedAsAlreadyInContext: 0,
        suppressedAsIrrelevant: 0,
        memoryContextFingerprint: null,
      };
    }

    try {
      const searchResults = await this.searchMemory(query);
      const analyzed = analyzeMemoryInjectionResults(query, searchResults as MemorySearchResult[]);
      const relevantResults = analyzed.results;
      if (!relevantResults.length) {
        return {
          content: userContent,
          freshSessionContent: userContent,
          injectedContextResults: 0,
          retrievedContextResults: searchResults.length,
          suppressedAsAlreadyInContext: 0,
          suppressedAsIrrelevant: analyzed.filteredIrrelevantCount,
          memoryContextFingerprint: null,
        };
      }

      const memoryConfig = currentMemoryConfig();
      const dedupeEnabled = memoryConfig.injectionDedupeEnabled;
      const dedupeRecallFallbackOnly = memoryConfig.injectionDedupeFallbackRecallOnly;
      const isRecallIntent = isMemoryRecallIntentQuery(query);
      const state = this.getMemoryInjectionState(opencodeSessionId) ?? {
        fingerprint: "",
        forceReinject: false,
        generation: 0,
        turn: 0,
        injectedKeysByGeneration: [],
      };
      const alreadyInjected = new Set(state.injectedKeysByGeneration);
      let suppressedAsAlreadyInContext = 0;
      let candidateResults = [...relevantResults];
      let recallFallbackApplied = false;
      if (dedupeEnabled) {
        candidateResults = relevantResults.filter(
          (result) => !alreadyInjected.has(memoryInjectionResultKey(result)),
        );
        suppressedAsAlreadyInContext = relevantResults.length - candidateResults.length;
      }
      if (!candidateResults.length && dedupeEnabled) {
        const allowFallback = dedupeRecallFallbackOnly ? isRecallIntent : true;
        if (allowFallback && relevantResults.length > 0) {
          candidateResults = [relevantResults[0] as MemorySearchResult];
          suppressedAsAlreadyInContext = Math.max(0, relevantResults.length - 1);
          recallFallbackApplied = true;
        }
      }

      const makeWrappedText = (results: MemorySearchResult[]) => {
        const contextLines = results.map(
          (result, index) =>
            `${index + 1}. (${result.score.toFixed(3)}) ${result.citation}\n${result.snippet}`,
        );
        const contextBlock = contextLines.join("\n\n");
        return [
          "Use the memory context below only if relevant and non-contradictory to current user intent.",
          "",
          "[Memory Context]",
          contextBlock,
          "[/Memory Context]",
          "",
          "[User Message]",
          userContent,
          "[/User Message]",
        ].join("\n");
      };

      const freshSessionWrappedText = makeWrappedText(relevantResults);
      if (!candidateResults.length) {
        this.setMemoryInjectionState(opencodeSessionId, {
          ...state,
          forceReinject: false,
          turn: state.turn + 1,
        });
        return {
          content: userContent,
          freshSessionContent: freshSessionWrappedText,
          injectedContextResults: 0,
          retrievedContextResults: searchResults.length,
          suppressedAsAlreadyInContext,
          suppressedAsIrrelevant: analyzed.filteredIrrelevantCount,
          memoryContextFingerprint: null,
        };
      }

      const wrappedText = makeWrappedText(candidateResults);
      const fingerprint = buildMemoryContextFingerprint(candidateResults);
      const shouldInject =
        recallFallbackApplied ||
        state.forceReinject ||
        state.fingerprint !== fingerprint;
      if (shouldInject) {
        const maxTracked = Math.max(32, memoryConfig.injectionDedupeMaxTracked);
        const injectedKeys = [
          ...state.injectedKeysByGeneration,
          ...candidateResults.map(memoryInjectionResultKey),
        ];
        const dedupedKeys = [...new Set(injectedKeys)];
        this.setMemoryInjectionState(opencodeSessionId, {
          fingerprint,
          forceReinject: false,
          generation: state.generation,
          turn: state.turn + 1,
          injectedKeysByGeneration: dedupedKeys.slice(-maxTracked),
        });
      } else {
        this.setMemoryInjectionState(opencodeSessionId, {
          ...state,
          forceReinject: false,
          turn: state.turn + 1,
        });
      }
      return {
        content: shouldInject ? wrappedText : userContent,
        freshSessionContent: freshSessionWrappedText,
        injectedContextResults: shouldInject ? candidateResults.length : 0,
        retrievedContextResults: searchResults.length,
        suppressedAsAlreadyInContext,
        suppressedAsIrrelevant: analyzed.filteredIrrelevantCount,
        memoryContextFingerprint: fingerprint,
      };
    } catch (error) {
      logger.warnWithCause("Memory injection failed", error, {
        sessionId: opencodeSessionId,
      });
      return {
        content: userContent,
        freshSessionContent: userContent,
        injectedContextResults: 0,
        retrievedContextResults: 0,
        suppressedAsAlreadyInContext: 0,
        suppressedAsIrrelevant: 0,
        memoryContextFingerprint: null,
      };
    }
  },

  setMemoryInjectionState(this: OpencodeRuntime, sessionId, state) {
    const normalized = sessionId.trim();
    if (!normalized) return;
    const now = Date.now();
    this["memoryInjectionStateBySessionId"].delete(normalized);
    this["memoryInjectionStateBySessionId"].set(normalized, {
      state,
      lastTouchedAt: now,
    });
    this.pruneMemoryInjectionState(now);
  },

  clearMemoryInjectionState(this: OpencodeRuntime, sessionId) {
    const normalized = sessionId.trim();
    if (!normalized) return;
    this["memoryInjectionStateBySessionId"].delete(normalized);
  },

  getMemoryInjectionState(this: OpencodeRuntime, sessionId) {
    const normalized = sessionId.trim();
    if (!normalized) return null;
    const now = Date.now();
    this.pruneMemoryInjectionState(now);
    const entry = this["memoryInjectionStateBySessionId"].get(normalized);
    if (!entry) return null;
    if (now - entry.lastTouchedAt > MEMORY_INJECTION_STATE_TTL_MS) {
      this["memoryInjectionStateBySessionId"].delete(normalized);
      return null;
    }
    this["memoryInjectionStateBySessionId"].delete(normalized);
    this["memoryInjectionStateBySessionId"].set(normalized, {
      state: entry.state,
      lastTouchedAt: now,
    });
    return entry.state;
  },

  pruneMemoryInjectionState(this: OpencodeRuntime, now = Date.now()) {
    for (const [sessionId, entry] of this["memoryInjectionStateBySessionId"].entries()) {
      if (now - entry.lastTouchedAt > MEMORY_INJECTION_STATE_TTL_MS) {
        this["memoryInjectionStateBySessionId"].delete(sessionId);
      }
    }
    while (this["memoryInjectionStateBySessionId"].size > MEMORY_INJECTION_STATE_MAX_ENTRIES) {
      const oldest = this["memoryInjectionStateBySessionId"].keys().next().value as
        | string
        | undefined;
      if (!oldest) break;
      this["memoryInjectionStateBySessionId"].delete(oldest);
    }
  },

  markMemoryInjectionStateForReinject(this: OpencodeRuntime, sessionId) {
    const normalized = sessionId.trim();
    if (!normalized) return;
    const existing = this.getMemoryInjectionState(normalized);
    if (existing) {
      this.setMemoryInjectionState(normalized, {
        ...existing,
        forceReinject: true,
        generation: existing.generation + 1,
        injectedKeysByGeneration: [],
      });
      return;
    }
    this.setMemoryInjectionState(normalized, {
      fingerprint: "",
      forceReinject: true,
      generation: 1,
      turn: 0,
      injectedKeysByGeneration: [],
    });
  },

  async searchMemory(this: OpencodeRuntime, query, options) {
    if (this["options"].searchMemoryFn) {
      return this["options"].searchMemoryFn(query, options);
    }
    return searchMemory(query, options);
  },

  normalizePromptInputParts(this: OpencodeRuntime, content: string, parts?: RuntimeInputPart[]) {
    const normalized: RuntimeInputPart[] = [];
    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (part.type === "text") {
          if (!part.text?.trim()) continue;
          normalized.push({ type: "text", text: part.text });
          continue;
        }
        if (part.type === "file") {
          const mime = part.mime?.trim();
          const url = part.url?.trim();
          if (!mime || !url) continue;
          normalized.push({
            type: "file",
            mime,
            filename: part.filename?.trim() || undefined,
            url,
          });
        }
      }
    }
    if (normalized.length > 0) return normalized;
    if (!content.trim()) return [];
    return [{ type: "text", text: content }];
  },

  extractPrimaryTextInput(this: OpencodeRuntime, parts: RuntimeInputPart[]) {
    const firstText = parts.find((part) => part.type === "text");
    return firstText?.text ?? "";
  },

  applyMemoryPromptToParts(
    this: OpencodeRuntime,
    parts: RuntimeInputPart[],
    memoryWrappedText: string,
  ) {
    if (!memoryWrappedText.trim()) return parts;
    const next = [...parts];
    const index = next.findIndex((part) => part.type === "text");
    if (index === -1) {
      next.unshift({ type: "text", text: memoryWrappedText });
      return next;
    }
    const existing = next[index];
    if (!existing || existing.type !== "text") return next;
    next[index] = { ...existing, text: memoryWrappedText };
    return next;
  },

  summarizeUserInputForStorage(
    this: OpencodeRuntime,
    content: string,
    parts: RuntimeInputPart[],
  ) {
    const text = content.trim();
    const attachments = parts.filter((part) => part.type === "file");
    if (attachments.length === 0) return text;
    const imageCount = attachments.filter((part) =>
      part.mime.toLowerCase().startsWith("image/"),
    ).length;
    const fileCount = attachments.length - imageCount;
    const summaryBits: string[] = [];
    if (imageCount > 0) {
      summaryBits.push(`${imageCount} image${imageCount === 1 ? "" : "s"}`);
    }
    if (fileCount > 0) {
      summaryBits.push(`${fileCount} file${fileCount === 1 ? "" : "s"}`);
    }
    const attachmentSummary = `[Attachments: ${summaryBits.join(", ")}]`;
    return text ? `${text}\n\n${attachmentSummary}` : attachmentSummary;
  },

  buildMessageMemoryTrace(
    this: OpencodeRuntime,
    parts: Array<Part>,
    memoryStats: {
      injectedContextResults: number;
      retrievedContextResults: number;
      suppressedAsAlreadyInContext: number;
      suppressedAsIrrelevant: number;
    },
  ) {
    const toolCalls: MemoryToolCallTrace[] = [];
    for (const part of parts) {
      if (part.type !== "tool" || !MODEL_MEMORY_TOOLS.has(part.tool)) continue;
      const call: MemoryToolCallTrace = {
        tool: part.tool,
        status: part.state.status,
      };
      if (part.state.status === "error") {
        call.error = part.state.error;
        call.summary = "tool call failed";
      } else if (part.state.status === "completed") {
        call.summary = this.summarizeMemoryToolOutput(part.tool, part.state.output);
      }
      toolCalls.push(call);
    }

    if (memoryStats.injectedContextResults <= 0 && toolCalls.length === 0) {
      return null;
    }

    return {
      mode: currentMemoryConfig().toolMode,
      injectedContextResults: memoryStats.injectedContextResults,
      retrievedContextResults: memoryStats.retrievedContextResults,
      suppressedAsAlreadyInContext: memoryStats.suppressedAsAlreadyInContext,
      suppressedAsIrrelevant: memoryStats.suppressedAsIrrelevant,
      toolCalls,
      createdAt: new Date().toISOString(),
    };
  },

  summarizeMemoryToolOutput(this: OpencodeRuntime, tool: string, output: string) {
    if (tool !== "memory_remember") {
      return "completed";
    }
    try {
      const parsed = JSON.parse(output) as unknown;
      if (!parsed || typeof parsed !== "object") return "completed";
      const container = parsed as Record<string, unknown>;
      const result = (container.result as Record<string, unknown> | undefined) ?? container;
      const accepted = result.accepted;
      const reason = result.reason;
      if (typeof accepted === "boolean" && typeof reason === "string") {
        return accepted ? `accepted: ${reason}` : `rejected: ${reason}`;
      }
      if (typeof accepted === "boolean") {
        return accepted ? "accepted" : "rejected";
      }
    } catch {
      // ignore parse errors and fall back to generic summary
    }
    return "completed";
  },
};

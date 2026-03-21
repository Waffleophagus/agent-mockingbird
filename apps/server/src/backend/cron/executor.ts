import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

import { insertStep } from "./repository";
import type {
  CronConditionalModuleContext,
  CronHandlerResult,
  CronJobDefinition,
  CronJobInstance,
  CronStepKind,
} from "./types";
import {
  buildAgentPromptContext,
  computeBackoffMs,
  normalizeConditionalModuleResult,
  nowMs,
  renderTemplate,
  resolveConditionModuleAbsolutePath,
} from "./utils";
import { getConfigSnapshot } from "../config/service";
import type { RuntimeEngine } from "../contracts/runtime";
import { sqlite } from "../db/client";
import { getSessionById, setSessionModel, setSessionTitle } from "../db/repository";

interface CronExecutorAdapter {
  getJob(jobId: string): Promise<CronJobDefinition | null>;
  loadDefinitionRow(jobId: string): {
    id: string;
    job_definition_id?: never;
    max_attempts: number;
    retry_backoff_ms: number;
  } | null;
  markAgentInvoked(instanceId: string): void;
  setInstanceState(input: {
    instanceId: string;
    state: "failed" | "completed" | "dead";
    attempt?: number;
    nextAttemptAt?: number | null;
    resultSummary?: string | null;
    error?: unknown;
  }): void;
}

export class CronExecutor {
  constructor(
    private runtime: RuntimeEngine,
    private adapter: {
      getJob(jobId: string): Promise<CronJobDefinition | null>;
      markAgentInvoked: CronExecutorAdapter["markAgentInvoked"];
      setInstanceState: CronExecutorAdapter["setInstanceState"];
    },
  ) {}

  async ensureCronThread(definition: CronJobDefinition): Promise<CronJobDefinition> {
    if (definition.threadSessionId) {
      const existingThread = getSessionById(definition.threadSessionId);
      if (existingThread) {
        const mainSession = getSessionById("main");
        const desiredTitle = `Cron: ${definition.name}`;
        if (existingThread.title !== desiredTitle) {
          setSessionTitle(existingThread.id, desiredTitle);
        }
        if (mainSession && existingThread.model !== mainSession.model) {
          setSessionModel(existingThread.id, mainSession.model);
        }
        return (await this.adapter.getJob(definition.id)) ?? definition;
      }
    }

    if (!this.runtime.spawnBackgroundSession) {
      throw new Error("runtime does not support cron thread sessions");
    }

    const spawned = await this.runtime.spawnBackgroundSession({
      parentSessionId: "main",
      title: `Cron: ${definition.name}`,
      requestedBy: `cron:${definition.id}`,
      prompt: "",
    });
    const threadSessionId = spawned.childSessionId?.trim();
    if (!threadSessionId) {
      throw new Error("Failed to create cron thread session");
    }

    try {
      sqlite
        .query(
          `
          UPDATE cron_job_definitions
          SET thread_session_id = ?2, updated_at = ?3
          WHERE id = ?1
        `,
        )
        .run(definition.id, threadSessionId, nowMs());
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("cron_job_definitions_thread_session_id_idx") ||
          error.message.includes("UNIQUE constraint failed: cron_job_definitions.thread_session_id"))
      ) {
        throw new Error(
          `Cron thread session ${threadSessionId} is already assigned to another cron job`,
        );
      }
      throw error;
    }

    const mainSession = getSessionById("main");
    if (mainSession) {
      setSessionModel(threadSessionId, mainSession.model);
    }
    setSessionTitle(threadSessionId, `Cron: ${definition.name}`);

    const refreshed = await this.adapter.getJob(definition.id);
    if (!refreshed) {
      throw new Error(`Unknown cron job: ${definition.id}`);
    }
    return refreshed;
  }

  async invokeAgent(input: {
    definition: CronJobDefinition;
    instance: CronJobInstance;
    prompt: string;
    context?: Record<string, unknown>;
  }): Promise<{ ok: true; summary: string } | { ok: false; error: string }> {
    const promptText = input.prompt.trim();
    if (!promptText) return { ok: false, error: "agent prompt was empty" };
    const definition = await this.ensureCronThread(input.definition);
    const targetSession = definition.threadSessionId;
    if (!targetSession) {
      return { ok: false, error: "cron thread session was not created" };
    }

    const agentFromPayload =
      typeof input.definition.payload.agentId === "string"
        ? input.definition.payload.agentId.trim()
        : typeof input.definition.payload.agent === "string"
          ? input.definition.payload.agent.trim()
          : "";
    const expanded = renderTemplate(
      promptText,
      buildAgentPromptContext(definition, input.instance, input.context),
    );

    try {
      const ack = await this.runtime.sendUserMessage({
        sessionId: targetSession,
        content: expanded,
        agent: agentFromPayload || undefined,
      });
      const assistant = [...ack.messages]
        .reverse()
        .find((message) => message.role === "assistant");
      return {
        ok: true,
        summary: assistant?.content?.slice(0, 300) ?? "agent invocation completed",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "agent invocation failed";
      return { ok: false, error: message };
    }
  }

  async runModuleStep(
    definition: CronJobDefinition,
    instance: CronJobInstance,
    input: { allowAgentInvocation: boolean },
  ): Promise<CronHandlerResult> {
    const conditionModulePath = definition.conditionModulePath?.trim();
    if (!conditionModulePath) {
      return {
        status: "error",
        summary: "missing conditionModulePath",
      };
    }

    let absoluteModulePath = "";
    try {
      absoluteModulePath = resolveConditionModuleAbsolutePath(conditionModulePath);
    } catch (error) {
      return {
        status: "error",
        summary: error instanceof Error ? error.message : "invalid conditionModulePath",
      };
    }

    try {
      const result = await this.runConditionalModuleInWorker(absoluteModulePath, {
        nowMs: nowMs(),
        payload: definition.payload,
        job: definition,
        instance,
      });
      if (!input.allowAgentInvocation && result.invokeAgent?.shouldInvoke) {
        return {
          status: "error",
          summary: "runMode=background does not allow invokeAgent",
        };
      }
      return result;
    } catch (error) {
      return {
        status: "error",
        summary: error instanceof Error ? error.message : "conditional module failed",
      };
    }
  }

  async runConditionalModuleInWorker(
    absoluteModulePath: string,
    ctx: CronConditionalModuleContext,
  ): Promise<CronHandlerResult> {
    const timeoutMs = getConfigSnapshot().config.runtime.cron.conditionalModuleTimeoutMs;
    let workerCtx: CronConditionalModuleContext;
    try {
      workerCtx = JSON.parse(JSON.stringify(ctx)) as CronConditionalModuleContext;
    } catch {
      throw new Error(
        "conditional module context must be JSON-serializable before it can be sent to a worker",
      );
    }

    let worker: Worker;
    try {
      worker = new Worker(new URL("./conditionalModuleWorker.ts", import.meta.url), {
        workerData: {
          absoluteModulePath,
          moduleUrl: pathToFileURL(absoluteModulePath).href,
          ctx: workerCtx,
        },
      });
    } catch (error) {
      if (shouldFallbackConditionalModuleWorker(error)) {
        return await this.runConditionalModuleInline(absoluteModulePath, workerCtx);
      }
      throw error;
    }

    return await this.awaitConditionalModuleWorker(worker, timeoutMs, () =>
      this.runConditionalModuleInline(absoluteModulePath, workerCtx),
    );
  }

  private async runConditionalModuleInline(
    absoluteModulePath: string,
    ctx: CronConditionalModuleContext,
  ): Promise<CronHandlerResult> {
    const timeoutMs = getConfigSnapshot().config.runtime.cron.conditionalModuleTimeoutMs;
    const worker = new Worker(
      `
        const { parentPort, workerData } = require("node:worker_threads");

        (async () => {
          if (!parentPort) {
            throw new Error("conditional module worker requires parentPort");
          }

          const { moduleUrl, ctx } = workerData ?? {};
          if (!moduleUrl || !ctx) {
            throw new Error("conditional module worker missing required workerData");
          }

          const loaded = await import(\`\${moduleUrl}?cronRun=\${Date.now()}\`);
          if (typeof loaded.default !== "function") {
            throw new Error("conditional module must export a default function");
          }

          parentPort.postMessage(await loaded.default(ctx));
        })().catch((error) => {
          throw error;
        });
      `,
      {
        eval: true,
        workerData: {
          absoluteModulePath,
          moduleUrl: pathToFileURL(absoluteModulePath).href,
          ctx,
        },
      },
    );

    return await this.awaitConditionalModuleWorker(worker, timeoutMs);
  }

  private async awaitConditionalModuleWorker(
    worker: Worker,
    timeoutMs: number,
    fallback?: () => Promise<CronHandlerResult>,
  ): Promise<CronHandlerResult> {
    return await new Promise<CronHandlerResult>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        clearTimeout(timer);
        worker.removeListener("message", handleMessage);
        worker.removeListener("error", handleError);
        worker.removeListener("exit", handleExit);
      };

      const terminateWorker = () => {
        void worker.terminate().catch(() => {});
      };

      const finish = (cb: () => void, terminate = true) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (terminate) {
          terminateWorker();
        }
        cb();
      };

      const timer = setTimeout(() => {
        finish(() => reject(new Error(`conditional module timed out after ${timeoutMs}ms`)));
      }, timeoutMs);

      const handleMessage = (message: unknown) => {
        finish(() => resolve(normalizeConditionalModuleResult(message)));
      };

      const handleError = (error: Error) => {
        if (fallback && shouldFallbackConditionalModuleWorker(error)) {
          finish(() => {
            void fallback().then(resolve, reject);
          });
          return;
        }
        finish(() => reject(error));
      };

      const handleExit = (code: number) => {
        if (code === 0 || settled) return;
        finish(() => reject(new Error(`conditional module worker exited with code ${code}`)), false);
      };

      worker.on("message", handleMessage);
      worker.on("error", handleError);
      worker.on("exit", handleExit);
    });
  }

  async executeInstance(
    claimed: {
      id: string;
      job_definition_id: string;
      attempt: number;
    },
    definition: CronJobDefinition,
    instance: CronJobInstance,
  ) {
    const attempt = claimed.attempt + 1;
    const startedAt = nowMs();

    sqlite
      .query(
        `
        UPDATE cron_job_instances
        SET
          state = 'running',
          attempt = ?2,
          last_heartbeat_at = ?3,
          updated_at = ?3
        WHERE id = ?1
      `,
      )
      .run(claimed.id, attempt, startedAt);

    let finalSummary = "";
    try {
      definition = await this.ensureCronThread(definition);
      if (definition.runMode === "agent") {
        finalSummary = await this.executeAgentOnlyRun(claimed.id, definition, instance, startedAt);
      } else {
        finalSummary = await this.executeModuleDrivenRun(claimed.id, definition, instance, startedAt);
      }

      this.adapter.setInstanceState({
        instanceId: claimed.id,
        state: "completed",
        attempt,
        resultSummary: finalSummary || "completed",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "job execution failed";
      const canRetry = attempt < definition.maxAttempts;
      if (canRetry) {
        this.adapter.setInstanceState({
          instanceId: claimed.id,
          state: "failed",
          attempt,
          nextAttemptAt: nowMs() + computeBackoffMs(definition.retryBackoffMs, attempt),
          error: { message },
        });
      } else {
        this.adapter.setInstanceState({
          instanceId: claimed.id,
          state: "dead",
          attempt,
          error: { message },
        });
      }
    }
  }

  private async executeAgentOnlyRun(
    instanceId: string,
    definition: CronJobDefinition,
    instance: CronJobInstance,
    startedAt: number,
  ) {
    const template = definition.agentPromptTemplate ?? "";
    insertStep({
      instanceId,
      stepKind: "agent",
      status: "running",
      input: {
        promptTemplate: definition.agentPromptTemplate,
        payload: definition.payload,
      },
      startedAt,
    });
    const agentResult = await this.invokeAgent({
      definition,
      instance,
      prompt: template,
    });
    if (!agentResult.ok) {
      insertStep({
        instanceId,
        stepKind: "agent",
        status: "failed",
        input: { promptTemplate: template },
        error: { message: agentResult.error },
        startedAt,
        finishedAt: nowMs(),
      });
      this.adapter.markAgentInvoked(instanceId);
      throw new Error(agentResult.error);
    }
    insertStep({
      instanceId,
      stepKind: "agent",
      status: "completed",
      input: { promptTemplate: template },
      output: { summary: agentResult.summary },
      startedAt,
      finishedAt: nowMs(),
    });
    this.adapter.markAgentInvoked(instanceId);
    return agentResult.summary;
  }

  private async executeModuleDrivenRun(
    instanceId: string,
    definition: CronJobDefinition,
    instance: CronJobInstance,
    startedAt: number,
  ) {
    const stepKind: CronStepKind =
      definition.runMode === "background" ? "background" : "conditional_agent";
    insertStep({
      instanceId,
      stepKind,
      status: "running",
      input: {
        payload: definition.payload,
        conditionModulePath: definition.conditionModulePath,
      },
      startedAt,
    });
    const moduleResult = await this.runModuleStep(definition, instance, {
      allowAgentInvocation: definition.runMode === "conditional_agent",
    });
    if (moduleResult.status !== "ok") {
      insertStep({
        instanceId,
        stepKind,
        status: "failed",
        input: {
          payload: definition.payload,
          conditionModulePath: definition.conditionModulePath,
        },
        output: moduleResult,
        error: { message: moduleResult.summary ?? "module failed" },
        startedAt,
        finishedAt: nowMs(),
      });
      throw new Error(moduleResult.summary ?? "module failed");
    }

    insertStep({
      instanceId,
      stepKind,
      status: "completed",
      input: {
        payload: definition.payload,
        conditionModulePath: definition.conditionModulePath,
      },
      output: moduleResult,
      startedAt,
      finishedAt: nowMs(),
    });

    const finalSummary = moduleResult.summary ?? "module step completed";
    if (
      definition.runMode !== "conditional_agent" ||
      moduleResult.invokeAgent?.shouldInvoke !== true
    ) {
      return finalSummary;
    }

    const template =
      moduleResult.invokeAgent?.prompt ?? definition.agentPromptTemplate ?? "";
    const agentStartedAt = nowMs();
    insertStep({
      instanceId,
      stepKind: "agent",
      status: "running",
      input: {
        promptTemplate: template,
        invokeAgent: moduleResult.invokeAgent ?? null,
      },
      startedAt: agentStartedAt,
    });
    const agentResult = await this.invokeAgent({
      definition,
      instance,
      prompt: template,
      context: moduleResult.invokeAgent?.context,
    });
    if (!agentResult.ok) {
      insertStep({
        instanceId,
        stepKind: "agent",
        status: "failed",
        input: { promptTemplate: template },
        error: { message: agentResult.error },
        startedAt: agentStartedAt,
        finishedAt: nowMs(),
      });
      this.adapter.markAgentInvoked(instanceId);
      throw new Error(agentResult.error);
    }
    insertStep({
      instanceId,
      stepKind: "agent",
      status: "completed",
      input: { promptTemplate: template },
      output: { summary: agentResult.summary },
      startedAt: agentStartedAt,
      finishedAt: nowMs(),
    });
    this.adapter.markAgentInvoked(instanceId);
    return `${finalSummary}; ${agentResult.summary}`;
  }
}

function shouldFallbackConditionalModuleWorker(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("ModuleNotFound") && message.includes("conditionalModuleWorker");
}

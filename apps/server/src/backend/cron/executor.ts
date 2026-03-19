import { pathToFileURL } from "node:url";

import { insertStep } from "./repository";
import type {
  CronConditionalModule,
  CronConditionalModuleContext,
  CronHandlerResult,
  CronJobDefinition,
  CronJobInstance,
  CronStepKind,
} from "./types";
import {
  buildAgentPromptContext,
  computeBackoffMs,
  definitionPayloadContext,
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

    sqlite
      .query(
        `
        UPDATE cron_job_definitions
        SET thread_session_id = ?2, updated_at = ?3
        WHERE id = ?1
      `,
      )
      .run(definition.id, threadSessionId, nowMs());

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
    const moduleUrl = pathToFileURL(absoluteModulePath).href;
    const task = (async () => {
      const loaded = (await import(`${moduleUrl}?cronRun=${Date.now()}`)) as {
        default?: CronConditionalModule;
      };
      if (typeof loaded.default !== "function") {
        throw new Error("conditional module must export a default function");
      }
      return normalizeConditionalModuleResult(await loaded.default(ctx));
    })();

    return await Promise.race([
      task,
      new Promise<CronHandlerResult>((_resolve, reject) => {
        setTimeout(() => reject(new Error(`conditional module timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
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
    const prompt = renderTemplate(template, definitionPayloadContext(definition));
    const agentResult = await this.invokeAgent({
      definition,
      instance,
      prompt,
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
    const prompt = renderTemplate(template, {
      ...definitionPayloadContext(definition),
      ...(moduleResult.invokeAgent?.context ?? {}),
    });
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
      prompt,
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
    return `${finalSummary}; ${agentResult.summary}`;
  }
}

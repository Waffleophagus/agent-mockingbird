import { Button } from "@opencode-ai/ui/button"
import { showToast } from "@opencode-ai/ui/toast"
import { createSignal, For, onMount, Show, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { prettyJson, waffleJson } from "@/utils/waffle"
import { WaffleCard, WaffleMetaRow, WaffleNotice, WaffleSettingsPage, WaffleSettingsSection, WaffleTextArea, WaffleToolbar } from "./settings-waffle-shared"

type CronJobDefinition = {
  id: string
  name: string
  enabled: boolean
  scheduleKind: "at" | "every" | "cron"
  scheduleExpr: string | null
  everyMs: number | null
  atIso: string | null
  timezone: string | null
  runMode: "background" | "conditional_agent" | "agent"
  handlerKey: string | null
  conditionModulePath: string | null
  conditionDescription: string | null
  agentPromptTemplate: string | null
  agentModelOverride: string | null
  maxAttempts: number
  retryBackoffMs: number
  payload: Record<string, unknown>
}

type CronHealthSnapshot = {
  enabled: boolean
  jobs: {
    total: number
    enabled: number
  }
}

const DEFAULT_JOB = prettyJson({
  name: "Daily summary",
  enabled: true,
  scheduleKind: "cron",
  scheduleExpr: "0 9 * * *",
  timezone: "America/Phoenix",
  runMode: "background",
  handlerKey: "daily_summary",
  payload: {},
})

export const SettingsCron: Component = () => {
  const [state, setState] = createStore({
    loading: true,
    saving: false,
    busyId: "",
    error: "",
    jobs: [] as CronJobDefinition[],
    handlers: [] as string[],
    health: null as CronHealthSnapshot | null,
    createText: DEFAULT_JOB,
    editingId: "",
    editText: "",
  })
  const [refreshTick, setRefreshTick] = createSignal(0)

  async function load() {
    refreshTick()
    setState("loading", true)
    setState("error", "")
    try {
      const [jobs, handlers, health] = await Promise.all([
        waffleJson<{ jobs: CronJobDefinition[] }>("/api/waffle/cron/jobs"),
        waffleJson<{ handlers: string[] }>("/api/waffle/cron/handlers"),
        waffleJson<{ health: CronHealthSnapshot }>("/api/waffle/cron/health"),
      ])
      setState("jobs", jobs.jobs)
      setState("handlers", handlers.handlers)
      setState("health", health.health)
    } catch (error) {
      setState("error", error instanceof Error ? error.message : "Failed to load cron jobs")
    } finally {
      setState("loading", false)
    }
  }

  async function refresh() {
    setRefreshTick((value) => value + 1)
    await load()
  }

  async function createJob() {
    let payload: unknown
    try {
      payload = JSON.parse(state.createText)
    } catch (error) {
      setState("error", error instanceof Error ? error.message : "Invalid cron job JSON")
      return
    }

    setState("saving", true)
    setState("error", "")
    try {
      await waffleJson("/api/waffle/cron/jobs", {
        method: "POST",
        body: JSON.stringify(payload),
      })
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "Cron job created",
      })
      await refresh()
    } catch (error) {
      setState("error", error instanceof Error ? error.message : "Failed to create cron job")
    } finally {
      setState("saving", false)
    }
  }

  async function saveEdit() {
    if (!state.editingId) return

    let payload: unknown
    try {
      payload = JSON.parse(state.editText)
    } catch (error) {
      setState("error", error instanceof Error ? error.message : "Invalid cron patch JSON")
      return
    }

    setState("busyId", state.editingId)
    setState("error", "")
    try {
      await waffleJson(`/api/waffle/cron/jobs/${encodeURIComponent(state.editingId)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      })
      setState("editingId", "")
      setState("editText", "")
      await refresh()
    } catch (error) {
      setState("error", error instanceof Error ? error.message : "Failed to update cron job")
    } finally {
      setState("busyId", "")
    }
  }

  async function runNow(id: string) {
    setState("busyId", id)
    try {
      await waffleJson(`/api/waffle/cron/jobs/${encodeURIComponent(id)}/run`, {
        method: "POST",
      })
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "Cron run queued",
      })
    } catch (error) {
      setState("error", error instanceof Error ? error.message : "Failed to queue cron run")
    } finally {
      setState("busyId", "")
    }
  }

  async function remove(id: string) {
    setState("busyId", id)
    try {
      await waffleJson(`/api/waffle/cron/jobs/${encodeURIComponent(id)}`, {
        method: "DELETE",
      })
      await refresh()
    } catch (error) {
      setState("error", error instanceof Error ? error.message : "Failed to delete cron job")
    } finally {
      setState("busyId", "")
    }
  }

  onMount(() => {
    void load()
  })

  return (
    <WaffleSettingsPage
      title="Cron"
      description="Inspect cron health, create jobs, update jobs with JSON patches, and run them immediately."
      actions={
        <WaffleToolbar>
          <Button variant="ghost" size="large" onClick={() => void refresh()} disabled={state.loading || state.saving}>
            Refresh
          </Button>
        </WaffleToolbar>
      }
    >
      <Show when={state.error}>
        <WaffleNotice tone="error">{state.error}</WaffleNotice>
      </Show>

      <Show when={state.health}>
        {(health) => (
          <WaffleSettingsSection title="Cron health">
            <WaffleMetaRow label="Enabled" value={health().enabled ? "Yes" : "No"} />
            <WaffleMetaRow label="Total jobs" value={String(health().jobs.total)} />
            <WaffleMetaRow label="Enabled jobs" value={String(health().jobs.enabled)} />
          </WaffleSettingsSection>
        )}
      </Show>

      <WaffleSettingsSection title="Registered handlers">
        <div class="px-4 py-3 text-13-regular text-text-strong break-words">
          <Show when={state.handlers.length > 0} fallback={<span class="text-text-weak">No handlers registered.</span>}>
            {state.handlers.join(", ")}
          </Show>
        </div>
      </WaffleSettingsSection>

      <WaffleSettingsSection title="Jobs">
        <Show
          when={state.jobs.length > 0}
          fallback={<div class="px-4 py-4 text-14-regular text-text-weak">No cron jobs configured.</div>}
        >
          <For each={state.jobs}>
            {(job) => (
              <div class="px-4 py-4 border-b border-border-weak-base last:border-none flex flex-col gap-3">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div class="flex flex-col gap-1">
                    <div class="text-14-medium text-text-strong">{job.name}</div>
                    <div class="text-12-regular text-text-weak">
                      {job.id} | {job.scheduleKind} | {job.runMode}
                    </div>
                    <div class="text-12-regular text-text-weak">
                      {job.scheduleExpr ?? job.everyMs ?? job.atIso ?? "No schedule"}
                    </div>
                  </div>
                  <div class="flex flex-wrap items-center gap-2">
                    <Button
                      variant="ghost"
                      size="large"
                      onClick={() => {
                        setState("editingId", state.editingId === job.id ? "" : job.id)
                        setState(
                          "editText",
                          state.editingId === job.id
                            ? ""
                            : prettyJson({
                                name: job.name,
                                enabled: job.enabled,
                                scheduleKind: job.scheduleKind,
                                scheduleExpr: job.scheduleExpr,
                                everyMs: job.everyMs,
                                atIso: job.atIso,
                                timezone: job.timezone,
                                runMode: job.runMode,
                                handlerKey: job.handlerKey,
                                conditionModulePath: job.conditionModulePath,
                                conditionDescription: job.conditionDescription,
                                agentPromptTemplate: job.agentPromptTemplate,
                                agentModelOverride: job.agentModelOverride,
                                maxAttempts: job.maxAttempts,
                                retryBackoffMs: job.retryBackoffMs,
                                payload: job.payload,
                              }),
                        )
                      }}
                    >
                      {state.editingId === job.id ? "Close editor" : "Edit JSON"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="large"
                      onClick={() => void runNow(job.id)}
                      disabled={state.busyId === job.id}
                    >
                      Run now
                    </Button>
                    <Button
                      variant="ghost"
                      size="large"
                      onClick={() => void remove(job.id)}
                      disabled={state.busyId === job.id}
                    >
                      Delete
                    </Button>
                  </div>
                </div>

                <Show when={state.editingId === job.id}>
                  <div class="flex flex-col gap-3">
                    <WaffleTextArea
                      rows={12}
                      value={state.editText}
                      onInput={(event) => setState("editText", event.currentTarget.value)}
                    />
                    <div class="flex justify-end">
                      <Button size="large" onClick={() => void saveEdit()} disabled={state.busyId === job.id}>
                        Save patch
                      </Button>
                    </div>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </WaffleSettingsSection>

      <WaffleSettingsSection title="Create job" description="Post a complete cron job definition as JSON.">
        <WaffleCard
          footer={
            <div class="flex justify-end">
              <Button size="large" onClick={() => void createJob()} disabled={state.saving}>
                Create job
              </Button>
            </div>
          }
        >
          <WaffleTextArea rows={16} value={state.createText} onInput={(event) => setState("createText", event.currentTarget.value)} />
        </WaffleCard>
      </WaffleSettingsSection>
    </WaffleSettingsPage>
  )
}

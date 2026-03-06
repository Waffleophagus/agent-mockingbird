import { Clock, Copy, List, Play, Save, Trash2, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type {
  CronHealthSnapshot,
  CronJobDefinition,
  CronJobInstance,
  CronJobPatchInput,
  CronJobStep,
} from "@/backend/cron/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatCompactTimestamp, relativeFromIso } from "@/frontend/app/chatHelpers";
import {
  createCronJob,
  fetchCronHandlers,
  fetchCronHealth,
  fetchCronInstances,
  fetchCronJobs,
  fetchCronSteps,
  runCronJobNow,
  setCronJobEnabled,
  updateCronJob,
} from "@/frontend/app/cronApi";

type CronPageTab = "jobs" | "instances";
type ConditionalAgentFilter = "all" | "invoked" | "not_invoked";

interface ScheduleDraft {
  scheduleKind: CronJobDefinition["scheduleKind"];
  scheduleExpr: string;
  everyMs: string;
  atIso: string;
  timezone: string;
}

function formatSchedule(job: CronJobDefinition): string {
  if (job.scheduleKind === "every" && job.everyMs) {
    const seconds = Math.floor(job.everyMs / 1000);
    if (seconds < 60) return `every ${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `every ${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `every ${hours}h`;
    const days = Math.floor(hours / 24);
    return `every ${days}d`;
  }
  if (job.scheduleKind === "cron" && job.scheduleExpr) {
    return `cron: ${job.scheduleExpr}`;
  }
  if (job.scheduleKind === "at" && job.atIso) {
    return `at ${formatCompactTimestamp(job.atIso)}`;
  }
  return job.scheduleKind;
}

function stateVariant(state: CronJobInstance["state"]): "success" | "warning" | "outline" {
  if (state === "completed") return "success";
  if (state === "running") return "warning";
  if (state === "failed" || state === "dead") return "warning";
  return "outline";
}

function buildScheduleDraft(job: CronJobDefinition): ScheduleDraft {
  return {
    scheduleKind: job.scheduleKind,
    scheduleExpr: job.scheduleExpr ?? "",
    everyMs: job.everyMs ? String(job.everyMs) : "",
    atIso: job.atIso ?? "",
    timezone: job.timezone ?? "",
  };
}

function draftPatchFromSchedule(draft: ScheduleDraft): CronJobPatchInput {
  if (draft.scheduleKind === "every") {
    const everyMs = Number(draft.everyMs);
    if (!Number.isFinite(everyMs) || everyMs <= 0) {
      throw new Error("Every schedule must be a positive number of milliseconds.");
    }
    return {
      scheduleKind: "every",
      everyMs,
      scheduleExpr: null,
      atIso: null,
      timezone: draft.timezone.trim() || null,
    };
  }
  if (draft.scheduleKind === "cron") {
    const scheduleExpr = draft.scheduleExpr.trim();
    if (!scheduleExpr) {
      throw new Error("Cron expression is required.");
    }
    return {
      scheduleKind: "cron",
      scheduleExpr,
      everyMs: null,
      atIso: null,
      timezone: draft.timezone.trim() || null,
    };
  }
  const atIso = draft.atIso.trim();
  if (!atIso) {
    throw new Error("Run-at timestamp is required.");
  }
  return {
    scheduleKind: "at",
    atIso,
    everyMs: null,
    scheduleExpr: null,
    timezone: draft.timezone.trim() || null,
  };
}

interface CronPageProps {
  requestRemoveCronJob: (jobId: string) => void;
  refreshKey?: number;
}

export function CronPage(props: CronPageProps) {
  const { requestRemoveCronJob, refreshKey } = props;

  const [tab, setTab] = useState<CronPageTab>("jobs");
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<CronJobDefinition[]>([]);
  const [health, setHealth] = useState<CronHealthSnapshot | null>(null);
  const [handlers, setHandlers] = useState<string[]>([]);
  const [instances, setInstances] = useState<CronJobInstance[]>([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [steps, setSteps] = useState<CronJobStep[]>([]);
  const [instanceFilterJobId, setInstanceFilterJobId] = useState<string>("");
  const [conditionalAgentFilter, setConditionalAgentFilter] = useState<ConditionalAgentFilter>("all");
  const [jobBusyById, setJobBusyById] = useState<Record<string, string>>({});
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const [jobsData, healthData, handlersData] = await Promise.all([
          fetchCronJobs(),
          fetchCronHealth(),
          fetchCronHandlers(),
        ]);
        if (cancelled) return;
        setJobs(jobsData);
        setHealth(healthData);
        setHandlers(handlersData);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load cron data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  useEffect(() => {
    if (jobs.length === 0) {
      setSelectedJobId("");
      setScheduleDraft(null);
      return;
    }
    if (!selectedJobId || !jobs.some(job => job.id === selectedJobId)) {
      setSelectedJobId(jobs[0]?.id ?? "");
    }
  }, [jobs, selectedJobId]);

  const selectedJob = useMemo(
    () => jobs.find(job => job.id === selectedJobId) ?? null,
    [jobs, selectedJobId],
  );

  useEffect(() => {
    if (!selectedJob) return;
    setScheduleDraft(buildScheduleDraft(selectedJob));
  }, [selectedJob?.id]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (tab !== "instances") return;
      try {
        const data = await fetchCronInstances(instanceFilterJobId || undefined, 100);
        if (cancelled) return;
        setInstances(data);
      } catch (err) {
        if (cancelled) return;
        console.error(err);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [tab, instanceFilterJobId, refreshKey]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setSteps([]);
      if (!selectedInstanceId) {
        return;
      }
      try {
        const data = await fetchCronSteps(selectedInstanceId);
        if (cancelled) return;
        setSteps(data);
      } catch (err) {
        if (cancelled) return;
        console.error(err);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedInstanceId]);

  const jobById = useMemo(() => new Map(jobs.map(job => [job.id, job])), [jobs]);
  const visibleInstances = useMemo(
    () =>
      instances.filter(instance => {
        if (conditionalAgentFilter === "all") return true;
        const job = jobById.get(instance.jobDefinitionId);
        if (!job || job.runMode !== "conditional_agent") return false;
        if (conditionalAgentFilter === "invoked") return instance.agentInvoked;
        return !instance.agentInvoked;
      }),
    [conditionalAgentFilter, instances, jobById],
  );

  async function reloadJobs() {
    const [jobsData, healthData] = await Promise.all([fetchCronJobs(), fetchCronHealth()]);
    setJobs(jobsData);
    setHealth(healthData);
  }

  async function withJobBusy(jobId: string, action: string, run: () => Promise<void>) {
    setJobBusyById(current => ({ ...current, [jobId]: action }));
    setError("");
    setNotice("");
    try {
      await run();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cron action failed");
    } finally {
      setJobBusyById(current => {
        const next = { ...current };
        delete next[jobId];
        return next;
      });
    }
  }

  async function toggleJobEnabled(job: CronJobDefinition) {
    await withJobBusy(job.id, job.enabled ? "disable" : "enable", async () => {
      const updated = await setCronJobEnabled(job.id, !job.enabled);
      setJobs(current => current.map(item => (item.id === updated.id ? updated : item)));
      setHealth(await fetchCronHealth());
      setNotice(`${updated.enabled ? "Enabled" : "Disabled"} ${updated.name}.`);
    });
  }

  async function saveSchedule(job: CronJobDefinition) {
    if (!scheduleDraft) return;
    await withJobBusy(job.id, "save-schedule", async () => {
      const updated = await updateCronJob(job.id, draftPatchFromSchedule(scheduleDraft));
      setJobs(current => current.map(item => (item.id === updated.id ? updated : item)));
      setScheduleDraft(buildScheduleDraft(updated));
      setNotice(`Saved schedule for ${updated.name}.`);
    });
  }

  async function duplicateJob(job: CronJobDefinition) {
    await withJobBusy(job.id, "duplicate", async () => {
      const suffix = crypto.randomUUID().slice(0, 6);
      const created = await createCronJob({
        id: `${job.id}-copy-${suffix}`,
        name: `${job.name} Copy`,
        enabled: false,
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
      });
      setJobs(current => [created, ...current]);
      setSelectedJobId(created.id);
      setNotice(`Duplicated ${job.name} as ${created.name}.`);
    });
  }

  async function runJob(job: CronJobDefinition) {
    await withJobBusy(job.id, "run-now", async () => {
      const result = await runCronJobNow(job.id);
      setNotice(result.queued ? `Queued run for ${job.name}.` : `${job.name} is already queued or running.`);
      setTab("instances");
      setInstanceFilterJobId(job.id);
    });
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button type="button" variant={tab === "jobs" ? "default" : "outline"} size="sm" onClick={() => setTab("jobs")}>
          <List className="size-4" />
          Jobs
        </Button>
        <Button type="button" variant={tab === "instances" ? "default" : "outline"} size="sm" onClick={() => setTab("instances")}>
          <TrendingUp className="size-4" />
          Instances
        </Button>
      </div>

      {error && <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      {notice && <p className="rounded-md border border-border bg-muted/70 p-3 text-sm text-muted-foreground">{notice}</p>}

      {loading && (
        <p className="rounded-md border border-border bg-muted/70 p-3 text-xs text-muted-foreground">
          Loading cron data...
        </p>
      )}

      {!loading && tab === "jobs" && (
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <Card className="panel-noise flex min-h-0 flex-col">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="size-4" />
                Cron Jobs
              </CardTitle>
              <CardDescription>
                Inspect cron jobs, duplicate them, change scheduling, or run them immediately. Create or deeper edits should happen through chat.
              </CardDescription>
            </CardHeader>
            <CardContent className="min-h-0 space-y-3 overflow-y-auto">
              {health && (
                <div className="space-y-2 rounded-md border border-border bg-muted/70 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">System</span>
                    <Badge variant={health.enabled ? "success" : "outline"}>{health.enabled ? "enabled" : "disabled"}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Jobs:</span> {health.jobs.enabled}/{health.jobs.total} enabled
                    </div>
                    <div>
                      <span className="text-muted-foreground">Queued:</span> {health.instances.queued}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Running:</span> {health.instances.running}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Failed:</span> {health.instances.failed}
                    </div>
                  </div>
                </div>
              )}

              {handlers.length > 0 && (
                <div className="space-y-1 rounded-md border border-border bg-muted/60 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Handlers on file</p>
                  <div className="flex flex-wrap gap-1">
                    {handlers.map(handler => (
                      <Badge key={handler} variant="outline" className="text-[10px]">
                        {handler}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {jobs.length === 0 && (
                  <p className="rounded-md border border-border bg-muted/70 p-3 text-xs text-muted-foreground">
                    No cron jobs configured.
                  </p>
                )}
                {jobs.map(job => (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => setSelectedJobId(job.id)}
                    className="w-full rounded-md border border-border bg-muted/70 px-3 py-2 text-left transition hover:border-border/80 data-[active=true]:border-primary/50 data-[active=true]:bg-primary/5"
                    data-active={selectedJobId === job.id}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={`inline-block size-2 shrink-0 rounded-full ${job.enabled ? "bg-success" : "bg-muted-foreground"}`} />
                        <span className="truncate text-sm font-medium">{job.name}</span>
                      </div>
                      <Badge variant="outline">{job.runMode}</Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{formatSchedule(job)}</span>
                      {jobBusyById[job.id] ? <span>{jobBusyById[job.id]}...</span> : null}
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="panel-noise flex min-h-0 flex-col">
            <CardHeader>
              <CardTitle>Job Details</CardTitle>
              <CardDescription>Inspect job behavior and update only the schedule from this UI.</CardDescription>
            </CardHeader>
            <CardContent className="min-h-0 overflow-y-auto">
              {!selectedJob || !scheduleDraft ? (
                <p className="rounded-md border border-border bg-muted/70 p-3 text-xs text-muted-foreground">
                  Select a job to inspect or edit its schedule.
                </p>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2 rounded-md border border-border bg-muted/50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="font-medium">{selectedJob.name}</h3>
                        <p className="text-xs text-muted-foreground">{selectedJob.id}</p>
                      </div>
                      <Badge variant={selectedJob.enabled ? "success" : "outline"}>
                        {selectedJob.enabled ? "enabled" : "disabled"}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={selectedJob.enabled ? "outline" : "default"}
                        disabled={Boolean(jobBusyById[selectedJob.id])}
                        onClick={() => void toggleJobEnabled(selectedJob)}
                      >
                        {selectedJob.enabled ? "Disable" : "Enable"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={Boolean(jobBusyById[selectedJob.id])}
                        onClick={() => void runJob(selectedJob)}
                      >
                        <Play className="size-3.5" />
                        Run now
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={Boolean(jobBusyById[selectedJob.id])}
                        onClick={() => void duplicateJob(selectedJob)}
                      >
                        <Copy className="size-3.5" />
                        Duplicate
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => requestRemoveCronJob(selectedJob.id)}>
                        <Trash2 className="size-3.5 text-destructive" />
                        Delete
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Run mode:</span> {selectedJob.runMode}
                    </div>
                    {selectedJob.agentPromptTemplate && (
                      <div>
                        <span className="text-muted-foreground">Agent prompt:</span>
                        <pre className="mt-1 whitespace-pre-wrap rounded bg-muted/50 p-2 text-[10px]">{selectedJob.agentPromptTemplate}</pre>
                      </div>
                    )}
                    {selectedJob.handlerKey && (
                      <div>
                        <span className="text-muted-foreground">Handler:</span> {selectedJob.handlerKey}
                      </div>
                    )}
                    {selectedJob.conditionModulePath && (
                      <div>
                        <span className="text-muted-foreground">Condition module:</span> {selectedJob.conditionModulePath}
                      </div>
                    )}
                    {Object.keys(selectedJob.payload).length > 0 && (
                      <div>
                        <span className="text-muted-foreground">Payload:</span>
                        <pre className="mt-1 overflow-x-auto rounded bg-muted/50 p-2 text-[10px]">{JSON.stringify(selectedJob.payload, null, 2)}</pre>
                      </div>
                    )}
                    <div>
                      <span className="text-muted-foreground">Created:</span> {formatCompactTimestamp(selectedJob.createdAt)} ({relativeFromIso(selectedJob.createdAt)})
                    </div>
                    <div>
                      <span className="text-muted-foreground">Updated:</span> {formatCompactTimestamp(selectedJob.updatedAt)} ({relativeFromIso(selectedJob.updatedAt)})
                    </div>
                  </div>

                  <div className="space-y-3 rounded-md border border-border bg-muted/50 p-3">
                    <div>
                      <h4 className="text-sm font-medium">Schedule</h4>
                      <p className="text-xs text-muted-foreground">This UI only edits scheduling. Prompt, handler, and run-mode changes should happen through chat.</p>
                    </div>
                    <div className="grid gap-2 md:grid-cols-[140px_minmax(0,1fr)]">
                      <label className="text-xs text-muted-foreground">Schedule type</label>
                      <select
                        value={scheduleDraft.scheduleKind}
                        onChange={event =>
                          setScheduleDraft(current =>
                            current ? { ...current, scheduleKind: event.target.value as ScheduleDraft["scheduleKind"] } : current,
                          )
                        }
                        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="every">every</option>
                        <option value="cron">cron</option>
                        <option value="at">at</option>
                      </select>
                    </div>
                    {scheduleDraft.scheduleKind === "every" ? (
                      <div className="grid gap-2 md:grid-cols-[140px_minmax(0,1fr)]">
                        <label className="text-xs text-muted-foreground">Every ms</label>
                        <Input
                          value={scheduleDraft.everyMs}
                          onChange={event =>
                            setScheduleDraft(current => (current ? { ...current, everyMs: event.target.value } : current))
                          }
                          placeholder="60000"
                        />
                      </div>
                    ) : null}
                    {scheduleDraft.scheduleKind === "cron" ? (
                      <div className="grid gap-2 md:grid-cols-[140px_minmax(0,1fr)]">
                        <label className="text-xs text-muted-foreground">Cron expression</label>
                        <Input
                          value={scheduleDraft.scheduleExpr}
                          onChange={event =>
                            setScheduleDraft(current => (current ? { ...current, scheduleExpr: event.target.value } : current))
                          }
                          placeholder="0 * * * *"
                        />
                      </div>
                    ) : null}
                    {scheduleDraft.scheduleKind === "at" ? (
                      <div className="grid gap-2 md:grid-cols-[140px_minmax(0,1fr)]">
                        <label className="text-xs text-muted-foreground">Run at ISO</label>
                        <Input
                          value={scheduleDraft.atIso}
                          onChange={event =>
                            setScheduleDraft(current => (current ? { ...current, atIso: event.target.value } : current))
                          }
                          placeholder="2026-03-05T18:30:00.000Z"
                        />
                      </div>
                    ) : null}
                    <div className="grid gap-2 md:grid-cols-[140px_minmax(0,1fr)]">
                      <label className="text-xs text-muted-foreground">Timezone</label>
                      <Input
                        value={scheduleDraft.timezone}
                        onChange={event =>
                          setScheduleDraft(current => (current ? { ...current, timezone: event.target.value } : current))
                        }
                        placeholder="America/Chicago"
                      />
                    </div>
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        disabled={Boolean(jobBusyById[selectedJob.id])}
                        onClick={() => void saveSchedule(selectedJob)}
                      >
                        <Save className="size-3.5" />
                        Save schedule
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {!loading && tab === "instances" && (
        <Card className="panel-noise flex min-h-0 flex-1 flex-col">
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>Run Instances</CardTitle>
                <CardDescription>View recent cron job executions and their status.</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={instanceFilterJobId}
                  onChange={event => setInstanceFilterJobId(event.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">All jobs</option>
                  {jobs.map(job => (
                    <option key={job.id} value={job.id}>
                      {job.name}
                    </option>
                  ))}
                </select>
                <select
                  value={conditionalAgentFilter}
                  onChange={event => setConditionalAgentFilter(event.target.value as ConditionalAgentFilter)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="all">All outcomes</option>
                  <option value="invoked">Conditional: agent invoked</option>
                  <option value="not_invoked">Conditional: no agent invoke</option>
                </select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-y-auto">
            <div className="space-y-4">
              {visibleInstances.length === 0 && (
                <p className="rounded-md border border-border bg-muted/70 p-3 text-xs text-muted-foreground">
                  No instances found.
                </p>
              )}
              {visibleInstances.map(instance => {
                const job = jobById.get(instance.jobDefinitionId);
                return (
                  <div key={instance.id} className="space-y-2 rounded-md border border-border bg-muted/70 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{job?.name ?? instance.jobDefinitionId}</span>
                        <Badge variant={stateVariant(instance.state)}>{instance.state}</Badge>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedInstanceId(selectedInstanceId === instance.id ? null : instance.id)}
                      >
                        {selectedInstanceId === instance.id ? "Hide steps" : "Show steps"}
                      </Button>
                    </div>
                    <div className="grid gap-1 text-xs text-muted-foreground">
                      <div>
                        <span className="text-muted-foreground">Scheduled:</span> {formatCompactTimestamp(instance.scheduledFor)}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Attempt:</span> {instance.attempt}/{job?.maxAttempts ?? "?"}
                      </div>
                      {job?.runMode === "conditional_agent" && (
                        <div>
                          <span className="text-muted-foreground">Agent invoked:</span> {instance.agentInvoked ? "yes" : "no"}
                        </div>
                      )}
                      {instance.resultSummary && (
                        <div>
                          <span className="text-muted-foreground">Result:</span> {instance.resultSummary}
                        </div>
                      )}
                      {instance.error !== null && instance.error !== undefined && (
                        <pre className="overflow-x-auto rounded bg-destructive/10 p-2 text-[10px] text-destructive">
                          {JSON.stringify(instance.error, null, 2)}
                        </pre>
                      )}
                    </div>
                    {selectedInstanceId === instance.id && steps.length > 0 && (
                      <div className="mt-2 space-y-2 rounded border border-border/60 bg-muted/50 p-2">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Steps</p>
                        {steps.map(step => (
                          <div key={step.id} className="space-y-1 text-xs">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">{step.stepKind}</Badge>
                              <Badge
                                variant={
                                  step.status === "completed"
                                    ? "success"
                                    : step.status === "failed"
                                      ? "warning"
                                      : "outline"
                                }
                              >
                                {step.status}
                              </Badge>
                            </div>
                            {step.output !== null && step.output !== undefined && (
                              <pre className="overflow-x-auto rounded bg-muted/50 p-2 text-[10px]">
                                {JSON.stringify(step.output, null, 2)}
                              </pre>
                            )}
                            {step.error !== null && step.error !== undefined && (
                              <pre className="overflow-x-auto rounded bg-destructive/10 p-2 text-[10px] text-destructive">
                                {JSON.stringify(step.error, null, 2)}
                              </pre>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

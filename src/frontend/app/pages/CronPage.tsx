import { Clock, List, Trash2, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";

import type {
  CronHealthSnapshot,
  CronJobDefinition,
  CronJobInstance,
  CronJobStep,
} from "@/backend/cron/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCompactTimestamp, relativeFromIso } from "@/frontend/app/chatHelpers";
import {
  setCronJobEnabled,
  fetchCronHandlers,
  fetchCronHealth,
  fetchCronInstances,
  fetchCronJobs,
  fetchCronSteps,
} from "@/frontend/app/cronApi";

type CronPageTab = "jobs" | "instances";
type ConditionalAgentFilter = "all" | "invoked" | "not_invoked";

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
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [steps, setSteps] = useState<CronJobStep[]>([]);
  const [instanceFilterJobId, setInstanceFilterJobId] = useState<string>("");
  const [conditionalAgentFilter, setConditionalAgentFilter] = useState<ConditionalAgentFilter>("all");
  const [jobToggleBusyById, setJobToggleBusyById] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");

  async function toggleJobEnabled(job: CronJobDefinition) {
    const nextEnabled = !job.enabled;
    setJobToggleBusyById(current => ({ ...current, [job.id]: true }));
    setError("");
    try {
      const updated = await setCronJobEnabled(job.id, nextEnabled);
      setJobs(current => current.map(item => (item.id === updated.id ? updated : item)));
      const healthData = await fetchCronHealth();
      setHealth(healthData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update cron job");
    } finally {
      setJobToggleBusyById(current => {
        const next = { ...current };
        delete next[job.id];
        return next;
      });
    }
  }

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
    load().catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

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
    load().catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [tab, instanceFilterJobId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      // Reset step UI immediately when selection changes to avoid showing stale data.
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
    load().catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [selectedInstanceId]);

  const jobById = new Map(jobs.map(job => [job.id, job]));
  const visibleInstances = instances.filter(instance => {
    if (conditionalAgentFilter === "all") return true;
    const job = jobById.get(instance.jobDefinitionId);
    if (!job || job.runMode !== "conditional_agent") return false;
    if (conditionalAgentFilter === "invoked") return instance.agentInvoked;
    return !instance.agentInvoked;
  });

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant={tab === "jobs" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("jobs")}
        >
          <List className="size-4" />
          Jobs
        </Button>
        <Button
          type="button"
          variant={tab === "instances" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("instances")}
        >
          <TrendingUp className="size-4" />
          Instances
        </Button>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

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
              <CardDescription>View and manage scheduled cron jobs.</CardDescription>
            </CardHeader>
            <CardContent className="min-h-0 space-y-3 overflow-y-auto">
              {health && (
                <div className="space-y-2 rounded-md border border-border bg-muted/70 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">System</span>
                    <Badge variant={health.enabled ? "success" : "outline"}>
                      {health.enabled ? "enabled" : "disabled"}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Jobs:</span>{" "}
                      {health.jobs.enabled}/{health.jobs.total} enabled
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
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Handlers</p>
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
                  <div
                    key={job.id}
                    className="space-y-1 rounded-md border border-border bg-muted/70 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-block size-2 rounded-full ${job.enabled ? "bg-success" : "bg-muted-foreground"}`}
                        />
                        <span className="text-sm font-medium">{job.name}</span>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant={job.enabled ? "outline" : "default"}
                        className="h-7 px-2 text-[10px]"
                        disabled={jobToggleBusyById[job.id] === true}
                        onClick={() => void toggleJobEnabled(job)}
                      >
                        {jobToggleBusyById[job.id] ? "..." : job.enabled ? "Disable" : "Enable"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={() => requestRemoveCronJob(job.id)}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{formatSchedule(job)}</span>
                      <Badge variant="outline">{job.runMode}</Badge>
                      {job.handlerKey && (
                        <span className="truncate text-[10px]">{job.handlerKey}</span>
                      )}
                      {job.conditionModulePath && (
                        <span className="truncate text-[10px]">{job.conditionModulePath}</span>
                      )}
                    </div>
                    {Object.keys(job.payload).length > 0 && (
                      <pre className="overflow-x-auto rounded bg-muted/50 p-2 text-[10px] text-muted-foreground">
                        {JSON.stringify(job.payload, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="panel-noise flex min-h-0 flex-col">
            <CardHeader>
              <CardTitle>Job Details</CardTitle>
              <CardDescription>Select a job from the list to view full configuration.</CardDescription>
            </CardHeader>
            <CardContent className="min-h-0 overflow-y-auto">
              <div className="space-y-4">
                {jobs.map(job => (
                  <div key={job.id} className="space-y-2 rounded-md border border-border bg-muted/50 p-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium">{job.name}</h3>
                      <div className="flex items-center gap-2">
                        <Badge variant={job.enabled ? "success" : "outline"}>
                          {job.enabled ? "enabled" : "disabled"}
                        </Badge>
                        <Button
                          type="button"
                          size="sm"
                          variant={job.enabled ? "outline" : "default"}
                          className="h-7 px-2 text-[10px]"
                          disabled={jobToggleBusyById[job.id] === true}
                          onClick={() => void toggleJobEnabled(job)}
                        >
                          {jobToggleBusyById[job.id] ? "..." : job.enabled ? "Disable" : "Enable"}
                        </Button>
                      </div>
                    </div>
                    <div className="grid gap-1 text-xs">
                      <div>
                        <span className="text-muted-foreground">ID:</span> {job.id}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Schedule:</span> {formatSchedule(job)}
                      </div>
                      {job.timezone && (
                        <div>
                          <span className="text-muted-foreground">Timezone:</span> {job.timezone}
                        </div>
                      )}
                      <div>
                        <span className="text-muted-foreground">Run mode:</span> {job.runMode}
                      </div>
                      {job.handlerKey && (
                        <div>
                          <span className="text-muted-foreground">Handler:</span> {job.handlerKey}
                        </div>
                      )}
                      {job.conditionModulePath && (
                        <div>
                          <span className="text-muted-foreground">Condition module:</span> {job.conditionModulePath}
                        </div>
                      )}
                      {job.conditionDescription && (
                        <div>
                          <span className="text-muted-foreground">Condition summary:</span>{" "}
                          {job.conditionDescription}
                        </div>
                      )}
                      {job.agentPromptTemplate && (
                        <div>
                          <span className="text-muted-foreground">Agent prompt:</span>
                          <pre className="mt-1 whitespace-pre-wrap rounded bg-muted/50 p-2 text-[10px]">
                            {job.agentPromptTemplate}
                          </pre>
                        </div>
                      )}
                      <div>
                        <span className="text-muted-foreground">Max attempts:</span> {job.maxAttempts}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Retry backoff:</span> {job.retryBackoffMs}ms
                      </div>
                      <div>
                        <span className="text-muted-foreground">Created:</span>{" "}
                        {formatCompactTimestamp(job.createdAt)} ({relativeFromIso(job.createdAt)})
                      </div>
                      <div>
                        <span className="text-muted-foreground">Updated:</span>{" "}
                        {formatCompactTimestamp(job.updatedAt)} ({relativeFromIso(job.updatedAt)})
                      </div>
                      {job.lastEnqueuedFor && (
                        <div>
                          <span className="text-muted-foreground">Last enqueued:</span>{" "}
                          {formatCompactTimestamp(job.lastEnqueuedFor)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
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
                  <div
                    key={instance.id}
                    className="space-y-2 rounded-md border border-border bg-muted/70 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{job?.name ?? instance.jobDefinitionId}</span>
                        <Badge variant={stateVariant(instance.state)}>{instance.state}</Badge>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setSelectedInstanceId(
                            selectedInstanceId === instance.id ? null : instance.id,
                          )
                        }
                      >
                        {selectedInstanceId === instance.id ? "Hide steps" : "Show steps"}
                      </Button>
                    </div>
                    <div className="grid gap-1 text-xs text-muted-foreground">
                      <div>
                        <span className="text-muted-foreground">Scheduled:</span>{" "}
                        {formatCompactTimestamp(instance.scheduledFor)}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Attempt:</span> {instance.attempt}/
                        {job?.maxAttempts ?? "?"}
                      </div>
                      {job?.runMode === "conditional_agent" && (
                        <div>
                          <span className="text-muted-foreground">Agent invoked:</span>{" "}
                          {instance.agentInvoked ? "yes" : "no"}
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

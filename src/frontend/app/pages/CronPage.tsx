import { ChevronDown, ChevronRight, Clock, Copy, List, Play, Save, Timer, Trash2, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type {
  CronHealthSnapshot,
  CronJobDefinition,
  CronJobInstance,
  CronJobPatchInput,
  CronJobStep,
} from "@/backend/cron/types";
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

function stateVariant(state: CronJobInstance["state"]): string {
  if (state === "completed") return "mgmt-badge-success";
  if (state === "running") return "mgmt-badge-warning";
  if (state === "failed" || state === "dead") return "mgmt-badge-warning";
  return "";
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
  }, [selectedJob]);

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
    <section className="mgmt-page">
      <div className="mgmt-page-header">
        <p className="mgmt-page-eyebrow">Scheduler</p>
        <h2 className="mgmt-page-title">Cron Jobs</h2>
        <p className="mgmt-page-subtitle">Inspect jobs, change schedules, and view run history.</p>
      </div>

      <div className="mgmt-tab-bar">
        <button
          type="button"
          className="mgmt-tab"
          data-active={tab === "jobs"}
          onClick={() => setTab("jobs")}
        >
          <List size={14} />
          Jobs
        </button>
        <button
          type="button"
          className="mgmt-tab"
          data-active={tab === "instances"}
          onClick={() => setTab("instances")}
        >
          <TrendingUp size={14} />
          Instances
        </button>
      </div>

      {error && <div className="mgmt-error">{error}</div>}
      {notice && <div className="mgmt-notice">{notice}</div>}
      {loading && <div className="mgmt-loading">Loading cron data...</div>}

      {!loading && tab === "jobs" && (
        <div className="mgmt-grid mgmt-grid-sidebar">
          {/* Sidebar: job list */}
          <div className="mgmt-panel">
            <div className="mgmt-panel-header">
              <div className="mgmt-panel-header-row">
                <h3 className="mgmt-panel-title">
                  <Clock size={14} />
                  All Jobs
                </h3>
                <span className="mgmt-badge">{jobs.length}</span>
              </div>
            </div>
            <div className="mgmt-panel-body">
              {/* Health summary */}
              {health && (
                <div className="mgmt-stat-grid">
                  <span className="mgmt-stat-label">System</span>
                  <span className="mgmt-stat-value">
                    <span className={`mgmt-badge ${health.enabled ? "mgmt-badge-success" : ""}`}>
                      {health.enabled ? "active" : "disabled"}
                    </span>
                  </span>
                  <span className="mgmt-stat-label">Jobs</span>
                  <span className="mgmt-stat-value">{health.jobs.enabled}/{health.jobs.total} on</span>
                  <span className="mgmt-stat-label">Queued</span>
                  <span className="mgmt-stat-value">{health.instances.queued}</span>
                  <span className="mgmt-stat-label">Running</span>
                  <span className="mgmt-stat-value">{health.instances.running}</span>
                  <span className="mgmt-stat-label">Failed</span>
                  <span className="mgmt-stat-value">{health.instances.failed}</span>
                </div>
              )}

              {/* Handlers */}
              {handlers.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span className="mgmt-form-label">Handlers on file</span>
                  <div className="mgmt-tags">
                    {handlers.map(handler => (
                      <span key={handler} className="mgmt-tag">{handler}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Job list */}
              {jobs.length === 0 && <div className="mgmt-empty">No cron jobs configured.</div>}
              {jobs.map(job => (
                <button
                  key={job.id}
                  type="button"
                  onClick={() => setSelectedJobId(job.id)}
                  className="mgmt-card mgmt-card-interactive"
                  data-active={selectedJobId === job.id}
                  style={{ textAlign: "left", width: "100%" }}
                >
                  <div className="mgmt-card-header">
                    <div className="mgmt-card-title">
                      <span className={`mgmt-dot ${job.enabled ? "mgmt-dot-on" : "mgmt-dot-off"}`} />
                      <span>{job.name}</span>
                    </div>
                    <span className="mgmt-badge">{job.runMode}</span>
                  </div>
                  <div className="mgmt-card-meta">
                    <Timer size={11} />
                    <span>{formatSchedule(job)}</span>
                    {jobBusyById[job.id] ? <span style={{ fontStyle: "italic" }}>{jobBusyById[job.id]}...</span> : null}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Main: job details */}
          <div className="mgmt-panel">
            <div className="mgmt-panel-header">
              <h3 className="mgmt-panel-title">Job Details</h3>
              <p className="mgmt-panel-desc">Inspect behavior and update the schedule from this UI.</p>
            </div>
            <div className="mgmt-panel-body">
              {!selectedJob || !scheduleDraft ? (
                <div className="mgmt-empty">Select a job to inspect or edit its schedule.</div>
              ) : (
                <>
                  {/* Identity + actions */}
                  <div className="mgmt-section">
                    <div className="mgmt-card-header">
                      <div>
                        <h4 className="mgmt-section-title">{selectedJob.name}</h4>
                        <p className="mgmt-section-desc" style={{ fontFamily: "'Geist Mono', monospace" }}>{selectedJob.id}</p>
                      </div>
                      <span className={`mgmt-badge ${selectedJob.enabled ? "mgmt-badge-success" : ""}`}>
                        {selectedJob.enabled ? "enabled" : "disabled"}
                      </span>
                    </div>
                    <div className="mgmt-actions">
                      <button
                        type="button"
                        className={`mgmt-pill-btn ${selectedJob.enabled ? "" : "mgmt-pill-btn-primary"}`}
                        disabled={Boolean(jobBusyById[selectedJob.id])}
                        onClick={() => void toggleJobEnabled(selectedJob)}
                      >
                        {selectedJob.enabled ? "Disable" : "Enable"}
                      </button>
                      <button
                        type="button"
                        className="mgmt-pill-btn"
                        disabled={Boolean(jobBusyById[selectedJob.id])}
                        onClick={() => void runJob(selectedJob)}
                      >
                        <Play size={12} />
                        Run now
                      </button>
                      <button
                        type="button"
                        className="mgmt-pill-btn"
                        disabled={Boolean(jobBusyById[selectedJob.id])}
                        onClick={() => void duplicateJob(selectedJob)}
                      >
                        <Copy size={12} />
                        Duplicate
                      </button>
                      <button
                        type="button"
                        className="mgmt-pill-btn mgmt-pill-btn-danger"
                        onClick={() => requestRemoveCronJob(selectedJob.id)}
                      >
                        <Trash2 size={12} />
                        Delete
                      </button>
                    </div>
                  </div>

                  {/* Metadata */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div className="mgmt-detail-row">
                      <span className="mgmt-detail-label">Run mode</span>
                      <span className="mgmt-detail-value">{selectedJob.runMode}</span>
                    </div>
                    {selectedJob.agentPromptTemplate && (
                      <div className="mgmt-detail-row">
                        <span className="mgmt-detail-label">Prompt</span>
                        <div className="mgmt-detail-value">
                          <pre>{selectedJob.agentPromptTemplate}</pre>
                        </div>
                      </div>
                    )}
                    {selectedJob.handlerKey && (
                      <div className="mgmt-detail-row">
                        <span className="mgmt-detail-label">Handler</span>
                        <span className="mgmt-detail-value">{selectedJob.handlerKey}</span>
                      </div>
                    )}
                    {selectedJob.conditionModulePath && (
                      <div className="mgmt-detail-row">
                        <span className="mgmt-detail-label">Condition</span>
                        <span className="mgmt-detail-value" style={{ fontFamily: "'Geist Mono', monospace", fontSize: 11 }}>{selectedJob.conditionModulePath}</span>
                      </div>
                    )}
                    {Object.keys(selectedJob.payload).length > 0 && (
                      <div className="mgmt-detail-row">
                        <span className="mgmt-detail-label">Payload</span>
                        <div className="mgmt-detail-value">
                          <pre>{JSON.stringify(selectedJob.payload, null, 2)}</pre>
                        </div>
                      </div>
                    )}
                    <div className="mgmt-detail-row">
                      <span className="mgmt-detail-label">Created</span>
                      <span className="mgmt-detail-value">{formatCompactTimestamp(selectedJob.createdAt)} ({relativeFromIso(selectedJob.createdAt)})</span>
                    </div>
                    <div className="mgmt-detail-row">
                      <span className="mgmt-detail-label">Updated</span>
                      <span className="mgmt-detail-value">{formatCompactTimestamp(selectedJob.updatedAt)} ({relativeFromIso(selectedJob.updatedAt)})</span>
                    </div>
                  </div>

                  {/* Schedule editor */}
                  <div className="mgmt-section">
                    <div>
                      <h4 className="mgmt-section-title">Schedule</h4>
                      <p className="mgmt-section-desc">Only scheduling is editable here. Prompt, handler, and run-mode changes go through chat.</p>
                    </div>

                    <div className="mgmt-form-row">
                      <label className="mgmt-form-label" htmlFor={`cron-schedule-type-${selectedJob.id}`}>Type</label>
                      <select
                        id={`cron-schedule-type-${selectedJob.id}`}
                        value={scheduleDraft.scheduleKind}
                        onChange={event =>
                          setScheduleDraft(current =>
                            current ? { ...current, scheduleKind: event.target.value as ScheduleDraft["scheduleKind"] } : current,
                          )
                        }
                        className="mgmt-select"
                      >
                        <option value="every">every</option>
                        <option value="cron">cron</option>
                        <option value="at">at</option>
                      </select>
                    </div>

                    {scheduleDraft.scheduleKind === "every" && (
                      <div className="mgmt-form-row">
                        <label className="mgmt-form-label" htmlFor={`cron-schedule-every-${selectedJob.id}`}>Every ms</label>
                        <input
                          id={`cron-schedule-every-${selectedJob.id}`}
                          type="text"
                          className="mgmt-input"
                          value={scheduleDraft.everyMs}
                          onChange={event =>
                            setScheduleDraft(current => (current ? { ...current, everyMs: event.target.value } : current))
                          }
                          placeholder="60000"
                        />
                      </div>
                    )}

                    {scheduleDraft.scheduleKind === "cron" && (
                      <div className="mgmt-form-row">
                        <label className="mgmt-form-label" htmlFor={`cron-schedule-expr-${selectedJob.id}`}>Expression</label>
                        <input
                          id={`cron-schedule-expr-${selectedJob.id}`}
                          type="text"
                          className="mgmt-input"
                          value={scheduleDraft.scheduleExpr}
                          onChange={event =>
                            setScheduleDraft(current => (current ? { ...current, scheduleExpr: event.target.value } : current))
                          }
                          placeholder="0 * * * *"
                        />
                      </div>
                    )}

                    {scheduleDraft.scheduleKind === "at" && (
                      <div className="mgmt-form-row">
                        <label className="mgmt-form-label" htmlFor={`cron-schedule-at-${selectedJob.id}`}>Run at ISO</label>
                        <input
                          id={`cron-schedule-at-${selectedJob.id}`}
                          type="text"
                          className="mgmt-input"
                          value={scheduleDraft.atIso}
                          onChange={event =>
                            setScheduleDraft(current => (current ? { ...current, atIso: event.target.value } : current))
                          }
                          placeholder="2026-03-05T18:30:00.000Z"
                        />
                      </div>
                    )}

                    <div className="mgmt-form-row">
                      <label className="mgmt-form-label" htmlFor={`cron-schedule-timezone-${selectedJob.id}`}>Timezone</label>
                      <input
                        id={`cron-schedule-timezone-${selectedJob.id}`}
                        type="text"
                        className="mgmt-input"
                        value={scheduleDraft.timezone}
                        onChange={event =>
                          setScheduleDraft(current => (current ? { ...current, timezone: event.target.value } : current))
                        }
                        placeholder="America/Chicago"
                      />
                    </div>

                    <div className="mgmt-actions mgmt-actions-end">
                      <button
                        type="button"
                        className="mgmt-pill-btn mgmt-pill-btn-primary"
                        disabled={Boolean(jobBusyById[selectedJob.id])}
                        onClick={() => void saveSchedule(selectedJob)}
                      >
                        <Save size={12} />
                        Save schedule
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {!loading && tab === "instances" && (
        <div className="mgmt-panel" style={{ flex: 1 }}>
          <div className="mgmt-panel-header">
            <div className="mgmt-panel-header-row">
              <div>
                <h3 className="mgmt-panel-title">Run Instances</h3>
                <p className="mgmt-panel-desc">View recent cron job executions and their status.</p>
              </div>
              <div className="mgmt-actions">
                <select
                  value={instanceFilterJobId}
                  onChange={event => setInstanceFilterJobId(event.target.value)}
                  className="mgmt-select"
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
                  className="mgmt-select"
                >
                  <option value="all">All outcomes</option>
                  <option value="invoked">Agent invoked</option>
                  <option value="not_invoked">No agent invoke</option>
                </select>
              </div>
            </div>
          </div>
          <div className="mgmt-panel-body">
            {visibleInstances.length === 0 && <div className="mgmt-empty">No instances found.</div>}
            {visibleInstances.map(instance => {
              const job = jobById.get(instance.jobDefinitionId);
              const isExpanded = selectedInstanceId === instance.id;
              return (
                <div key={instance.id} className="mgmt-instance-card">
                  <div className="mgmt-card-header">
                    <div className="mgmt-card-title">
                      <span>{job?.name ?? instance.jobDefinitionId}</span>
                      <span className={`mgmt-badge ${stateVariant(instance.state)}`}>{instance.state}</span>
                    </div>
                    <button
                      type="button"
                      className="mgmt-pill-btn mgmt-pill-btn-ghost"
                      onClick={() => setSelectedInstanceId(isExpanded ? null : instance.id)}
                    >
                      {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      {isExpanded ? "Hide" : "Steps"}
                    </button>
                  </div>

                  <div className="mgmt-stat-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                    <div>
                      <span className="mgmt-stat-label">Scheduled</span>
                      <p style={{ margin: 0, fontSize: 12, color: "var(--text-base)" }}>{formatCompactTimestamp(instance.scheduledFor)}</p>
                    </div>
                    <div>
                      <span className="mgmt-stat-label">Attempt</span>
                      <p style={{ margin: 0, fontSize: 12, color: "var(--text-base)" }}>{instance.attempt}/{job?.maxAttempts ?? "?"}</p>
                    </div>
                    {job?.runMode === "conditional_agent" && (
                      <div>
                        <span className="mgmt-stat-label">Agent invoked</span>
                        <p style={{ margin: 0, fontSize: 12, color: "var(--text-base)" }}>{instance.agentInvoked ? "yes" : "no"}</p>
                      </div>
                    )}
                  </div>

                  {instance.resultSummary && (
                    <div style={{ fontSize: 12, color: "var(--text-weak)" }}>
                      <span className="mgmt-form-label">Result</span> {instance.resultSummary}
                    </div>
                  )}

                  {instance.error !== null && instance.error !== undefined && (
                    <div className="mgmt-error">
                      <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 11 }}>
                        {JSON.stringify(instance.error, null, 2)}
                      </pre>
                    </div>
                  )}

                  {isExpanded && steps.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
                      <span className="mgmt-form-label">Steps</span>
                      {steps.map(step => (
                        <div key={step.id} className="mgmt-step-card">
                          <div className="mgmt-actions">
                            <span className="mgmt-badge">{step.stepKind}</span>
                            <span className={`mgmt-badge ${step.status === "completed" ? "mgmt-badge-success" : step.status === "failed" ? "mgmt-badge-warning" : ""}`}>
                              {step.status}
                            </span>
                          </div>
                          {step.output !== null && step.output !== undefined && (
                            <pre style={{ margin: 0, padding: "8px 10px", borderRadius: 10, background: "color-mix(in srgb, var(--surface-inset-base) 70%, transparent)", border: "1px solid color-mix(in srgb, var(--border-weak-base) 55%, transparent)", fontFamily: "'Geist Mono', monospace", fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                              {JSON.stringify(step.output, null, 2)}
                            </pre>
                          )}
                          {step.error !== null && step.error !== undefined && (
                            <div className="mgmt-error">
                              <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 11 }}>
                                {JSON.stringify(step.error, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

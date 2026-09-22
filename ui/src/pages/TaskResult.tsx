import { useEffect, useState } from "react";
import { api, EventItem, FileChange, Task, TaskRun } from "../api/client";

const ACTIVE_STATUSES = new Set(["VALIDATING", "READY", "LOCKING", "CHECKPOINTING", "RUNNING", "VERIFYING"]);
const VALIDATION_EVENT_TYPES = new Set(["validation.passed", "validation.failed", "validation.error", "validation.timeout"]);

function changeClass(t: string) {
  if (t === "created") return "diff-created";
  if (t === "deleted") return "diff-deleted";
  return "diff-modified";
}

function attemptLabel(attempt: number): string {
  return attempt === 0 ? "Attempt 0 (initial)" : `Repair ${attempt}`;
}

function validationBadgeClass(status: string): string {
  if (status === "pass") return "good";
  if (status === "fail") return "bad";
  return "warn"; // error | timeout
}

export default function TaskResultPage({ taskId, onBack }: { taskId: string; onBack: () => void }) {
  const [task, setTask] = useState<Task | null>(null);
  const [run, setRun] = useState<TaskRun | null>(null);
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOverride, setConfirmOverride] = useState(false);

  const load = async () => {
    const t = await api.getTask(taskId);
    setTask(t);
    const runs = await api.listTaskRuns(taskId);
    const latest = runs[0] ?? null;
    setRun(latest);
    if (latest) {
      setChanges(await api.getTaskRunChanges(latest.id));
    }
    setEvents(await api.getEvents({ task_id: taskId }));
  };

  useEffect(() => {
    load();
    const interval = setInterval(() => {
      if (task && !ACTIVE_STATUSES.has(task.status)) return;
      load();
    }, 1500);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, task?.status]);

  if (!task) return <p className="muted">Loading...</p>;

  const isActive = ACTIVE_STATUSES.has(task.status);
  const canDispose = run && run.disposition === "pending" && !isActive;

  const claimedNotObserved = changes.filter((c) => c.claimed_by_executor && !c.observed_by_vcs);
  const observedNotClaimed = changes.filter((c) => !c.claimed_by_executor && c.observed_by_vcs);

  const validationEvents = events
    .filter((e) => VALIDATION_EVENT_TYPES.has(e.type))
    .sort((a, b) => (a.payload.attempt as number) - (b.payload.attempt as number));
  const hasValidator = run?.validation_status != null || validationEvents.length > 0;
  const validationPassed = run?.validation_status === "pass";
  const validationBlocksKeep = run != null && run.validation_status != null && run.validation_status !== "pass";
  const canKeep = canDispose && (!validationBlocksKeep || confirmOverride);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button className="secondary" onClick={onBack} style={{ marginBottom: 12 }}>
        ← Projects
      </button>
      <h2>Task Result</h2>
      <div className="card">
        <p>{task.objective}</p>
        <span className="badge">{task.status}</span>
        {isActive && <span className="muted"> — running…</span>}
      </div>

      {run?.structured_result && (
        <div className="card">
          <h3>Executor summary</h3>
          <p>{run.structured_result.summary}</p>
          {run.structured_result.warnings.length > 0 && (
            <p className="discrepancy">Warnings: {run.structured_result.warnings.join("; ")}</p>
          )}
        </div>
      )}

      {run && !run.structured_result && run.status !== "RUNNING" && run.status !== "PENDING" && (
        <div className="card">
          <p className="discrepancy">
            No verified structured result was returned ({run.failure_reason ?? "unknown reason"}). Treat this run as
            unverified — inspect the actual Git changes below before deciding.
          </p>
        </div>
      )}

      <div className="card">
        <h3>Actual Git changes ({changes.length})</h3>
        {changes.length === 0 && <p className="muted">No file changes observed.</p>}
        {changes.map((c) => (
          <div key={c.id} className={`diff-line ${changeClass(c.change_type)}`}>
            {c.change_type.padEnd(9)} {c.path}
            {c.additions != null && ` (+${c.additions}/-${c.deletions ?? 0})`}
            {!c.observed_by_vcs && " — claimed but NOT observed"}
            {c.claimed_by_executor === false && " — observed but NOT claimed"}
          </div>
        ))}
        {(claimedNotObserved.length > 0 || observedNotClaimed.length > 0) && (
          <p className="discrepancy" style={{ marginTop: 8 }}>
            Discrepancy: {claimedNotObserved.length} claimed-but-unobserved, {observedNotClaimed.length}{" "}
            observed-but-unclaimed.
          </p>
        )}
      </div>

      {hasValidator && (
        <div className="card">
          <h3>Validation</h3>
          {validationEvents.map((e) => {
            const status = e.payload.status as string;
            const attempt = e.payload.attempt as number;
            const errorCount = (e.payload.error_count as number) ?? 0;
            return (
              <div key={e.id} className="row" style={{ marginBottom: 6 }}>
                <span>
                  {attemptLabel(attempt)} — {e.payload.validator as string}
                </span>
                <span className={`badge ${validationBadgeClass(status)}`}>
                  {status.toUpperCase()}
                  {status === "fail" && errorCount > 0 ? ` (${errorCount} error${errorCount === 1 ? "" : "s"})` : ""}
                </span>
              </div>
            );
          })}
          {run?.validation_status && (
            <p style={{ marginTop: 8 }}>
              Final: <strong className={validationPassed ? "" : "discrepancy"}>
                {validationPassed ? "VALIDATED" : run.validation_status.toUpperCase()}
              </strong>
            </p>
          )}
        </div>
      )}

      {run && (
        <div className="card">
          <h3>Disposition</h3>
          <p className="muted">
            Current: <strong>{run.disposition}</strong>
          </p>
          {validationBlocksKeep && run.disposition === "pending" && !isActive && (
            <div style={{ marginBottom: 10 }}>
              <p className="discrepancy">
                Validation did not pass ({run.validation_status}). KEEP is blocked unless you explicitly override.
              </p>
              <label className="muted" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={confirmOverride} onChange={(e) => setConfirmOverride(e.target.checked)} />
                I understand validation failed and want to keep these changes anyway
              </label>
            </div>
          )}
          <div className="row">
            <button className="danger" disabled={!canDispose || busy} onClick={() => act(() => api.rollbackRun(run.id))}>
              ROLLBACK
            </button>
            <button
              className="primary"
              disabled={!canKeep || busy}
              onClick={() => act(() => api.keepRun(run.id, validationBlocksKeep && confirmOverride))}
            >
              KEEP CHANGES{validationBlocksKeep && confirmOverride ? " (override)" : ""}
            </button>
          </div>
          {isActive && (
            <button className="secondary" style={{ marginTop: 8 }} disabled={busy} onClick={() => act(() => api.cancelRun(run.id))}>
              Cancel
            </button>
          )}
          {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
        </div>
      )}

      <div className="card">
        <h3>Activity</h3>
        <table>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td className="muted">{new Date(e.created_at).toLocaleTimeString()}</td>
                <td>
                  <span className={`badge ${e.severity === "error" ? "bad" : e.severity === "warning" ? "warn" : ""}`}>
                    {e.severity}
                  </span>
                </td>
                <td>{e.type}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { api, EventItem, FileChange, Project, Task, TaskRun } from "../api/client";
import {
  previewStatus as fetchPreviewStatus,
  PreviewStatus,
  startPreview,
  startRunWebexport,
  stopPreview,
} from "../api/agentClient";
import { apiBaseUrl, isCloudMode } from "../api/workspaceMode";

const ACTIVE_STATUSES = new Set(["VALIDATING", "READY", "LOCKING", "CHECKPOINTING", "RUNNING", "VERIFYING"]);
const VALIDATION_EVENT_TYPES = new Set(["validation.passed", "validation.failed", "validation.error", "validation.timeout"]);

function changeClass(t: string) {
  if (t === "created") return "diff-created";
  if (t === "deleted") return "diff-deleted";
  return "diff-modified";
}

function attemptLabel(attempt: number): string {
  return attempt === 0 ? "Intento inicial" : `Reparación ${attempt}`;
}

function validationBadgeClass(status: string): string {
  if (status === "pass") return "good";
  if (status === "fail") return "bad";
  return "warn";
}

export default function TaskResultPage({ taskId, onBack }: { taskId: string; onBack: () => void }) {
  const [task, setTask] = useState<Task | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [run, setRun] = useState<TaskRun | null>(null);
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOverride, setConfirmOverride] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [preview, setPreview] = useState<PreviewStatus>("not_started");
  const [webPreviewUrl, setWebPreviewUrl] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const cloud = isCloudMode();

  const load = async () => {
    const t = await api.getTask(taskId);
    setTask(t);
    if (!project) api.getProject(t.project_id).then(setProject);
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

  useEffect(() => () => {
    if (previewTimer.current) clearInterval(previewTimer.current);
  }, []);

  if (!task) return <p className="muted">Cargando...</p>;

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
  const repairAttempts = validationEvents.filter((e) => (e.payload.attempt as number) > 0 && e.type === "validation.passed").length
    || (validationEvents.some((e) => e.type === "validation.failed") && validationPassed ? 1 : 0);

  const succeeded = task.status === "COMPLETED";
  const canPreview = succeeded && project?.project_type === "godot" && run != null;

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

  const handleStartPreview = async () => {
    if (!run) return;
    setPreviewError(null);
    if (cloud) {
      setExporting(true);
      try {
        const { url } = await startRunWebexport(run.id);
        setWebPreviewUrl(`${apiBaseUrl()}${url}`);
      } catch (e) {
        setPreviewError(String(e));
      } finally {
        setExporting(false);
      }
      return;
    }
    try {
      await startPreview(run.id);
      setPreview("running");
      previewTimer.current = setInterval(async () => {
        const s = await fetchPreviewStatus(run.id);
        setPreview(s.status);
        if (s.status !== "running" && previewTimer.current) {
          clearInterval(previewTimer.current);
          previewTimer.current = null;
        }
      }, 2000);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleStopPreview = async () => {
    if (!run) return;
    if (previewTimer.current) {
      clearInterval(previewTimer.current);
      previewTimer.current = null;
    }
    await stopPreview(run.id);
    setPreview("stopped");
  };

  return (
    <div>
      <button className="secondary" onClick={onBack} style={{ marginBottom: 12 }}>
        ← Proyectos
      </button>
      <span className="badge good">RESULTADO REAL</span>
      <p className="muted" style={{ marginTop: 6 }}>
        {task.objective}
      </p>

      {isActive && (
        <div className="card">
          <p>Ejecutando... ({task.status})</p>
        </div>
      )}

      {!isActive && succeeded && (
        <div className="card">
          <h3 style={{ color: "var(--good)" }}>✓ TRABAJO TERMINADO</h3>
          {repairAttempts > 0 && (
            <p>Se detectó y corrigió automáticamente {repairAttempts} problema{repairAttempts === 1 ? "" : "s"} durante la validación.</p>
          )}
          {run?.structured_result && <p>{run.structured_result.summary}</p>}
          <p className="muted" style={{ marginBottom: 4 }}>
            Herramientas utilizadas
          </p>
          <p style={{ margin: 0 }}>Git ✓</p>
          {run?.structured_result && <p style={{ margin: 0 }}>Claude Code ✓</p>}
          {hasValidator && <p style={{ margin: 0 }}>Godot ✓</p>}
        </div>
      )}

      {!isActive && !succeeded && (
        <div className="card">
          <h3 style={{ color: "var(--danger)" }}>NO SE PUDO COMPLETAR LA TAREA</h3>
          <p>
            {validationBlocksKeep
              ? "Impulsor Hub intentó corregir el problema automáticamente, pero la validación continúa fallando."
              : "Ocurrió un problema al ejecutar esta tarea."}
          </p>
          <div className="row">
            <button className="secondary" onClick={() => setShowDetails(true)}>
              VER PROBLEMA
            </button>
            {canDispose && (
              <button className="danger" disabled={busy} onClick={() => act(() => api.rollbackRun(run!.id))}>
                DESHACER CAMBIOS
              </button>
            )}
          </div>
        </div>
      )}

      {!isActive && changes.length > 0 && (
        <div className="card">
          <p className="muted" style={{ marginBottom: 4 }}>
            Archivos modificados
          </p>
          {changes.map((c) => (
            <span className="diff-line" key={c.id}>
              {c.path}
            </span>
          ))}
        </div>
      )}

      {canPreview && (
        <div className="card">
          <p className="muted" style={{ marginBottom: 8 }}>
            Prueba el resultado en el motor real de Godot.
          </p>
          {cloud ? (
            webPreviewUrl ? (
              <>
                <p className="muted">Preview Web listo.</p>
                <a className="primary" href={webPreviewUrl} target="_blank" rel="noreferrer">
                  ABRIR PREVIEW
                </a>
              </>
            ) : (
              <button className="primary" disabled={exporting} onClick={handleStartPreview}>
                {exporting ? "Exportando..." : "PROBAR RESULTADO"}
              </button>
            )
          ) : preview === "running" ? (
            <>
              <p>Godot se está ejecutando...</p>
              <button className="secondary" onClick={handleStopPreview}>
                CERRAR PREVIEW
              </button>
            </>
          ) : (
            <button className="primary" onClick={handleStartPreview}>
              PROBAR RESULTADO
            </button>
          )}
          {previewError && <p style={{ color: "var(--danger)" }}>{previewError}</p>}
        </div>
      )}

      {run && (
        <div className="card">
          {validationBlocksKeep && run.disposition === "pending" && !isActive && (
            <div style={{ marginBottom: 10 }}>
              <label className="muted" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={confirmOverride} onChange={(e) => setConfirmOverride(e.target.checked)} />
                Entiendo que la validación falló y quiero conservar los cambios de todas formas
              </label>
            </div>
          )}
          <div className="row">
            <button className="danger" disabled={!canDispose || busy} onClick={() => act(() => api.rollbackRun(run.id))}>
              DESHACER CAMBIOS
            </button>
            <button
              className="primary"
              disabled={!canKeep || busy}
              onClick={() => act(() => api.keepRun(run.id, validationBlocksKeep && confirmOverride))}
            >
              CONSERVAR CAMBIOS
            </button>
          </div>
          {run.disposition === "kept" && <p className="result-line ok">✓ Cambios conservados</p>}
          {run.disposition === "rolled_back" && <p className="result-line ok">✓ Proyecto restaurado al estado anterior</p>}
          {isActive && (
            <button className="secondary" style={{ marginTop: 8 }} disabled={busy} onClick={() => act(() => api.cancelRun(run.id))}>
              Cancelar
            </button>
          )}
          {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
        </div>
      )}

      <details className="card" open={showDetails} onToggle={(e) => setShowDetails((e.target as HTMLDetailsElement).open)}>
        <summary>VER QUÉ OCURRIÓ</summary>

        {run?.structured_result && (
          <div style={{ marginTop: 12 }}>
            <h4>Resumen del ejecutor</h4>
            <p>{run.structured_result.summary}</p>
            {run.structured_result.warnings.length > 0 && (
              <p className="discrepancy">Avisos: {run.structured_result.warnings.join("; ")}</p>
            )}
          </div>
        )}

        {run && !run.structured_result && run.status !== "RUNNING" && run.status !== "PENDING" && (
          <p className="discrepancy">
            No se recibió un resultado estructurado verificado ({run.failure_reason ?? "razón desconocida"}).
          </p>
        )}

        <div style={{ marginTop: 12 }}>
          <h4>Cambios reales en Git ({changes.length})</h4>
          {changes.length === 0 && <p className="muted">No se observaron cambios de archivos.</p>}
          {changes.map((c) => (
            <div key={c.id} className={`diff-line ${changeClass(c.change_type)}`}>
              {c.change_type.padEnd(9)} {c.path}
              {c.additions != null && ` (+${c.additions}/-${c.deletions ?? 0})`}
              {!c.observed_by_vcs && " — reclamado pero NO observado"}
              {c.claimed_by_executor === false && " — observado pero NO reclamado"}
            </div>
          ))}
          {(claimedNotObserved.length > 0 || observedNotClaimed.length > 0) && (
            <p className="discrepancy" style={{ marginTop: 8 }}>
              Discrepancia: {claimedNotObserved.length} reclamado(s) sin observar, {observedNotClaimed.length} observado(s)
              sin reclamar.
            </p>
          )}
        </div>

        {hasValidator && (
          <div style={{ marginTop: 12 }}>
            <h4>Validación</h4>
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
                    {status === "fail" && errorCount > 0 ? ` (${errorCount})` : ""}
                  </span>
                </div>
              );
            })}
            {run?.validation_status && (
              <p style={{ marginTop: 8 }}>
                Final:{" "}
                <strong className={validationPassed ? "" : "discrepancy"}>
                  {validationPassed ? "VALIDATED" : run.validation_status.toUpperCase()}
                </strong>
              </p>
            )}
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <h4>Actividad</h4>
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
      </details>
    </div>
  );
}

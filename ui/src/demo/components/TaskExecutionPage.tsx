import { DemoTask } from "../types";
import { demoStore } from "../store";
import StepList from "./StepList";

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

export default function TaskExecutionPage({ task }: { task: DemoTask }) {
  if (task.running) {
    return (
      <div>
        <h2 className="dm-h2">Ejecutando tarea</h2>
        <p className="dm-muted" style={{ marginBottom: 18 }}>
          "{task.objective}"
        </p>
        <div className="dm-card">
          <StepList steps={task.steps} />
        </div>
      </div>
    );
  }

  // Only terminal (non-"running") steps belong in this summary -- the live
  // "en curso" steps are only meaningful while the engine is actually
  // running (see the branch above); showing one here would look like the
  // demo is still mid-validation on an already-finished task.
  const validationSteps = task.steps.filter(
    (s) => (s.technicalId.startsWith("validation.") || s.technicalId.startsWith("repair.")) && s.status !== "running"
  );
  const claudeStep = task.steps.find((s) => s.technicalId === "task.execution_finished");

  return (
    <div>
      <div className="dm-result-banner">
        <p className="dm-h2" style={{ margin: "4px 0" }}>
          Resultado
        </p>
        <p className="dm-result-line ok">✓ Tarea completada</p>
        {task.validated !== null && <p className="dm-result-line ok">{task.validated ? "✓ Validación superada" : "✗ Validación falló"}</p>}
      </div>

      <div className="dm-card">
        <p className="dm-card-title">Resumen</p>
        <p style={{ fontSize: 14.5, lineHeight: 1.5 }}>{task.summary}</p>
      </div>

      <div className="dm-card">
        <p className="dm-card-title">Archivos modificados</p>
        {task.filesModified.map((f) => (
          <span className="dm-file-chip" key={f}>
            {f}
          </span>
        ))}
      </div>

      {task.validated !== null && (
        <div className="dm-card">
          <p className="dm-card-title">Validación</p>
          <div className="dm-steps" style={{ marginBottom: 6 }}>
            {claudeStep && (
              <div className="dm-step">
                <span className="dm-step-icon success">✓</span>
                <div className="dm-step-label">Claude Code — cambios realizados</div>
              </div>
            )}
          </div>
          <StepList steps={validationSteps} />
        </div>
      )}

      <button
        className="dm-btn primary"
        onClick={() => demoStore.keep(task.id)}
        disabled={task.disposition !== "pending" || task.rollbackSteps.length > 0}
      >
        CONSERVAR CAMBIOS
      </button>
      <button
        className="dm-btn secondary"
        onClick={() => demoStore.rollback(task.id)}
        disabled={task.disposition !== "pending" || task.rollbackSteps.length > 0}
      >
        DESHACER CAMBIOS
      </button>

      {task.disposition === "kept" && (
        <div className="dm-card">
          <p className="dm-result-line ok">✓ Cambios conservados</p>
          <p className="dm-muted">Estado: Accepted</p>
        </div>
      )}
      {task.rollbackSteps.length > 0 && (
        <div className="dm-card">
          <StepList steps={task.rollbackSteps} />
          {task.disposition === "rolled_back" && (
            <p className="dm-muted" style={{ marginTop: 8 }}>
              Estado: Rolled back
            </p>
          )}
        </div>
      )}

      <details className="dm-disclosure">
        <summary>Ver detalles técnicos</summary>
        <div className="dm-card">
          <p className="dm-card-sub">Intentos: {task.attempts}</p>
          {task.steps.map((s) => (
            <div key={s.id} className="dm-activity-row">
              <div className="dm-activity-time">{formatTime(s.ts)}</div>
              <div>
                <div className="dm-activity-label">{s.label}</div>
                <div className="dm-activity-tech">
                  {s.technicalId}
                  {s.detail ? ` — ${s.detail}` : ""}
                </div>
              </div>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { api, Project, Resource, Task } from "../api/client";
import {
  PreviewStatus,
  projectPreviewStatus,
  startProjectPreview,
  startProjectWebexport,
  stopProjectPreview,
} from "../api/agentClient";
import { apiBaseUrl, isCloudMode } from "../api/workspaceMode";

const TYPE_LABEL: Record<string, string> = { godot: "Godot", generic: "Otro" };
const TEST_GAME_NAME = "Impulsor Hub Test Game (prueba)";
const SUGGESTED_OBJECTIVE = "Cambia el texto principal a 'Mi primer cambio con Impulsor Hub'";

function resourceCheck(r: Resource): string {
  if (r.availability !== "available") return "✗";
  if (r.adapter_key === "claude_code" && r.auth_state !== "authenticated") return "✗";
  return "✓";
}

export default function ProjectPage({
  projectId,
  onNewTask,
  onOpenTask,
  onBack,
}: {
  projectId: string;
  onNewTask: (suggestedObjective?: string) => void;
  onOpenTask: (taskId: string) => void;
  onBack: () => void;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [preview, setPreview] = useState<PreviewStatus>("not_started");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [webPreviewUrl, setWebPreviewUrl] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const previewTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const cloud = isCloudMode();

  useEffect(() => {
    api.getProject(projectId).then(setProject);
    api.listTasks(projectId).then(setTasks);
    api.projectResources(projectId).then(setResources);
  }, [projectId]);

  useEffect(() => () => {
    if (previewTimer.current) clearInterval(previewTimer.current);
  }, []);

  if (!project) return <p className="muted">Cargando...</p>;

  const isTestGame = project.name === TEST_GAME_NAME;
  const relevant = resources.filter((r) => r.adapter_key !== "godot" || project.project_type === "godot");

  const handleStartPreview = async () => {
    setPreviewError(null);
    if (cloud) {
      // M2.7 SPEC section M: a desktop Godot window on a server is not a
      // valid mobile preview -- cloud mode exports to Web instead and
      // hands back a static, browser-openable URL (no process to poll).
      setExporting(true);
      try {
        const { url } = await startProjectWebexport(projectId);
        setWebPreviewUrl(`${apiBaseUrl()}${url}`);
      } catch (e) {
        setPreviewError(String(e));
      } finally {
        setExporting(false);
      }
      return;
    }
    try {
      await startProjectPreview(projectId);
      setPreview("running");
      previewTimer.current = setInterval(async () => {
        const s = await projectPreviewStatus(projectId);
        setPreview(s.status);
        if (s.status !== "running" && previewTimer.current) {
          clearInterval(previewTimer.current);
          previewTimer.current = null;
        }
      }, 2000);
    } catch (e) {
      setPreviewError(String(e));
    }
  };

  const handleStopPreview = async () => {
    if (previewTimer.current) {
      clearInterval(previewTimer.current);
      previewTimer.current = null;
    }
    await stopProjectPreview(projectId);
    setPreview("stopped");
  };

  return (
    <div>
      <button className="secondary" onClick={onBack} style={{ marginBottom: 12 }}>
        ← Proyectos
      </button>
      <h2>{project.name}</h2>
      <span className="badge good">
        {isTestGame ? `PROYECTO REAL DE PRUEBA${cloud ? " — CLOUD" : ""}` : "PROYECTO REAL"}
      </span>
      <p className="muted" style={{ marginTop: 8 }}>
        Detectado: {TYPE_LABEL[project.project_type] ?? "Otro"}
      </p>
      {isTestGame && (
        <p className="muted">
          {cloud
            ? "Estos archivos existen realmente en tu workspace remoto. Puedes modificarlos, conservarlos o restaurarlos."
            : "Esta copia sí contiene archivos reales en tu computadora. Los cambios realizados aquí son reales, pero puedes restaurarlos."}
        </p>
      )}

      <div className="card">
        <p className="muted" style={{ marginBottom: 4 }}>
          Recursos disponibles
        </p>
        {relevant.map((r) => (
          <div key={r.id}>
            {r.display_name} {resourceCheck(r)}
          </div>
        ))}
      </div>

      {project.project_type === "godot" && (
        <div className="card">
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
                {exporting ? "Exportando..." : "PROBAR ESTADO ACTUAL"}
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
              PROBAR ESTADO ACTUAL
            </button>
          )}
          {previewError && <p style={{ color: "var(--danger)" }}>{previewError}</p>}
        </div>
      )}

      <details className="card">
        <summary>Detalles</summary>
        <p className="muted">{project.root_path}</p>
      </details>

      {isTestGame && tasks.length === 0 && (
        <div className="card">
          <p className="muted" style={{ marginBottom: 6 }}>
            ¿Qué quieres cambiar?
          </p>
          <p>"{SUGGESTED_OBJECTIVE}"</p>
          <button className="secondary" onClick={() => onNewTask(SUGGESTED_OBJECTIVE)}>
            USAR ESTE EJEMPLO
          </button>
        </div>
      )}

      <div className="row" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>Tareas</h3>
        <button className="primary" onClick={() => onNewTask()}>
          NUEVA TAREA
        </button>
      </div>

      {tasks.length === 0 && <p className="muted">Todavía no hay tareas.</p>}
      {tasks.map((t) => (
        <div key={t.id} className="card row" style={{ cursor: "pointer" }} onClick={() => onOpenTask(t.id)}>
          <div>
            <div>{t.objective}</div>
            <div className="muted">{new Date(t.created_at).toLocaleString()}</div>
          </div>
          <span className="badge">{t.status}</span>
        </div>
      ))}
    </div>
  );
}

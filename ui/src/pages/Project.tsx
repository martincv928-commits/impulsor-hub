import { useEffect, useState } from "react";
import { api, Project, Resource, Task } from "../api/client";

const TYPE_LABEL: Record<string, string> = { godot: "Godot", generic: "Otro" };

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
  onNewTask: () => void;
  onOpenTask: (taskId: string) => void;
  onBack: () => void;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);

  useEffect(() => {
    api.getProject(projectId).then(setProject);
    api.listTasks(projectId).then(setTasks);
    api.projectResources(projectId).then(setResources);
  }, [projectId]);

  if (!project) return <p className="muted">Cargando...</p>;

  const relevant = resources.filter((r) => r.adapter_key !== "godot" || project.project_type === "godot");

  return (
    <div>
      <button className="secondary" onClick={onBack} style={{ marginBottom: 12 }}>
        ← Proyectos
      </button>
      <h2>{project.name}</h2>
      <span className="badge good">PROYECTO REAL</span>
      <p className="muted" style={{ marginTop: 8 }}>
        Detectado: {TYPE_LABEL[project.project_type] ?? "Otro"}
      </p>

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

      <details className="card">
        <summary>Detalles</summary>
        <p className="muted">{project.root_path}</p>
      </details>

      <div className="row" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>Tareas</h3>
        <button className="primary" onClick={onNewTask}>
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

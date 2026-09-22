import { useState } from "react";
import { DemoProject, DemoTask } from "../types";
import { demoStore } from "../store";

const PLACEHOLDER: Record<DemoProject["type"], string> = {
  godot: "Agrega un sistema de vidas al personaje",
  web: "Cambia el texto principal de la portada",
  other: "Describe el cambio que quieres hacer",
};

export default function ProjectDetailPage({
  project,
  tasks,
  onRun,
  onOpenTask,
}: {
  project: DemoProject;
  tasks: DemoTask[];
  onRun: (taskId: string) => void;
  onOpenTask: (taskId: string) => void;
}) {
  const [objective, setObjective] = useState("");
  const [starting, setStarting] = useState(false);

  function execute() {
    if (!objective.trim() || starting) return;
    setStarting(true);
    const task = demoStore.startTask(project.id, objective.trim());
    onRun(task.id);
  }

  return (
    <div>
      <h2 className="dm-h2">{project.name}</h2>

      <div className="dm-card">
        <p className="dm-card-sub" style={{ marginBottom: 4 }}>
          Estado
        </p>
        <span className="dm-badge good">● Demo</span>
        <p className="dm-card-sub" style={{ marginTop: 14, marginBottom: 6 }}>
          Recursos
        </p>
        <p className="dm-muted" style={{ margin: "2px 0" }}>
          Claude Code — simulado
        </p>
        <p className="dm-muted" style={{ margin: "2px 0" }}>
          Git — simulado
        </p>
        {project.type === "godot" && (
          <p className="dm-muted" style={{ margin: "2px 0" }}>
            Godot 4 — simulado
          </p>
        )}
      </div>

      <div className="dm-card">
        <p className="dm-card-title">¿Qué quieres hacer?</p>
        <textarea
          className="dm-textarea"
          placeholder={PLACEHOLDER[project.type]}
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
        />
        <button className="dm-btn primary" style={{ marginTop: 12 }} disabled={!objective.trim() || starting} onClick={execute}>
          EJECUTAR
        </button>
      </div>

      {tasks.length > 0 && (
        <>
          <p className="dm-card-title" style={{ margin: "18px 0 8px" }}>
            Tareas anteriores
          </p>
          {tasks.map((t) => (
            <button
              key={t.id}
              className="dm-card"
              style={{ display: "block", width: "100%", textAlign: "left", cursor: "pointer" }}
              onClick={() => onOpenTask(t.id)}
            >
              <p className="dm-card-title" style={{ fontWeight: 400 }}>
                {t.objective}
              </p>
              <p className="dm-card-sub">
                {t.running ? "En curso…" : t.validated === false ? "Falló" : t.validated === null ? "Completada" : "Validada"}
                {" · "}
                {t.disposition === "kept" ? "Conservada" : t.disposition === "rolled_back" ? "Deshecha" : "Sin decidir"}
              </p>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

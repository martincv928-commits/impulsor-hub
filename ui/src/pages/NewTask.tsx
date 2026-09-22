import { useEffect, useState } from "react";
import { api, Project, Resource } from "../api/client";

export function claudeUnavailableReason(resources: Resource[]): string | null {
  const claude = resources.find((r) => r.adapter_key === "claude_code");
  if (!claude || claude.availability !== "available") return "Claude Code no está disponible en este equipo.";
  if (claude.auth_state === "not_authenticated") return "Claude Code está instalado pero no autenticado en este equipo.";
  return null;
}

export default function NewTaskPage({
  projectId,
  initialObjective,
  onCreated,
  onCancel,
}: {
  projectId: string;
  initialObjective?: string;
  onCreated: (taskId: string) => void;
  onCancel: () => void;
}) {
  const [objective, setObjective] = useState(initialObjective ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [resources, setResources] = useState<Resource[] | null>(null);

  useEffect(() => {
    api.getProject(projectId).then(setProject);
    api.projectResources(projectId).then(setResources);
  }, [projectId]);

  const handleRun = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const task = await api.createTask(projectId, objective.trim());
      await api.runTask(task.id);
      onCreated(task.id);
    } catch (e) {
      setError(String(e));
      setSubmitting(false);
    }
  };

  const blockedReason = resources ? claudeUnavailableReason(resources) : null;
  const godotUnavailable =
    resources && project?.project_type === "godot" && !resources.find((r) => r.adapter_key === "godot" && r.availability === "available");

  return (
    <div>
      <h2>¿Qué quieres hacer?</h2>
      <div className="card">
        {blockedReason ? (
          <p style={{ color: "var(--danger)" }}>{blockedReason}</p>
        ) : (
          <>
            {godotUnavailable && (
              <p className="discrepancy" style={{ marginBottom: 10 }}>
                Godot no está disponible en este equipo: este proyecto no podrá validarse ni probarse
                automáticamente.
              </p>
            )}
            <textarea
              rows={4}
              placeholder="Describe el cambio que quieres hacer en este proyecto..."
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
            />
          </>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="secondary" onClick={onCancel} disabled={submitting}>
            Cancelar
          </button>
          {!blockedReason && (
            <button className="primary" onClick={handleRun} disabled={!objective.trim() || submitting}>
              {submitting ? "Iniciando..." : "EJECUTAR"}
            </button>
          )}
        </div>
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      </div>
    </div>
  );
}

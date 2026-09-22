import { useEffect, useState } from "react";
import { api, Project } from "../api/client";
import { pickFolder } from "../api/agentClient";

const TYPE_LABEL: Record<string, string> = { godot: "Godot", generic: "Otro" };

export default function ProjectsPage({ onOpenProject }: { onOpenProject: (id: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [manualPath, setManualPath] = useState<string | null>(null);

  const refresh = () => api.listProjects().then(setProjects).catch((e) => setError(String(e)));

  useEffect(() => {
    refresh();
  }, []);

  const addFromPath = async (rootPath: string) => {
    setError(null);
    setLoading(true);
    try {
      await api.addProject(rootPath);
      setManualPath(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleChooseFolder = async () => {
    setError(null);
    setChoosing(true);
    try {
      const result = await pickFolder();
      if (result.error) {
        // No native dialog available (e.g. no display on this machine):
        // documented fallback, not a silent failure.
        setError(result.error);
        setManualPath("");
        return;
      }
      if (result.cancelled || !result.path) return;
      await addFromPath(result.path);
    } catch (e) {
      setError(String(e));
    } finally {
      setChoosing(false);
    }
  };

  return (
    <div>
      <h2>Proyectos</h2>

      <div className="card">
        <button className="primary" onClick={handleChooseFolder} disabled={choosing || loading}>
          {choosing ? "Abriendo selector..." : "ELEGIR CARPETA"}
        </button>{" "}
        <button className="secondary" disabled title="Próximamente">
          GITHUB (próximamente)
        </button>
        {manualPath !== null && (
          <div className="row" style={{ marginTop: 10 }}>
            <input
              type="text"
              placeholder="Ruta de la carpeta del proyecto"
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
            />
            <button className="primary" disabled={!manualPath.trim() || loading} onClick={() => addFromPath(manualPath.trim())}>
              Agregar
            </button>
          </div>
        )}
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      </div>

      {projects.length === 0 && <p className="muted">Todavía no agregaste ningún proyecto.</p>}

      {projects.map((p) => (
        <div key={p.id} className="card row" style={{ cursor: "pointer" }} onClick={() => onOpenProject(p.id)}>
          <div>
            <strong>{p.name}</strong>
            <div className="muted">Detectado: {TYPE_LABEL[p.project_type] ?? "Otro"}</div>
          </div>
          <span className="badge good">PROYECTO REAL</span>
        </div>
      ))}
    </div>
  );
}

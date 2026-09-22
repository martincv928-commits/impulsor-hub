import { useEffect, useState } from "react";
import { api, Project } from "../api/client";

export default function ProjectsPage({ onOpenProject }: { onOpenProject: (id: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [rootPath, setRootPath] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = () => api.listProjects().then(setProjects).catch((e) => setError(String(e)));

  useEffect(() => {
    refresh();
  }, []);

  const handleAdd = async () => {
    setError(null);
    setLoading(true);
    try {
      await api.addProject(rootPath.trim(), name.trim() || undefined);
      setRootPath("");
      setName("");
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h2>Projects</h2>

      <div className="card">
        <div className="row" style={{ marginBottom: 8 }}>
          <input
            type="text"
            placeholder="Absolute path to an existing local project"
            value={rootPath}
            onChange={(e) => setRootPath(e.target.value)}
          />
        </div>
        <div className="row">
          <input
            type="text"
            placeholder="Display name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="primary" onClick={handleAdd} disabled={!rootPath.trim() || loading}>
            Add Project
          </button>
        </div>
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      </div>

      {projects.length === 0 && <p className="muted">No projects yet. Add one above.</p>}

      {projects.map((p) => (
        <div key={p.id} className="card row" style={{ cursor: "pointer" }} onClick={() => onOpenProject(p.id)}>
          <div>
            <strong>{p.name}</strong>
            <div className="muted">{p.root_path}</div>
          </div>
          <span className="badge">{p.status}</span>
        </div>
      ))}
    </div>
  );
}

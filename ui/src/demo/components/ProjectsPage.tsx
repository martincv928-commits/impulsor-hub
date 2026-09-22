import { DemoProject } from "../types";

const TYPE_LABEL: Record<DemoProject["type"], string> = { godot: "Godot", web: "Web", other: "Otro" };

export default function ProjectsPage({
  projects,
  onOpen,
  onAdd,
}: {
  projects: DemoProject[];
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div>
      <h2 className="dm-h2">Proyectos</h2>
      <button className="dm-fab" onClick={onAdd}>
        + Agregar proyecto
      </button>
      {projects.length === 0 && <p className="dm-muted">Todavía no agregaste ningún proyecto.</p>}
      {projects.map((p) => (
        <button key={p.id} className="dm-card" style={{ display: "block", width: "100%", textAlign: "left", cursor: "pointer" }} onClick={() => onOpen(p.id)}>
          <p className="dm-card-title">{p.name}</p>
          <p className="dm-card-sub">
            {TYPE_LABEL[p.type]} · <span className="dm-badge good">● Demo</span>
          </p>
        </button>
      ))}
    </div>
  );
}

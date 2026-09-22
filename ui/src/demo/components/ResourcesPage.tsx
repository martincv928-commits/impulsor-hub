const RESOURCES = [
  { name: "Claude Code", desc: "IA para programación" },
  { name: "Godot 4", desc: "Motor / Validador" },
  { name: "Git", desc: "Control de versiones" },
];

export default function ResourcesPage() {
  return (
    <div>
      <h2 className="dm-h2">Recursos</h2>
      {RESOURCES.map((r) => (
        <div className="dm-card" key={r.name}>
          <p className="dm-card-title">{r.name}</p>
          <p className="dm-card-sub">{r.desc}</p>
          <span className="dm-badge good">
            <span className="dm-dot" /> Disponible
          </span>{" "}
          <span className="dm-badge">Demo</span>
        </div>
      ))}
    </div>
  );
}

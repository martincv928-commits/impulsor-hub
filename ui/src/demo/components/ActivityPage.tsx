import { useState } from "react";
import { DemoTask } from "../types";

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
}

export default function ActivityPage({ tasks }: { tasks: DemoTask[] }) {
  const [showTech, setShowTech] = useState(false);
  const rows = tasks
    .flatMap((t) => [...t.steps, ...t.rollbackSteps])
    .sort((a, b) => a.ts.localeCompare(b.ts))
    .reverse();

  return (
    <div>
      <h2 className="dm-h2">Actividad</h2>
      <label className="dm-muted" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <input type="checkbox" checked={showTech} onChange={(e) => setShowTech(e.target.checked)} />
        Mostrar ID técnico
      </label>
      {rows.length === 0 && <p className="dm-muted">Todavía no hay actividad. Ejecuta una tarea para ver el registro.</p>}
      <div className="dm-card">
        {rows.map((s) => (
          <div className="dm-activity-row" key={s.id}>
            <div className="dm-activity-time">{formatTime(s.ts)}</div>
            <div>
              <div className="dm-activity-label">{s.label}</div>
              {showTech && <div className="dm-activity-tech">{s.technicalId}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

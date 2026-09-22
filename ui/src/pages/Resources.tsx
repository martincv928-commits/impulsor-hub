import { useEffect, useState } from "react";
import { api, Resource } from "../api/client";

function statusBadge(r: Resource) {
  if (r.availability !== "available") return <span className="badge bad">○ No encontrado</span>;
  if (r.adapter_key === "claude_code" && r.auth_state === "not_authenticated") {
    return <span className="badge warn">● Instalado, no autenticado</span>;
  }
  if (r.adapter_key === "claude_code" && r.auth_state === "unknown") {
    return <span className="badge warn">● Estado de autenticación desconocido</span>;
  }
  return <span className="badge good">● Disponible</span>;
}

export default function ResourcesPage() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    api
      .getResources()
      .then(setResources)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div>
      <h2>Recursos de este equipo</h2>
      <p className="muted">Detección real: cada recurso se comprueba en este equipo, nunca se simula.</p>
      <button className="secondary" onClick={refresh} disabled={loading}>
        {loading ? "Comprobando..." : "Volver a comprobar"}
      </button>
      <div style={{ marginTop: 12 }}>
        {resources.map((r) => (
          <div key={r.id} className="card">
            <div className="row">
              <div>
                <strong>{r.display_name}</strong>
                <div className="muted">Versión: {r.version ?? "desconocida"}</div>
              </div>
              {statusBadge(r)}
            </div>
            {r.checked_at && (
              <div className="muted" style={{ marginTop: 6 }}>
                Comprobado {new Date(r.checked_at).toLocaleTimeString()}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

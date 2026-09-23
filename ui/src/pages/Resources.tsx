import { useEffect, useState } from "react";
import { api, Resource } from "../api/client";

function statusBadge(r: Resource) {
  if (r.availability !== "available") return <span className="badge bad">○ No encontrado</span>;
  if (r.type === "ai_executor" && r.auth_state === "not_authenticated") {
    return <span className="badge warn">● Instalado, no autenticado</span>;
  }
  if (r.type === "ai_executor" && r.auth_state === "unknown") {
    return <span className="badge warn">● Estado de autenticación desconocido</span>;
  }
  return <span className="badge good">● Disponible</span>;
}

function isFunctional(r: Resource): boolean {
  return r.availability === "available" && r.auth_state === "authenticated";
}

export default function ResourcesPage() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  const refresh = () => {
    setLoading(true);
    Promise.all([api.getResources(), api.getAiProvider()])
      .then(([r, p]) => {
        setResources(r);
        setActiveProvider(p.active);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  const aiProviders = resources.filter((r) => r.type === "ai_executor");
  const functionalProviders = aiProviders.filter(isFunctional);
  const noProviderConnected = aiProviders.length > 0 && functionalProviders.length === 0;

  const handleSelectProvider = async (adapterKey: string) => {
    setSwitching(true);
    try {
      await api.setAiProvider(adapterKey);
      setActiveProvider(adapterKey);
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div>
      <h2>Recursos de este equipo</h2>
      <p className="muted">Detección real: cada recurso se comprueba en este equipo, nunca se simula.</p>
      <button className="secondary" onClick={refresh} disabled={loading}>
        {loading ? "Comprobando..." : "Volver a comprobar"}
      </button>

      {noProviderConnected && (
        <div className="card" style={{ marginTop: 12, borderColor: "var(--warn)" }}>
          <p style={{ margin: 0 }}>
            Ningún proveedor de IA está conectado todavía. Impulsor Hub sigue funcionando (proyectos,
            Git, Godot), pero necesitas conectar una IA (Claude Code, Codex o Gemini) para ejecutar
            tareas.
          </p>
        </div>
      )}

      {functionalProviders.length > 1 && (
        <div className="card" style={{ marginTop: 12 }}>
          <p className="muted" style={{ marginBottom: 8 }}>
            Proveedor de IA activo
          </p>
          {functionalProviders.map((r) => (
            <label key={r.id} className="row" style={{ marginBottom: 6, cursor: "pointer" }}>
              <span>
                <input
                  type="radio"
                  name="ai-provider"
                  checked={activeProvider === r.adapter_key}
                  disabled={switching}
                  onChange={() => handleSelectProvider(r.adapter_key)}
                  style={{ marginRight: 8 }}
                />
                {r.display_name}
              </span>
            </label>
          ))}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        {resources.map((r) => (
          <div key={r.id} className="card">
            <div className="row">
              <div>
                <strong>{r.display_name}</strong>
                {r.type === "ai_executor" && activeProvider === r.adapter_key && (
                  <span className="badge" style={{ marginLeft: 8 }}>
                    ACTIVO
                  </span>
                )}
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

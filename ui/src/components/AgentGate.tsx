import { useEffect, useState } from "react";
import { checkAgentConnected } from "../api/agentClient";

export default function AgentGate({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);

  const check = () => {
    setChecking(true);
    checkAgentConnected()
      .then(setConnected)
      .finally(() => setChecking(false));
  };

  useEffect(() => {
    check();
  }, []);

  if (connected === null) {
    return (
      <div className="app-root">
        <p className="muted" style={{ padding: 24 }}>
          Buscando Impulsor Agent en este equipo...
        </p>
      </div>
    );
  }

  if (connected === false) {
    return (
      <div className="app-root">
        <div className="card" style={{ maxWidth: 480, margin: "48px auto", textAlign: "center" }}>
          <h2 style={{ marginTop: 0 }}>ESTE EQUIPO</h2>
          <p>
            <span className="badge bad">○ No conectado</span>
          </p>
          <p className="muted">
            Para trabajar con proyectos reales necesitas conectar este equipo. Impulsor Agent debe
            estar iniciado en esta máquina.
          </p>
          <button className="primary" onClick={check} disabled={checking}>
            {checking ? "Buscando..." : "CONECTAR / INSTALAR IMPULSOR AGENT"}
          </button>
          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            Si ya lo instalaste, ábrelo (o ejecuta el iniciador de Impulsor Hub) y vuelve a intentar.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

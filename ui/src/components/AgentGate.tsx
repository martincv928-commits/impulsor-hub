import { useEffect, useState } from "react";
import { AgentMode, checkAgentConnected } from "../api/agentClient";
import { WorkspaceModeValue } from "../api/workspaceMode";

export default function AgentGate({
  children,
  mode: workspaceMode,
  onChangeMode,
}: {
  children: React.ReactNode;
  mode?: WorkspaceModeValue;
  onChangeMode?: () => void;
}) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [agentMode, setAgentMode] = useState<AgentMode | undefined>(undefined);
  const [checking, setChecking] = useState(false);
  const isCloud = workspaceMode === "cloud";

  const check = () => {
    setChecking(true);
    checkAgentConnected()
      .then((r) => {
        setConnected(r.connected);
        setAgentMode(r.mode);
      })
      .finally(() => setChecking(false));
  };

  useEffect(() => {
    check();
  }, []);

  if (connected === null) {
    return (
      <div className="app-root">
        <p className="muted" style={{ padding: 24 }}>
          {isCloud ? "Conectando con tu workspace remoto..." : "Buscando Impulsor Agent en este equipo..."}
        </p>
      </div>
    );
  }

  if (connected === false) {
    return (
      <div className="app-root">
        <div className="card" style={{ maxWidth: 480, margin: "48px auto", textAlign: "center" }}>
          <h2 style={{ marginTop: 0 }}>{isCloud ? "WORKSPACE REMOTO" : "ESTE EQUIPO"}</h2>
          <p>
            <span className="badge bad">○ No conectado</span>
          </p>
          <p className="muted">
            {isCloud
              ? "No se pudo conectar con tu workspace remoto. Verifica la dirección y el código de acceso."
              : "Para trabajar con proyectos reales necesitas conectar este equipo. Impulsor Agent debe estar iniciado en esta máquina."}
          </p>
          <button className="primary" onClick={check} disabled={checking}>
            {checking ? "Buscando..." : isCloud ? "REINTENTAR" : "CONECTAR / INSTALAR IMPULSOR AGENT"}
          </button>
          {!isCloud && (
            <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
              Si ya lo instalaste, ábrelo (o ejecuta el iniciador de Impulsor Hub) y vuelve a intentar.
            </p>
          )}
          {onChangeMode && (
            <button className="secondary" style={{ width: "100%", marginTop: 12 }} onClick={onChangeMode}>
              ← Cambiar modo de trabajo
            </button>
          )}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

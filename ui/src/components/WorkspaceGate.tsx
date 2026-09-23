// M2.7 SPEC section J: the entry screen for the real (non-demo) app --
// "¿DÓNDE QUIERES TRABAJAR?" -- chosen once and persisted (workspaceMode.ts)
// so reloading the app doesn't ask again. Cloud mode additionally needs a
// one-time access-code exchange (section F: no OAuth, a single deploy-time
// secret traded for the same Bearer token the local Agent already uses).
import { useState } from "react";
import { createCloudSession } from "../api/agentClient";
import {
  clearMode,
  configuredCloudAgentUrl,
  getMode,
  hasCloudSession,
  setCloudSession,
  setLocalMode,
  WorkspaceModeValue,
} from "../api/workspaceMode";
import AgentGate from "./AgentGate";

export default function WorkspaceGate({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<WorkspaceModeValue | null>(getMode());
  const [sessionReady, setSessionReady] = useState(hasCloudSession());
  const [cloudUrl, setCloudUrl] = useState(configuredCloudAgentUrl() ?? "");
  const [accessCode, setAccessCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changeMode = () => {
    clearMode();
    setModeState(null);
    setSessionReady(false);
    setError(null);
  };

  if (mode === null) {
    return (
      <div className="app-root">
        <div className="card" style={{ maxWidth: 440, margin: "48px auto", textAlign: "center" }}>
          <h2 style={{ marginTop: 0 }}>IMPULSOR HUB</h2>
          <p className="muted">¿Dónde quieres trabajar?</p>
          <button
            className="primary"
            style={{ width: "100%", padding: "16px 14px", marginBottom: 10, fontSize: 15 }}
            onClick={() => setModeState("cloud")}
          >
            ☁️ WORKSPACE REMOTO
            <div className="muted" style={{ fontWeight: 400, marginTop: 4 }}>
              Trabaja desde este celular
            </div>
          </button>
          <button
            className="secondary"
            style={{ width: "100%", padding: "16px 14px" }}
            onClick={() => {
              setLocalMode();
              setModeState("local");
            }}
          >
            💻 ESTE EQUIPO
            <div className="muted" style={{ marginTop: 4 }}>
              Disponible cuando utilizas Impulsor Hub en una computadora con Agent
            </div>
          </button>
        </div>
      </div>
    );
  }

  if (mode === "cloud" && !sessionReady) {
    const submit = async () => {
      setBusy(true);
      setError(null);
      try {
        const token = await createCloudSession(cloudUrl.trim(), accessCode);
        setCloudSession(cloudUrl.trim(), token);
        setSessionReady(true);
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    };

    return (
      <div className="app-root">
        <div className="card" style={{ maxWidth: 440, margin: "48px auto" }}>
          <h2 style={{ marginTop: 0 }}>WORKSPACE REMOTO</h2>
          <p className="muted">Introduce la dirección de tu workspace remoto y el código de acceso.</p>
          {!configuredCloudAgentUrl() && (
            <>
              <label className="muted" style={{ display: "block", margin: "10px 0 4px" }}>
                Dirección del workspace remoto
              </label>
              <input
                type="text"
                placeholder="https://tu-workspace.example.com"
                value={cloudUrl}
                onChange={(e) => setCloudUrl(e.target.value)}
              />
            </>
          )}
          <label className="muted" style={{ display: "block", margin: "10px 0 4px" }}>
            Código de acceso
          </label>
          <input type="text" value={accessCode} onChange={(e) => setAccessCode(e.target.value)} />
          {error && (
            <p style={{ color: "var(--danger)" }}>{error}</p>
          )}
          <button
            className="primary"
            style={{ width: "100%", marginTop: 12 }}
            disabled={busy || !cloudUrl.trim() || !accessCode}
            onClick={submit}
          >
            {busy ? "Conectando..." : "CONECTAR"}
          </button>
          <button className="secondary" style={{ width: "100%", marginTop: 8 }} onClick={changeMode}>
            ← Cambiar modo de trabajo
          </button>
        </div>
      </div>
    );
  }

  return <AgentGate mode={mode} onChangeMode={changeMode}>{children}</AgentGate>;
}

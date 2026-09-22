import { useState } from "react";
import { DemoProjectType } from "../types";
import { demoStore } from "../store";

type Mode = "choose" | "folder" | "github" | "form";

function guessType(name: string): DemoProjectType {
  const lower = name.toLowerCase();
  if (/juego|game|godot/.test(lower)) return "godot";
  if (/web|p[aá]gina|landing|sitio/.test(lower)) return "web";
  return "other";
}

export default function AddProjectSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [mode, setMode] = useState<Mode>("choose");
  const [name, setName] = useState("");
  const [type, setType] = useState<"auto" | DemoProjectType>("auto");

  function submit() {
    const resolvedType = type === "auto" ? guessType(name) : type;
    const project = demoStore.addProject(name, resolvedType);
    onCreated(project.id);
  }

  return (
    <div className="dm-sheet-overlay" onClick={onClose}>
      <div className="dm-sheet" onClick={(e) => e.stopPropagation()}>
        {mode === "choose" && (
          <>
            <h2>Agregar proyecto</h2>
            <p className="dm-sheet-sub">¿Cómo quieres agregarlo?</p>
            <div className="dm-choice-grid">
              <button className="dm-choice disabled" onClick={() => setMode("folder")}>
                <div className="dm-choice-title">Carpeta</div>
                <div className="dm-choice-sub">Requiere la aplicación local</div>
              </button>
              <button className="dm-choice disabled" onClick={() => setMode("github")}>
                <div className="dm-choice-title">GitHub</div>
                <div className="dm-choice-sub">Próximamente</div>
              </button>
              <button className="dm-choice" onClick={() => setMode("form")}>
                <div className="dm-choice-title">Proyecto demo</div>
                <div className="dm-choice-sub">Funcional, sin archivos reales</div>
              </button>
            </div>
            <button className="dm-btn secondary" onClick={onClose}>
              Cancelar
            </button>
          </>
        )}

        {mode === "folder" && (
          <>
            <h2>Carpeta</h2>
            <p className="dm-sheet-sub">
              Para agregar un proyecto desde una carpeta real de tu computadora necesitas la
              aplicación local/de escritorio de Impulsor Hub. Esta demo web no tiene acceso al
              sistema de archivos de tu dispositivo.
            </p>
            <button className="dm-btn secondary" onClick={() => setMode("choose")}>
              Volver
            </button>
          </>
        )}

        {mode === "github" && (
          <>
            <h2>GitHub</h2>
            <p className="dm-sheet-sub">La integración con GitHub todavía no está disponible. Así se verá:</p>
            <button className="dm-btn secondary" disabled>
              Conectar con GitHub
            </button>
            <button className="dm-btn secondary" onClick={() => setMode("choose")} style={{ marginTop: 4 }}>
              Volver
            </button>
          </>
        )}

        {mode === "form" && (
          <>
            <h2>Proyecto demo</h2>
            <p className="dm-sheet-sub">Se crea solo en este navegador, sin archivos reales.</p>
            <label className="dm-label" htmlFor="dm-proj-name">
              Nombre del proyecto
            </label>
            <input
              id="dm-proj-name"
              className="dm-input"
              placeholder="Mi juego"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            <label className="dm-label" htmlFor="dm-proj-type">
              Tipo
            </label>
            <select id="dm-proj-type" className="dm-select" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="auto">Auto detectar</option>
              <option value="godot">Godot</option>
              <option value="web">Web</option>
              <option value="other">Otro</option>
            </select>
            <button className="dm-btn primary" style={{ marginTop: 18 }} disabled={!name.trim()} onClick={submit}>
              CREAR PROYECTO DEMO
            </button>
            <button className="dm-btn secondary" onClick={() => setMode("choose")}>
              Volver
            </button>
          </>
        )}
      </div>
    </div>
  );
}

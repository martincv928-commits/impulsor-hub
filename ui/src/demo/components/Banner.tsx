import { useState } from "react";

export default function Banner() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="dm-banner">
        <span>
          <strong>DEMO INTERACTIVA</strong> — simulación segura, sin cambios reales.
        </span>
        <button className="dm-banner-more" onClick={() => setOpen((v) => !v)}>
          {open ? "Ocultar" : "Más información"}
        </button>
      </div>
      {open && (
        <div className="dm-banner-detail">
          Estás usando una simulación segura. No se modificarán archivos reales, no se
          ejecuta Claude Code ni Godot de verdad, y no se consumen tus cuentas de IA.
          Todo lo que ves aquí ocurre en tu navegador.
        </div>
      )}
    </div>
  );
}

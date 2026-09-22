import { useState } from "react";
import { demoStore } from "../store";
import type { DemoView } from "../DemoApp";

const NAV_ITEMS: { view: DemoView["name"]; label: string }[] = [
  { view: "projects", label: "Proyectos" },
  { view: "resources", label: "Recursos" },
  { view: "activity", label: "Actividad" },
];

export default function Shell({
  title,
  view,
  onNavigate,
  children,
}: {
  title: string;
  view: DemoView;
  onNavigate: (name: "projects" | "resources" | "activity") => void;
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const nav = (
    <>
      <h2>Impulsor Hub</h2>
      {NAV_ITEMS.map((item) => (
        <button
          key={item.view}
          className={`dm-nav-item ${view.name === item.view ? "active" : ""}`}
          onClick={() => {
            onNavigate(item.view as "projects" | "resources" | "activity");
            setDrawerOpen(false);
          }}
        >
          {item.label}
        </button>
      ))}
      <div className="dm-drawer-footer">
        <button
          className="dm-reset-btn"
          onClick={() => {
            if (window.confirm("¿Restablecer la demo? Se borrarán los proyectos y tareas creados en este navegador.")) {
              demoStore.reset();
              onNavigate("projects");
              setDrawerOpen(false);
            }
          }}
        >
          Restablecer demo
        </button>
      </div>
    </>
  );

  return (
    <div className="dm-shell">
      {drawerOpen && <div className="dm-drawer-overlay" onClick={() => setDrawerOpen(false)} />}
      <div className={`dm-drawer ${drawerOpen ? "open" : ""}`}>{nav}</div>
      <div className="dm-main-col">
        <div className="dm-header">
          <button className="dm-hamburger" onClick={() => setDrawerOpen(true)} aria-label="Abrir menú">
            ☰
          </button>
          <h1>{title}</h1>
        </div>
        <div className="dm-main">{children}</div>
      </div>
    </div>
  );
}

import { useState } from "react";
import ProjectsPage from "./pages/Projects";
import ProjectPage from "./pages/Project";
import NewTaskPage from "./pages/NewTask";
import TaskResultPage from "./pages/TaskResult";
import ResourcesPage from "./pages/Resources";
import { DEMO_MODE } from "./api/client";
import DemoApp from "./demo/DemoApp";
import WorkspaceGate from "./components/WorkspaceGate";
import { isCloudMode } from "./api/workspaceMode";

export type View =
  | { name: "projects" }
  | { name: "project"; projectId: string }
  | { name: "newTask"; projectId: string; suggestedObjective?: string }
  | { name: "taskResult"; taskId: string }
  | { name: "resources" };

export default function App() {
  const [view, setView] = useState<View>({ name: "projects" });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const cloud = isCloudMode();

  // DEMO_MODE renders an entirely separate, mobile-first UI tree backed by
  // DemoTaskEngine (see ui/src/demo/) instead of this real-mode app. See
  // M2_5B_REPORT.md for the mode-separation rationale -- DemoApp never
  // imports `api`/ApiClient, and this tree never imports anything from
  // ui/src/demo/.
  if (DEMO_MODE) {
    return <DemoApp />;
  }

  const goto = (v: View) => {
    setView(v);
    setDrawerOpen(false);
  };

  return (
    <WorkspaceGate>
      <div className="app-root">
        <header className="app-header">
          <button className="hamburger" aria-label="Menú" onClick={() => setDrawerOpen(true)}>
            ☰
          </button>
          <h1>Impulsor Hub</h1>
        </header>
        {drawerOpen && <div className="sidebar-overlay" onClick={() => setDrawerOpen(false)} />}
        <div className="app-shell">
        <nav className={`sidebar ${drawerOpen ? "open" : ""}`}>
          <h1>Impulsor Hub</h1>
          <button
            className={`nav-item ${view.name === "projects" ? "active" : ""}`}
            onClick={() => goto({ name: "projects" })}
          >
            Proyectos
          </button>
          <button
            className={`nav-item ${view.name === "resources" ? "active" : ""}`}
            onClick={() => goto({ name: "resources" })}
          >
            Recursos
          </button>
          <div className="muted" style={{ marginTop: "auto", paddingTop: 16, fontSize: 12 }}>
            {cloud ? "WORKSPACE REMOTO" : "ESTE EQUIPO"} <span className="badge good">● Conectado</span>
          </div>
        </nav>
        <main className="main">
          {view.name === "projects" && <ProjectsPage onOpenProject={(id) => setView({ name: "project", projectId: id })} />}
          {view.name === "project" && (
            <ProjectPage
              projectId={view.projectId}
              onNewTask={(suggestedObjective) => setView({ name: "newTask", projectId: view.projectId, suggestedObjective })}
              onOpenTask={(taskId) => setView({ name: "taskResult", taskId })}
              onBack={() => setView({ name: "projects" })}
            />
          )}
          {view.name === "newTask" && (
            <NewTaskPage
              projectId={view.projectId}
              initialObjective={view.suggestedObjective}
              onCreated={(taskId) => setView({ name: "taskResult", taskId })}
              onCancel={() => setView({ name: "project", projectId: view.projectId })}
            />
          )}
          {view.name === "taskResult" && (
            <TaskResultPage taskId={view.taskId} onBack={() => setView({ name: "projects" })} />
          )}
          {view.name === "resources" && <ResourcesPage />}
        </main>
        </div>
      </div>
    </WorkspaceGate>
  );
}

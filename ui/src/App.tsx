import { useState } from "react";
import ProjectsPage from "./pages/Projects";
import ProjectPage from "./pages/Project";
import NewTaskPage from "./pages/NewTask";
import TaskResultPage from "./pages/TaskResult";
import ResourcesPage from "./pages/Resources";
import { DEMO_MODE } from "./api/client";
import DemoApp from "./demo/DemoApp";
import AgentGate from "./components/AgentGate";

export type View =
  | { name: "projects" }
  | { name: "project"; projectId: string }
  | { name: "newTask"; projectId: string; suggestedObjective?: string }
  | { name: "taskResult"; taskId: string }
  | { name: "resources" };

export default function App() {
  const [view, setView] = useState<View>({ name: "projects" });

  // DEMO_MODE renders an entirely separate, mobile-first UI tree backed by
  // DemoTaskEngine (see ui/src/demo/) instead of this real-mode app. See
  // M2_5B_REPORT.md for the mode-separation rationale -- DemoApp never
  // imports `api`/ApiClient, and this tree never imports anything from
  // ui/src/demo/.
  if (DEMO_MODE) {
    return <DemoApp />;
  }

  return (
    <AgentGate>
      <div className="app-root">
        <div className="app-shell">
        <nav className="sidebar">
          <h1>Impulsor Hub</h1>
          <button
            className={`nav-item ${view.name === "projects" ? "active" : ""}`}
            onClick={() => setView({ name: "projects" })}
          >
            Proyectos
          </button>
          <button
            className={`nav-item ${view.name === "resources" ? "active" : ""}`}
            onClick={() => setView({ name: "resources" })}
          >
            Recursos
          </button>
          <div className="muted" style={{ marginTop: "auto", paddingTop: 16, fontSize: 12 }}>
            ESTE EQUIPO <span className="badge good">● Conectado</span>
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
    </AgentGate>
  );
}

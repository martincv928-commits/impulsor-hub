import { useState } from "react";
import ProjectsPage from "./pages/Projects";
import ProjectPage from "./pages/Project";
import NewTaskPage from "./pages/NewTask";
import TaskResultPage from "./pages/TaskResult";
import ResourcesPage from "./pages/Resources";
import { DEMO_MODE } from "./api/client";
import { DEMO_NOTICE } from "./api/demoData";

export type View =
  | { name: "projects" }
  | { name: "project"; projectId: string }
  | { name: "newTask"; projectId: string }
  | { name: "taskResult"; taskId: string }
  | { name: "resources" };

export default function App() {
  const [view, setView] = useState<View>({ name: "projects" });

  return (
    <div className="app-root">
      {DEMO_MODE && <div className="demo-banner">{DEMO_NOTICE}</div>}
      <div className="app-shell">
      <nav className="sidebar">
        <h1>Impulsor Hub</h1>
        <button
          className={`nav-item ${view.name === "projects" ? "active" : ""}`}
          onClick={() => setView({ name: "projects" })}
        >
          Projects
        </button>
        <button
          className={`nav-item ${view.name === "resources" ? "active" : ""}`}
          onClick={() => setView({ name: "resources" })}
        >
          Resources
        </button>
      </nav>
      <main className="main">
        {view.name === "projects" && <ProjectsPage onOpenProject={(id) => setView({ name: "project", projectId: id })} />}
        {view.name === "project" && (
          <ProjectPage
            projectId={view.projectId}
            onNewTask={() => setView({ name: "newTask", projectId: view.projectId })}
            onOpenTask={(taskId) => setView({ name: "taskResult", taskId })}
            onBack={() => setView({ name: "projects" })}
          />
        )}
        {view.name === "newTask" && (
          <NewTaskPage
            projectId={view.projectId}
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
  );
}

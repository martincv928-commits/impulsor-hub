import { useState } from "react";
import "./demo.css";
import { useDemoStore } from "./useDemoStore";
import Banner from "./components/Banner";
import Onboarding from "./components/Onboarding";
import Shell from "./components/Shell";
import ProjectsPage from "./components/ProjectsPage";
import AddProjectSheet from "./components/AddProjectSheet";
import ProjectDetailPage from "./components/ProjectDetailPage";
import TaskExecutionPage from "./components/TaskExecutionPage";
import ResourcesPage from "./components/ResourcesPage";
import ActivityPage from "./components/ActivityPage";

export type DemoView =
  | { name: "projects" }
  | { name: "project"; projectId: string }
  | { name: "task"; taskId: string }
  | { name: "resources" }
  | { name: "activity" };

const TITLES: Record<DemoView["name"], string> = {
  projects: "Proyectos",
  project: "Proyecto",
  task: "Tarea",
  resources: "Recursos",
  activity: "Actividad",
};

export default function DemoApp() {
  const state = useDemoStore();
  const [view, setView] = useState<DemoView>({ name: "projects" });
  const [addOpen, setAddOpen] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(state.onboardingSeen);

  if (!onboardingDone) {
    return <Onboarding onDone={() => setOnboardingDone(true)} />;
  }

  const project = view.name === "project" ? state.projects.find((p) => p.id === view.projectId) : undefined;
  const task = view.name === "task" ? state.tasks.find((t) => t.id === view.taskId) : undefined;
  const taskProject = task ? state.projects.find((p) => p.id === task.projectId) : undefined;

  let title = TITLES[view.name];
  if (view.name === "project" && project) title = project.name;
  if (view.name === "task" && task) title = task.running ? "Ejecutando..." : "Resultado";

  return (
    <div className="dm-root">
      <Banner />
      <Shell title={title} view={view} onNavigate={(name) => setView({ name } as DemoView)}>
        {view.name === "projects" && (
          <ProjectsPage
            projects={state.projects}
            onOpen={(id) => setView({ name: "project", projectId: id })}
            onAdd={() => setAddOpen(true)}
          />
        )}
        {view.name === "project" && project && (
          <>
            <button className="dm-back" onClick={() => setView({ name: "projects" })}>
              ← Volver a proyectos
            </button>
            <ProjectDetailPage
              project={project}
              tasks={state.tasks.filter((t) => t.projectId === project.id)}
              onRun={(taskId) => setView({ name: "task", taskId })}
              onOpenTask={(taskId) => setView({ name: "task", taskId })}
            />
          </>
        )}
        {view.name === "task" && task && taskProject && (
          <>
            <button className="dm-back" onClick={() => setView({ name: "project", projectId: task.projectId })}>
              ← Volver al proyecto
            </button>
            <TaskExecutionPage
              task={task}
              project={taskProject}
              onTryAnother={() => setView({ name: "project", projectId: task.projectId })}
            />
          </>
        )}
        {view.name === "resources" && <ResourcesPage />}
        {view.name === "activity" && <ActivityPage tasks={state.tasks} />}
      </Shell>

      {addOpen && (
        <AddProjectSheet
          onClose={() => setAddOpen(false)}
          onCreated={(id) => {
            setAddOpen(false);
            setView({ name: "project", projectId: id });
          }}
        />
      )}
    </div>
  );
}

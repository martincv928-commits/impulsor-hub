import { useEffect, useState } from "react";
import { api, Project, Task } from "../api/client";

export default function ProjectPage({
  projectId,
  onNewTask,
  onOpenTask,
  onBack,
}: {
  projectId: string;
  onNewTask: () => void;
  onOpenTask: (taskId: string) => void;
  onBack: () => void;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    api.getProject(projectId).then(setProject);
    api.listTasks(projectId).then(setTasks);
  }, [projectId]);

  if (!project) return <p className="muted">Loading...</p>;

  return (
    <div>
      <button className="secondary" onClick={onBack} style={{ marginBottom: 12 }}>
        ← Projects
      </button>
      <h2>{project.name}</h2>
      <p className="muted">{project.root_path}</p>

      <div className="row" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>Tasks</h3>
        <button className="primary" onClick={onNewTask}>
          New Task
        </button>
      </div>

      {tasks.length === 0 && <p className="muted">No tasks yet.</p>}
      {tasks.map((t) => (
        <div key={t.id} className="card row" style={{ cursor: "pointer" }} onClick={() => onOpenTask(t.id)}>
          <div>
            <div>{t.objective}</div>
            <div className="muted">{new Date(t.created_at).toLocaleString()}</div>
          </div>
          <span className="badge">{t.status}</span>
        </div>
      ))}
    </div>
  );
}

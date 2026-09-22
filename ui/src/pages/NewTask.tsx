import { useState } from "react";
import { api } from "../api/client";

export default function NewTaskPage({
  projectId,
  onCreated,
  onCancel,
}: {
  projectId: string;
  onCreated: (taskId: string) => void;
  onCancel: () => void;
}) {
  const [objective, setObjective] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleRun = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const task = await api.createTask(projectId, objective.trim());
      await api.runTask(task.id);
      onCreated(task.id);
    } catch (e) {
      setError(String(e));
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h2>New Task</h2>
      <div className="card">
        <label className="muted">Objective</label>
        <textarea
          rows={4}
          placeholder="Describe what you want the AI executor to do in this project..."
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
        />
        <div className="row" style={{ marginTop: 12 }}>
          <button className="secondary" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button className="primary" onClick={handleRun} disabled={!objective.trim() || submitting}>
            {submitting ? "Starting..." : "Run"}
          </button>
        </div>
        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
      </div>
    </div>
  );
}

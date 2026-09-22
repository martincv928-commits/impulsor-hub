import { useEffect, useState } from "react";
import { api, Resource } from "../api/client";

function statusBadge(r: Resource) {
  if (r.availability !== "available") return <span className="badge bad">unavailable</span>;
  if (r.auth_state === "not_authenticated") return <span className="badge bad">not authenticated</span>;
  if (r.auth_state === "unknown") return <span className="badge warn">unknown auth</span>;
  return <span className="badge good">healthy</span>;
}

export default function ResourcesPage() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    api
      .getResources()
      .then(setResources)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div>
      <h2>Resources</h2>
      <p className="muted">Detection and health for the two M1 resources: Git and the Claude Code CLI.</p>
      <button className="secondary" onClick={refresh} disabled={loading}>
        {loading ? "Checking..." : "Re-check"}
      </button>
      <div style={{ marginTop: 12 }}>
        {resources.map((r) => (
          <div key={r.id} className="card">
            <div className="row">
              <div>
                <strong>{r.display_name}</strong>
                <div className="muted">
                  {r.type} · {r.version ?? "version unknown"} · cost: {r.cost_type}
                </div>
              </div>
              {statusBadge(r)}
            </div>
            <div className="muted" style={{ marginTop: 6 }}>
              capabilities: {r.capabilities.join(", ") || "none"}
              {r.checked_at && <> · checked {new Date(r.checked_at).toLocaleTimeString()}</>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Real-mode-only helpers outside the ApiClient contract: Agent liveness
// (M2.6 SPEC section D), the native folder picker (section F), the
// M2.6.1 test-game / project-scoped preview additions, and M2.7's Web
// export preview + cloud session bootstrap. Never imported by
// ui/src/demo/*.
import { activeToken, apiBaseUrl } from "./workspaceMode";
import { Project } from "./types";

export interface PickFolderResult {
  path: string | null;
  cancelled: boolean;
  error: string | null;
}

export type PreviewStatus = "not_started" | "running" | "stopped";
export type AgentMode = "local" | "cloud";

async function agentRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const token = activeToken();
  const resp = await fetch(`${apiBaseUrl()}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });
  if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
  return resp.json() as Promise<T>;
}

export async function checkAgentConnected(
  baseUrl: string = apiBaseUrl(),
  timeoutMs = 3000
): Promise<{ connected: boolean; mode?: AgentMode }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${baseUrl}/api/agent/status`, { signal: controller.signal });
    if (!resp.ok) return { connected: false };
    const body = await resp.json();
    return { connected: true, mode: body.mode };
  } catch {
    return { connected: false };
  } finally {
    clearTimeout(timer);
  }
}

export async function createCloudSession(baseUrl: string, accessCode: string): Promise<string> {
  const resp = await fetch(`${baseUrl}/api/cloud/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_code: accessCode }),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(body.detail || `${resp.status} ${resp.statusText}`);
  }
  const { token } = await resp.json();
  return token;
}

export const pickFolder = () => agentRequest<PickFolderResult>("/api/agent/pick-folder", { method: "POST" });

export const startPreview = (runId: string) =>
  agentRequest<{ status: PreviewStatus; pid?: number }>(`/api/task-runs/${runId}/preview/start`, { method: "POST" });

export const previewStatus = (runId: string) =>
  agentRequest<{ status: PreviewStatus; pid?: number; exit_code?: number }>(`/api/task-runs/${runId}/preview/status`);

export const stopPreview = (runId: string) =>
  agentRequest<{ status: PreviewStatus }>(`/api/task-runs/${runId}/preview/stop`, { method: "POST" });

export const startProjectPreview = (projectId: string) =>
  agentRequest<{ status: PreviewStatus; pid?: number }>(`/api/projects/${projectId}/preview/start`, {
    method: "POST",
  });

export const projectPreviewStatus = (projectId: string) =>
  agentRequest<{ status: PreviewStatus; pid?: number; exit_code?: number }>(
    `/api/projects/${projectId}/preview/status`
  );

export const stopProjectPreview = (projectId: string) =>
  agentRequest<{ status: PreviewStatus }>(`/api/projects/${projectId}/preview/stop`, { method: "POST" });

export const createTestGameProject = () => agentRequest<Project>("/api/test-game", { method: "POST" });

// M2.7: Godot Web export preview (cloud mode's substitute for the desktop
// preview process above -- a server-side desktop Godot window is not
// reachable from an Android browser, so cloud mode exports to Web and
// serves the static build instead; see app/api/routers/webexport.py).
export const startProjectWebexport = (projectId: string) =>
  agentRequest<{ status: "ready"; url: string }>(`/api/projects/${projectId}/webexport/start`, { method: "POST" });

export const startRunWebexport = (runId: string) =>
  agentRequest<{ status: "ready"; url: string }>(`/api/task-runs/${runId}/webexport/start`, { method: "POST" });

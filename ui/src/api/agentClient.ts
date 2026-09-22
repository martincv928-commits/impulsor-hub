// Real-mode-only helpers outside the ApiClient contract: Agent liveness
// (M2.6 SPEC section D), the native folder picker (section F), and the
// M2.6.1 test-game / project-scoped preview additions. Never imported by
// ui/src/demo/*.
import { agentToken } from "./client";
import { Project } from "./types";

export interface PickFolderResult {
  path: string | null;
  cancelled: boolean;
  error: string | null;
}

export type PreviewStatus = "not_started" | "running" | "stopped";

async function agentRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const token = agentToken();
  const resp = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });
  if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
  return resp.json() as Promise<T>;
}

export async function checkAgentConnected(timeoutMs = 3000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch("/api/agent/status", { signal: controller.signal });
    return resp.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
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

// Real-mode-only helpers outside the ApiClient contract: Agent liveness
// (M2.6 SPEC section D) and the native folder picker (section F). Never
// imported by ui/src/demo/*.
import { agentToken } from "./client";

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

import {
  ApiClient,
  EventItem,
  ExecutorResult,
  FileChange,
  Project,
  Resource,
  Task,
  TaskRun,
} from "./types";

export type { Project, Resource, Task, ExecutorResult, TaskRun, FileChange, EventItem };

export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";

declare global {
  interface Window {
    // Injected inline by app/api/main.py's `GET /` handler when the Agent
    // serves this build itself (see app/core/security.py). Absent in the
    // Vite dev server, where VITE_AGENT_TOKEN (a dev-only .env value) is
    // used instead -- a developer running the two processes separately
    // must set it to match IMPULSOR_HUB_AGENT_TOKEN on the backend.
    __IMPULSOR_AGENT_TOKEN__?: string;
  }
}

export function agentToken(): string | undefined {
  return typeof window !== "undefined" && window.__IMPULSOR_AGENT_TOKEN__
    ? window.__IMPULSOR_AGENT_TOKEN__
    : import.meta.env.VITE_AGENT_TOKEN;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = agentToken();
  const resp = await fetch(`/api${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`${resp.status} ${resp.statusText}: ${body}`);
  }
  if (resp.status === 204) return undefined as T;
  return resp.json() as Promise<T>;
}

const realApi: ApiClient = {
  listProjects: () => request<Project[]>("/projects"),
  addProject: (root_path: string, name?: string) =>
    request<Project>("/projects", { method: "POST", body: JSON.stringify({ root_path, name }) }),
  getProject: (id: string) => request<Project>(`/projects/${id}`),
  projectResources: (id: string) => request<Resource[]>(`/projects/${id}/resources`),
  getResources: () => request<Resource[]>("/resources"),

  listTasks: (projectId: string) => request<Task[]>(`/projects/${projectId}/tasks`),
  createTask: (projectId: string, objective: string) =>
    request<Task>(`/projects/${projectId}/tasks`, { method: "POST", body: JSON.stringify({ objective }) }),
  getTask: (id: string) => request<Task>(`/tasks/${id}`),
  runTask: (id: string, timeout_seconds?: number) =>
    request<{ task_id: string; accepted: boolean }>(`/tasks/${id}/run`, {
      method: "POST",
      body: JSON.stringify({ timeout_seconds }),
    }),

  listTaskRuns: (taskId: string) => request<TaskRun[]>(`/tasks/${taskId}/runs`),
  getTaskRun: (id: string) => request<TaskRun>(`/task-runs/${id}`),
  getTaskRunChanges: (id: string) => request<FileChange[]>(`/task-runs/${id}/changes`),
  keepRun: (id: string, override?: boolean) =>
    request<{ disposition: string; override: boolean }>(`/task-runs/${id}/keep`, {
      method: "POST",
      body: JSON.stringify({ override: override ?? false }),
    }),
  rollbackRun: (id: string) => request<{ disposition: string }>(`/task-runs/${id}/rollback`, { method: "POST" }),
  cancelRun: (id: string) => request<{ signalled: boolean }>(`/task-runs/${id}/cancel`, { method: "POST" }),

  getEvents: (params: { project_id?: string; task_id?: string; task_run_id?: string }) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]
    ).toString();
    return request<EventItem[]>(`/events?${qs}`);
  },
};

// Demo Mode no longer goes through this client at all -- see
// ui/src/demo/ (DemoTaskEngine + its own localStorage-backed store).
// `api` here is always the real, fetch-based client; DEMO_MODE only
// decides which top-level component App.tsx renders.
export const api: ApiClient = realApi;

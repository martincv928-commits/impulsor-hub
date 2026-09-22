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
import { demoApi } from "./demoClient";

export type { Project, Resource, Task, ExecutorResult, TaskRun, FileChange, EventItem };

export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
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

export const api: ApiClient = DEMO_MODE ? demoApi : realApi;

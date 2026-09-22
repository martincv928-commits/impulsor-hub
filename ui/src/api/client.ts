export interface Project {
  id: string;
  name: string;
  root_path: string;
  project_type: string;
  created_at: string;
  updated_at: string;
  status: string;
}

export interface Resource {
  id: string;
  adapter_key: string;
  type: string;
  display_name: string;
  version: string | null;
  availability: string;
  auth_state: string | null;
  cost_type: string;
  capabilities: string[];
  health: Record<string, unknown>;
  checked_at: string | null;
}

export interface Task {
  id: string;
  project_id: string;
  objective: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ExecutorResult {
  task_id: string;
  status: string;
  summary: string;
  files_claimed_modified: string[];
  files_claimed_created: string[];
  files_claimed_deleted: string[];
  commands_executed: string[];
  warnings: string[];
  recommended_validation: string[];
}

export interface TaskRun {
  id: string;
  task_id: string;
  executor_resource_id: string | null;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  timeout_seconds: number;
  structured_result: ExecutorResult | null;
  stdout_path: string | null;
  stderr_path: string | null;
  failure_reason: string | null;
  disposition: "pending" | "kept" | "rolled_back";
}

export interface FileChange {
  id: string;
  task_run_id: string;
  path: string;
  change_type: string;
  additions: number | null;
  deletions: number | null;
  claimed_by_executor: boolean | null;
  observed_by_vcs: boolean;
}

export interface EventItem {
  id: string;
  project_id: string | null;
  task_id: string | null;
  task_run_id: string | null;
  type: string;
  severity: string;
  payload: Record<string, unknown>;
  created_at: string;
}

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

export const api = {
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
  keepRun: (id: string) => request<{ disposition: string }>(`/task-runs/${id}/keep`, { method: "POST" }),
  rollbackRun: (id: string) => request<{ disposition: string }>(`/task-runs/${id}/rollback`, { method: "POST" }),
  cancelRun: (id: string) => request<{ signalled: boolean }>(`/task-runs/${id}/cancel`, { method: "POST" }),

  getEvents: (params: { project_id?: string; task_id?: string; task_run_id?: string }) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]
    ).toString();
    return request<EventItem[]>(`/events?${qs}`);
  },
};

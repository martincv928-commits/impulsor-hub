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
  validation_status: "pass" | "fail" | "error" | "timeout" | null;
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

export interface ApiClient {
  listProjects: () => Promise<Project[]>;
  addProject: (root_path: string, name?: string) => Promise<Project>;
  getProject: (id: string) => Promise<Project>;
  projectResources: (id: string) => Promise<Resource[]>;
  getResources: () => Promise<Resource[]>;
  getAiProvider: () => Promise<{ active: string; available: string[] }>;
  setAiProvider: (provider: string) => Promise<{ active: string }>;

  listTasks: (projectId: string) => Promise<Task[]>;
  createTask: (projectId: string, objective: string) => Promise<Task>;
  getTask: (id: string) => Promise<Task>;
  runTask: (id: string, timeout_seconds?: number) => Promise<{ task_id: string; accepted: boolean }>;

  listTaskRuns: (taskId: string) => Promise<TaskRun[]>;
  getTaskRun: (id: string) => Promise<TaskRun>;
  getTaskRunChanges: (id: string) => Promise<FileChange[]>;
  keepRun: (id: string, override?: boolean) => Promise<{ disposition: string; override: boolean }>;
  rollbackRun: (id: string) => Promise<{ disposition: string }>;
  cancelRun: (id: string) => Promise<{ signalled: boolean }>;

  getEvents: (params: { project_id?: string; task_id?: string; task_run_id?: string }) => Promise<EventItem[]>;
}

import {
  ApiClient,
  EventItem,
  FileChange,
  Project,
  Resource,
  Task,
  TaskRun,
} from "./types";
import {
  seedEvents,
  seedFileChanges,
  seedProjects,
  seedResources,
  seedTaskRuns,
  seedTasks,
} from "./demoData";

// In-memory demo client: implements the exact same contract as the real
// fetch-based client (see types.ts / client.ts) but never talks to a
// backend. State lives only for the lifetime of the page (a reload resets
// it back to the seed data). `runTask` simulates the real task lifecycle
// with timed transitions so the "New Task -> Run" flow feels alive.

let projects: Project[] = seedProjects.map((p) => ({ ...p }));
let tasks: Task[] = seedTasks.map((t) => ({ ...t }));
const taskRuns: Record<string, TaskRun> = Object.fromEntries(
  Object.entries(seedTaskRuns).map(([k, v]) => [k, { ...v }])
);
const fileChanges: Record<string, FileChange[]> = Object.fromEntries(
  Object.entries(seedFileChanges).map(([k, v]) => [k, v.map((f) => ({ ...f }))])
);
const events: Record<string, EventItem[]> = Object.fromEntries(
  Object.entries(seedEvents).map(([k, v]) => [k, v.map((e) => ({ ...e }))])
);

let counter = 1000;
const nextId = (prefix: string) => `${prefix}-demo-${counter++}`;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function pushEvent(taskId: string, event: Omit<EventItem, "id" | "created_at">) {
  const item: EventItem = { ...event, id: nextId("evt"), created_at: new Date().toISOString() };
  events[taskId] = events[taskId] ?? [];
  events[taskId].push(item);
}

function simulateTaskRun(task: Task, run: TaskRun) {
  const project = projects.find((p) => p.id === task.project_id);
  const isGodot = project?.project_type === "godot";

  const steps: Array<[number, () => void]> = [
    [
      400,
      () => {
        pushEvent(task.id, { project_id: task.project_id, task_id: task.id, task_run_id: run.id, type: "task.locked", severity: "info", payload: {} });
      },
    ],
    [
      700,
      () => {
        pushEvent(task.id, {
          project_id: task.project_id,
          task_id: task.id,
          task_run_id: run.id,
          type: "task.checkpoint_created",
          severity: "info",
          payload: { mechanism: "filesystem_snapshot" },
        });
        run.status = "RUNNING";
      },
    ],
    [
      1200,
      () => {
        pushEvent(task.id, {
          project_id: task.project_id,
          task_id: task.id,
          task_run_id: run.id,
          type: "task.execution_started",
          severity: "info",
          payload: { attempt: 0, kind: "initial" },
        });
      },
    ],
    [
      2600,
      () => {
        run.structured_result = {
          task_id: task.id,
          status: "completed",
          summary: "(Simulated demo run) Applied the requested change and reported the modified files.",
          files_claimed_modified: ["main.gd"],
          files_claimed_created: [],
          files_claimed_deleted: [],
          commands_executed: [],
          warnings: [],
          recommended_validation: isGodot ? ["Re-run headless validation"] : [],
        };
        pushEvent(task.id, {
          project_id: task.project_id,
          task_id: task.id,
          task_run_id: run.id,
          type: "task.execution_finished",
          severity: "info",
          payload: { attempt: 0, run_status: "completed" },
        });
        if (isGodot) {
          pushEvent(task.id, {
            project_id: task.project_id,
            task_id: task.id,
            task_run_id: run.id,
            type: "validator.detected",
            severity: "info",
            payload: { validator: "godot" },
          });
        }
      },
    ],
    [
      3400,
      () => {
        if (isGodot) {
          pushEvent(task.id, {
            project_id: task.project_id,
            task_id: task.id,
            task_run_id: run.id,
            type: "validation.passed",
            severity: "info",
            payload: { attempt: 0, validator: "godot", status: "pass", summary: "All GDScript file(s) parsed cleanly", duration_ms: 190, error_count: 0 },
          });
          run.validation_status = "pass";
        }
        run.status = "COMPLETED";
        run.ended_at = new Date().toISOString();
        task.status = "COMPLETED";
        task.updated_at = new Date().toISOString();
        fileChanges[run.id] = [
          {
            id: nextId("fc"),
            task_run_id: run.id,
            path: "main.gd",
            change_type: "modified",
            additions: 4,
            deletions: 1,
            claimed_by_executor: true,
            observed_by_vcs: true,
          },
        ];
        pushEvent(task.id, {
          project_id: task.project_id,
          task_id: task.id,
          task_run_id: run.id,
          type: "task.finished",
          severity: "info",
          payload: { final_status: "COMPLETED", validation_status: run.validation_status },
        });
      },
    ],
  ];

  for (const [ms, fn] of steps) {
    setTimeout(fn, ms);
  }
}

export const demoApi: ApiClient = {
  listProjects: async () => {
    await delay(150);
    return projects;
  },
  addProject: async (root_path: string, name?: string) => {
    await delay(300);
    const project: Project = {
      id: nextId("proj"),
      name: name || root_path.split("/").filter(Boolean).pop() || "new-project",
      root_path,
      project_type: "generic",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: "active",
    };
    projects = [...projects, project];
    return project;
  },
  getProject: async (id: string) => {
    await delay(100);
    const project = projects.find((p) => p.id === id);
    if (!project) throw new Error("404 Not Found: project not found (demo)");
    return project;
  },
  projectResources: async () => {
    await delay(150);
    return seedResources;
  },
  getResources: async () => {
    await delay(150);
    return seedResources;
  },

  listTasks: async (projectId: string) => {
    await delay(150);
    return tasks.filter((t) => t.project_id === projectId);
  },
  createTask: async (projectId: string, objective: string) => {
    await delay(250);
    const task: Task = {
      id: nextId("task"),
      project_id: projectId,
      objective,
      status: "CREATED",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    tasks = [...tasks, task];
    events[task.id] = [];
    return task;
  },
  getTask: async (id: string) => {
    await delay(100);
    const task = tasks.find((t) => t.id === id);
    if (!task) throw new Error("404 Not Found: task not found (demo)");
    return task;
  },
  runTask: async (id: string, timeout_seconds?: number) => {
    await delay(200);
    const task = tasks.find((t) => t.id === id);
    if (!task) throw new Error("404 Not Found: task not found (demo)");
    const run: TaskRun = {
      id: nextId("run"),
      task_id: id,
      executor_resource_id: "resource-claude-code",
      status: "LOCKING",
      started_at: new Date().toISOString(),
      ended_at: null,
      timeout_seconds: timeout_seconds ?? 600,
      structured_result: null,
      stdout_path: null,
      stderr_path: null,
      failure_reason: null,
      disposition: "pending",
      validation_status: null,
    };
    taskRuns[id] = run;
    task.status = "RUNNING";
    task.updated_at = new Date().toISOString();
    simulateTaskRun(task, run);
    return { task_id: id, accepted: true };
  },

  listTaskRuns: async (taskId: string) => {
    await delay(120);
    const run = taskRuns[taskId];
    return run ? [run] : [];
  },
  getTaskRun: async (id: string) => {
    await delay(100);
    const run = Object.values(taskRuns).find((r) => r.id === id || r.task_id === id);
    if (!run) throw new Error("404 Not Found: task run not found (demo)");
    return run;
  },
  getTaskRunChanges: async (id: string) => {
    await delay(120);
    const run = Object.values(taskRuns).find((r) => r.id === id);
    return run ? fileChanges[run.id] ?? [] : [];
  },
  keepRun: async (id: string, override?: boolean) => {
    await delay(200);
    const run = Object.values(taskRuns).find((r) => r.id === id);
    if (run) run.disposition = "kept";
    return { disposition: "kept", override: override ?? false };
  },
  rollbackRun: async (id: string) => {
    await delay(200);
    const run = Object.values(taskRuns).find((r) => r.id === id);
    if (run) run.disposition = "rolled_back";
    return { disposition: "rolled_back" };
  },
  cancelRun: async () => {
    await delay(150);
    return { signalled: true };
  },

  getEvents: async (params: { project_id?: string; task_id?: string; task_run_id?: string }) => {
    await delay(120);
    if (params.task_id) return events[params.task_id] ?? [];
    if (params.task_run_id) {
      return Object.values(events)
        .flat()
        .filter((e) => e.task_run_id === params.task_run_id);
    }
    if (params.project_id) {
      return Object.values(events)
        .flat()
        .filter((e) => e.project_id === params.project_id);
    }
    return Object.values(events).flat();
  },
};

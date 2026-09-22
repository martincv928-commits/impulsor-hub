import { DemoDisposition, DemoProject, DemoProjectType, DemoState, DemoStepEvent, DemoTask } from "./types";
import { seedProjects, seedTasks } from "./seedData";
import { runDemoRollback, runDemoTask } from "./engine";

// localStorage-backed demo state. Deliberately NOT React: this is a plain
// object + subscribe/notify store (ui/src/demo/useDemoStore.ts wires it
// into React via useSyncExternalStore), so every mutation here is testable
// with no DOM/React involved -- see ui/src/demo/__tests__/store.test.ts.
const STORAGE_KEY = "impulsor-hub-demo-v1";

function freshState(): DemoState {
  return { onboardingSeen: false, projects: seedProjects(), tasks: seedTasks() };
}

function loadState(): DemoState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw) as DemoState;
    if (!parsed || !Array.isArray(parsed.projects) || !Array.isArray(parsed.tasks)) return freshState();
    return parsed;
  } catch {
    return freshState();
  }
}

function saveState(state: DemoState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private browsing / quota exceeded: demo still works for this session,
    // it just won't survive a reload. Never let persistence failures break
    // the simulated task flow.
  }
}

let nextId = 1;
const genId = (prefix: string) => `${prefix}-${Date.now()}-${nextId++}`;

type Listener = () => void;

class DemoStore {
  private state: DemoState;
  private listeners = new Set<Listener>();

  constructor() {
    this.state = loadState();
  }

  getState(): DemoState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setState(patch: Partial<DemoState>) {
    this.state = { ...this.state, ...patch };
    saveState(this.state);
    this.listeners.forEach((fn) => fn());
  }

  markOnboardingSeen() {
    if (this.state.onboardingSeen) return;
    this.setState({ onboardingSeen: true });
  }

  addProject(name: string, type: DemoProjectType): DemoProject {
    const project: DemoProject = {
      id: genId("proj"),
      name: name.trim() || "Proyecto demo",
      type,
      createdAt: new Date().toISOString(),
      isSeed: false,
    };
    this.setState({ projects: [...this.state.projects, project] });
    return project;
  }

  getProject(id: string): DemoProject | undefined {
    return this.state.projects.find((p) => p.id === id);
  }

  tasksForProject(projectId: string): DemoTask[] {
    return this.state.tasks.filter((t) => t.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getTask(id: string): DemoTask | undefined {
    return this.state.tasks.find((t) => t.id === id);
  }

  private updateTask(id: string, patch: Partial<DemoTask>) {
    this.setState({
      tasks: this.state.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    });
  }

  private pushStep(id: string, step: DemoStepEvent) {
    const task = this.getTask(id);
    if (!task) return;
    this.updateTask(id, { steps: [...task.steps, step] });
  }

  /** Creates a running task and starts the simulated engine. Returns the task id immediately; the engine updates it asynchronously via the store. */
  startTask(projectId: string, objective: string): DemoTask {
    const project = this.getProject(projectId);
    const task: DemoTask = {
      id: genId("task"),
      projectId,
      objective: objective.trim(),
      scenario: "pass",
      running: true,
      createdAt: new Date().toISOString(),
      filesModified: [],
      summary: "",
      steps: [],
      attempts: 0,
      validated: null,
      disposition: "pending",
      rollbackSteps: [],
    };
    this.setState({ tasks: [...this.state.tasks, task] });

    const { promise } = runDemoTask(objective, project?.type ?? "other", (step) => this.pushStep(task.id, step));
    promise.then((result) => {
      this.updateTask(task.id, {
        running: false,
        scenario: result.scenario,
        filesModified: result.filesModified,
        summary: result.summary,
        attempts: result.attempts,
        validated: result.validated,
      });
    });

    return task;
  }

  keep(taskId: string) {
    this.setDisposition(taskId, "kept");
  }

  rollback(taskId: string) {
    const task = this.getTask(taskId);
    if (!task) return;
    runDemoRollback((step) => {
      const current = this.getTask(taskId);
      if (!current) return;
      this.updateTask(taskId, { rollbackSteps: [...current.rollbackSteps, step] });
    }).then(() => this.setDisposition(taskId, "rolled_back"));
  }

  private setDisposition(taskId: string, disposition: DemoDisposition) {
    this.updateTask(taskId, { disposition });
  }

  reset() {
    nextId = 1;
    this.state = freshState();
    saveState(this.state);
    this.listeners.forEach((fn) => fn());
  }
}

export const demoStore = new DemoStore();
export { DemoStore, STORAGE_KEY };

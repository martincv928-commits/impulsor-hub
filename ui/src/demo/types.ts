// Demo Mode's own data model. Deliberately separate from ui/src/api/types.ts
// (the real backend's contract) -- the demo never talks to a backend, so it
// has no reason to share shapes with one. See ui/src/demo/README.md for the
// mode-separation rationale.

export type DemoProjectType = "godot" | "web" | "other";

export interface DemoProject {
  id: string;
  name: string;
  type: DemoProjectType;
  createdAt: string;
  isSeed: boolean;
}

export type DemoStepStatus = "running" | "success" | "error";

export interface DemoStepEvent {
  id: string;
  ts: string;
  label: string;
  status: DemoStepStatus;
  technicalId: string;
  detail?: string;
}

export type DemoScenarioId = "pass" | "fail_repair_pass" | "simple";
export type DemoDisposition = "pending" | "kept" | "rolled_back";

export interface DemoTask {
  id: string;
  projectId: string;
  objective: string;
  scenario: DemoScenarioId;
  running: boolean;
  createdAt: string;
  filesModified: string[];
  summary: string;
  steps: DemoStepEvent[];
  attempts: number;
  validated: boolean | null; // null when the project type has no validator (non-Godot)
  disposition: DemoDisposition;
  rollbackSteps: DemoStepEvent[];
}

export interface DemoState {
  onboardingSeen: boolean;
  projects: DemoProject[];
  tasks: DemoTask[];
}

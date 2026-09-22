import { EventItem, ExecutorResult, FileChange, Project, Resource, Task, TaskRun } from "./types";

// Static seed data for demo mode. Modeled closely on real runs captured
// during M1/M2 development (see docs/e2e/ in the source repo) -- the
// objectives, errors, and repair narrative are the same shape as what the
// real pipeline actually produced against the real `claude` CLI and real
// Godot engines, just replayed here without a live backend.

export const DEMO_NOTICE =
  "DEMO — read-only sample data, no live backend. No real AI tasks or file changes happen here.";

const iso = (offsetSeconds: number) => new Date(Date.now() - offsetSeconds * 1000).toISOString();

export const seedResources: Resource[] = [
  {
    id: "resource-git",
    adapter_key: "git",
    type: "vcs",
    display_name: "Git",
    version: "2.43.0",
    availability: "available",
    auth_state: null,
    cost_type: "free",
    capabilities: [],
    health: { status: "healthy", available: true, version: "2.43.0" },
    checked_at: iso(30),
  },
  {
    id: "resource-claude-code",
    adapter_key: "claude_code",
    type: "ai_executor",
    display_name: "Claude Code CLI",
    version: "2.1.278",
    availability: "available",
    auth_state: "authenticated",
    cost_type: "subscription",
    capabilities: ["code_edit", "shell_exec", "structured_result"],
    health: { status: "healthy", available: true, version: "2.1.278", authenticated: "authenticated" },
    checked_at: iso(30),
  },
  {
    id: "resource-godot",
    adapter_key: "godot",
    type: "tool",
    display_name: "Godot",
    version: "4.2.2.stable.official.15073afe3",
    availability: "available",
    auth_state: null,
    cost_type: "free",
    capabilities: ["gdscript_validation"],
    health: {
      status: "healthy",
      available: true,
      version: "4.2.2.stable.official.15073afe3",
      executable_path: "/usr/local/bin/godot4",
    },
    checked_at: iso(30),
  },
];

export const seedProjects: Project[] = [
  {
    id: "proj-godot-demo",
    name: "impulsor-demo-game",
    root_path: "/home/demo/impulsor-demo-game",
    project_type: "godot",
    created_at: iso(3600),
    updated_at: iso(120),
    status: "active",
  },
  {
    id: "proj-landing",
    name: "landing-page",
    root_path: "/home/demo/landing-page",
    project_type: "generic",
    created_at: iso(7200),
    updated_at: iso(1800),
    status: "active",
  },
];

const godotExecutorResult: ExecutorResult = {
  task_id: "task-godot-repair",
  status: "completed",
  summary:
    "Fixed the parse error by changing 'onready var self_ref = self' to '@onready var self_ref = self'. The bare 'onready' keyword was removed in Godot 4's GDScript (replaced entirely by the @onready annotation), so it is not valid syntax and always fails to parse under this validator; the annotation form is the only syntax that compiles while preserving the requested behavior.",
  files_claimed_modified: ["main.gd"],
  files_claimed_created: [],
  files_claimed_deleted: [],
  commands_executed: [],
  warnings: [
    "The objective explicitly requested the classic bare 'onready' keyword (not '@onready'), but Godot 4 GDScript removed that keyword entirely -- 'onready var ...' is a hard parse error in Godot 4, which the validator confirmed. Used '@onready' instead since it is the only Godot-4-valid way to achieve the requested caching behavior.",
  ],
  recommended_validation: ["Run the project's test scene to confirm self_ref resolves at runtime"],
};

export const seedTasks: Task[] = [
  {
    id: "task-godot-repair",
    project_id: "proj-godot-demo",
    objective:
      "Add a variable named self_ref to main.gd that caches a reference to this node, declared using the classic Godot GDScript 'onready var' keyword syntax (bare 'onready', not the '@onready' annotation), plus a function get_self() that returns self_ref.",
    status: "COMPLETED",
    created_at: iso(600),
    updated_at: iso(560),
  },
  {
    id: "task-godot-pass",
    project_id: "proj-godot-demo",
    objective: "Add a new function named multiply(a, b) to main.gd that returns a * b. Use modern Godot 4 GDScript syntax.",
    status: "COMPLETED",
    created_at: iso(1500),
    updated_at: iso(1470),
  },
  {
    id: "task-landing-hero",
    project_id: "proj-landing",
    objective: "Update the hero heading in index.html to say 'Ship faster with Impulsor Hub' and update the CTA button text to 'Get started'.",
    status: "COMPLETED",
    created_at: iso(2400),
    updated_at: iso(2370),
  },
];

export const seedTaskRuns: Record<string, TaskRun> = {
  "task-godot-repair": {
    id: "run-godot-repair",
    task_id: "task-godot-repair",
    executor_resource_id: "resource-claude-code",
    status: "COMPLETED",
    started_at: iso(600),
    ended_at: iso(560),
    timeout_seconds: 600,
    structured_result: godotExecutorResult,
    stdout_path: ".impulsor/logs/run-godot-repair/attempt_1_stdout.log",
    stderr_path: ".impulsor/logs/run-godot-repair/attempt_1_stderr.log",
    failure_reason: null,
    disposition: "pending",
    validation_status: "pass",
  },
  "task-godot-pass": {
    id: "run-godot-pass",
    task_id: "task-godot-pass",
    executor_resource_id: "resource-claude-code",
    status: "COMPLETED",
    started_at: iso(1500),
    ended_at: iso(1480),
    timeout_seconds: 600,
    structured_result: {
      task_id: "task-godot-pass",
      status: "completed",
      summary: "Added a multiply(a, b) function to main.gd that returns a * b, using Godot 4 GDScript syntax consistent with the existing file.",
      files_claimed_modified: ["main.gd"],
      files_claimed_created: [],
      files_claimed_deleted: [],
      commands_executed: [],
      warnings: [],
      recommended_validation: [],
    },
    stdout_path: ".impulsor/logs/run-godot-pass/attempt_0_stdout.log",
    stderr_path: ".impulsor/logs/run-godot-pass/attempt_0_stderr.log",
    failure_reason: null,
    disposition: "kept",
    validation_status: "pass",
  },
  "task-landing-hero": {
    id: "run-landing-hero",
    task_id: "task-landing-hero",
    executor_resource_id: "resource-claude-code",
    status: "COMPLETED",
    started_at: iso(2400),
    ended_at: iso(2380),
    timeout_seconds: 600,
    structured_result: {
      task_id: "task-landing-hero",
      status: "completed",
      summary: "Updated the hero heading and CTA button text in index.html as requested.",
      files_claimed_modified: ["index.html"],
      files_claimed_created: [],
      files_claimed_deleted: [],
      commands_executed: [],
      warnings: [],
      recommended_validation: [],
    },
    stdout_path: ".impulsor/logs/run-landing-hero/attempt_0_stdout.log",
    stderr_path: ".impulsor/logs/run-landing-hero/attempt_0_stderr.log",
    failure_reason: null,
    disposition: "kept",
    validation_status: null,
  },
};

export const seedFileChanges: Record<string, FileChange[]> = {
  "run-godot-repair": [
    {
      id: "fc-1",
      task_run_id: "run-godot-repair",
      path: "main.gd",
      change_type: "modified",
      additions: 5,
      deletions: 0,
      claimed_by_executor: true,
      observed_by_vcs: true,
    },
  ],
  "run-godot-pass": [
    {
      id: "fc-2",
      task_run_id: "run-godot-pass",
      path: "main.gd",
      change_type: "modified",
      additions: 3,
      deletions: 0,
      claimed_by_executor: true,
      observed_by_vcs: true,
    },
  ],
  "run-landing-hero": [
    {
      id: "fc-3",
      task_run_id: "run-landing-hero",
      path: "index.html",
      change_type: "modified",
      additions: 2,
      deletions: 2,
      claimed_by_executor: true,
      observed_by_vcs: true,
    },
  ],
};

export const seedEvents: Record<string, EventItem[]> = {
  "task-godot-repair": [
    { id: "e10", project_id: "proj-godot-demo", task_id: "task-godot-repair", task_run_id: "run-godot-repair", type: "task.locked", severity: "info", payload: {}, created_at: iso(600) },
    { id: "e11", project_id: "proj-godot-demo", task_id: "task-godot-repair", task_run_id: "run-godot-repair", type: "task.checkpoint_created", severity: "info", payload: { mechanism: "filesystem_snapshot" }, created_at: iso(599) },
    { id: "e12", project_id: "proj-godot-demo", task_id: "task-godot-repair", task_run_id: "run-godot-repair", type: "task.execution_started", severity: "info", payload: { attempt: 0, kind: "initial" }, created_at: iso(598) },
    { id: "e13", project_id: "proj-godot-demo", task_id: "task-godot-repair", task_run_id: "run-godot-repair", type: "task.execution_finished", severity: "info", payload: { attempt: 0, run_status: "completed" }, created_at: iso(587) },
    { id: "e14", project_id: "proj-godot-demo", task_id: "task-godot-repair", task_run_id: "run-godot-repair", type: "validator.detected", severity: "info", payload: { validator: "godot" }, created_at: iso(587) },
    {
      id: "e15",
      project_id: "proj-godot-demo",
      task_id: "task-godot-repair",
      task_run_id: "run-godot-repair",
      type: "validation.failed",
      severity: "warning",
      payload: {
        attempt: 0,
        validator: "godot",
        status: "fail",
        summary: "1 script error(s) across 1 checked file(s)",
        duration_ms: 177,
        error_count: 1,
        errors: [{ file: "main.gd", line: 3, message: "SCRIPT ERROR: Parse Error: Unexpected 'Identifier' in class body." }],
      },
      created_at: iso(586),
    },
    { id: "e16", project_id: "proj-godot-demo", task_id: "task-godot-repair", task_run_id: "run-godot-repair", type: "repair.started", severity: "info", payload: { attempt: 1, error_count: 1 }, created_at: iso(585) },
    { id: "e17", project_id: "proj-godot-demo", task_id: "task-godot-repair", task_run_id: "run-godot-repair", type: "task.execution_started", severity: "info", payload: { attempt: 1, kind: "repair" }, created_at: iso(584) },
    { id: "e18", project_id: "proj-godot-demo", task_id: "task-godot-repair", task_run_id: "run-godot-repair", type: "task.execution_finished", severity: "info", payload: { attempt: 1, run_status: "completed" }, created_at: iso(562) },
    { id: "e19", project_id: "proj-godot-demo", task_id: "task-godot-repair", task_run_id: "run-godot-repair", type: "repair.finished", severity: "info", payload: { attempt: 1, run_status: "completed" }, created_at: iso(561) },
    {
      id: "e20",
      project_id: "proj-godot-demo",
      task_id: "task-godot-repair",
      task_run_id: "run-godot-repair",
      type: "validation.passed",
      severity: "info",
      payload: { attempt: 1, validator: "godot", status: "pass", summary: "All 1 GDScript file(s) parsed cleanly", duration_ms: 182, error_count: 0 },
      created_at: iso(560),
    },
    { id: "e21", project_id: "proj-godot-demo", task_id: "task-godot-repair", task_run_id: "run-godot-repair", type: "task.finished", severity: "info", payload: { final_status: "COMPLETED", validation_status: "pass", repair_attempts_used: 1 }, created_at: iso(560) },
  ],
  "task-godot-pass": [
    { id: "e1", project_id: "proj-godot-demo", task_id: "task-godot-pass", task_run_id: "run-godot-pass", type: "task.locked", severity: "info", payload: {}, created_at: iso(1500) },
    { id: "e2", project_id: "proj-godot-demo", task_id: "task-godot-pass", task_run_id: "run-godot-pass", type: "task.checkpoint_created", severity: "info", payload: { mechanism: "filesystem_snapshot" }, created_at: iso(1499) },
    { id: "e3", project_id: "proj-godot-demo", task_id: "task-godot-pass", task_run_id: "run-godot-pass", type: "task.execution_started", severity: "info", payload: { attempt: 0, kind: "initial" }, created_at: iso(1498) },
    { id: "e4", project_id: "proj-godot-demo", task_id: "task-godot-pass", task_run_id: "run-godot-pass", type: "task.execution_finished", severity: "info", payload: { attempt: 0, run_status: "completed" }, created_at: iso(1481) },
    { id: "e5", project_id: "proj-godot-demo", task_id: "task-godot-pass", task_run_id: "run-godot-pass", type: "validator.detected", severity: "info", payload: { validator: "godot" }, created_at: iso(1481) },
    { id: "e6", project_id: "proj-godot-demo", task_id: "task-godot-pass", task_run_id: "run-godot-pass", type: "validation.passed", severity: "info", payload: { attempt: 0, validator: "godot", status: "pass", summary: "All 1 GDScript file(s) parsed cleanly", duration_ms: 184, error_count: 0 }, created_at: iso(1480) },
    { id: "e7", project_id: "proj-godot-demo", task_id: "task-godot-pass", task_run_id: "run-godot-pass", type: "task.finished", severity: "info", payload: { final_status: "COMPLETED", validation_status: "pass" }, created_at: iso(1480) },
  ],
  "task-landing-hero": [
    { id: "e30", project_id: "proj-landing", task_id: "task-landing-hero", task_run_id: "run-landing-hero", type: "task.locked", severity: "info", payload: {}, created_at: iso(2400) },
    { id: "e31", project_id: "proj-landing", task_id: "task-landing-hero", task_run_id: "run-landing-hero", type: "task.checkpoint_created", severity: "info", payload: { mechanism: "filesystem_snapshot" }, created_at: iso(2399) },
    { id: "e32", project_id: "proj-landing", task_id: "task-landing-hero", task_run_id: "run-landing-hero", type: "task.execution_started", severity: "info", payload: { attempt: 0, kind: "initial" }, created_at: iso(2398) },
    { id: "e33", project_id: "proj-landing", task_id: "task-landing-hero", task_run_id: "run-landing-hero", type: "task.execution_finished", severity: "info", payload: { attempt: 0, run_status: "completed" }, created_at: iso(2382) },
    { id: "e34", project_id: "proj-landing", task_id: "task-landing-hero", task_run_id: "run-landing-hero", type: "task.finished", severity: "info", payload: { final_status: "COMPLETED" }, created_at: iso(2380) },
  ],
};

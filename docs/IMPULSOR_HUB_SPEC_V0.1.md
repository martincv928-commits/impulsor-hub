# IMPULSOR HUB — SPEC v0.1

Status: Implementation contract for Milestone 1
Codename: Impulsor Hub (not final commercial brand)
Primary validation project: MONTARO

## 1. Product goal
Impulsor Hub is a local-first orchestration layer that coordinates AI executors and local tools over real projects. The long-term product must route work by capability, availability, included/free usage, cost, permissions and observed reliability, while preserving a provider-neutral project state and memory.

The first product proof is simple: a user can add an existing local repository, create a task, let an AI executor modify it, independently inspect the real changes with Git, and safely keep or roll back the result without manually transferring ZIPs or context between agents.

## 2. Non-negotiable architecture principles
1. Local-first. Project source files remain in the user's selected workspace unless a future adapter explicitly requires otherwise.
2. Provider-neutral core. The orchestrator must depend on abstract resource contracts, never on Claude-specific logic.
3. Tools verify AI claims. An AI result is a proposal; Git and later validators establish actual state.
4. Hub owns version-control checkpoints. AI executors must not commit, reset, rebase, stash, checkout branches, or otherwise manage repository history.
5. Existing user work is sacred. Pre-existing uncommitted/untracked work must never be silently destroyed.
6. Workspace boundary. AI writes are restricted to the selected project root and may not modify `.impulsor/`.
7. Structured events. Important lifecycle transitions and resource activity are persisted.
8. Minimal scope. Do not implement future milestones early.

## 3. M1 user journey
1. Launch desktop app.
2. Add an existing local project by selecting its root directory.
3. Persist project metadata and show resource status.
4. Detect Git and Claude Code CLI and run health checks.
5. User enters a direct task objective and presses Run.
6. Hub validates repository/workspace state.
7. If pre-existing changes exist, Hub warns the user and requires creation of a safe recoverable baseline before AI execution; cancel must remain possible.
8. Hub creates TASK and TASK_RUN records, locks execution for that project, records a recoverable checkpoint/baseline, and invokes Claude Code through the adapter.
9. Claude Code works only inside the workspace and returns structured task output.
10. Hub independently captures Git status/diff and calculates actual created/modified/deleted files.
11. Hub compares Claude's claimed file changes with Git-observed changes and records discrepancies.
12. UI displays summary, actual diff and execution activity.
13. User chooses KEEP CHANGES or ROLLBACK.
14. KEEP marks the run accepted and preserves the working changes. ROLLBACK restores exactly the pre-task state, including preservation of any work that existed before the task.

## 4. M1 scope
### Must implement
- Local desktop UI.
- Add/list/open local projects.
- SQLite persistence.
- Git resource adapter.
- Claude Code AI executor adapter.
- Resource discovery + health checks.
- Direct task creation (no intelligent planner yet).
- Project-level execution lock.
- Safe pre-task baseline/checkpoint.
- Claude Code invocation and cancellation/timeout handling.
- Capture stdout/stderr and structured result.
- Independent Git status/diff/change manifest.
- Claim-vs-reality discrepancy detection.
- Task result view.
- Manual KEEP and ROLLBACK.
- Event/activity log.
- Tests for critical safety behavior.
- M1_REPORT.md at completion.

### Explicitly out of scope
Do NOT implement: Codex adapter; Gemini; Ollama/local LLMs; automatic Godot validation; image generation; intelligent planner; multi-agent handoffs; MCP marketplace; cloud sync; accounts/login; teams; billing; SaaS backend; analytics dashboards; learned reliability routing; automatic commits; mobile app; Odoo integration; Blender/FFmpeg adapters.

Godot may be detected/displayed if convenient during generic resource discovery, but M1 must not execute or validate with Godot.

## 5. Proposed technology stack
- Desktop shell: Tauri
- UI: React + TypeScript
- Core/local service: Python
- Local API: FastAPI
- Data validation/contracts: Pydantic
- Database: SQLite
- VCS integration: Git CLI through a constrained adapter
- AI executor M1: Claude Code CLI

If a concrete incompatibility makes one stack choice materially harmful, STOP and document the issue before replacing it. Do not silently redesign the stack.

## 6. Repository structure target
```text
impulsor-hub/
  app/
    core/
      orchestrator/
      router/
      permissions/
      events/
    adapters/
      ai/
        base.py
        claude_code/
      vcs/
        base.py
        git/
      tools/
    projects/
    tasks/
    memory/
    database/
    api/
  ui/
  tests/
  docs/
  README.md
```
Exact filenames may evolve, but boundaries must remain clear.

## 7. Resource model
Resources are generic. Minimum conceptual fields:
- id
- display_name
- resource_type (`ai_executor`, `vcs`, `tool`, `service`)
- availability
- version
- auth_state when applicable
- cost_type (`free`, `subscription`, `api`, `unknown`)
- capabilities
- health status + last health check

Do not fabricate quota percentages. If a provider does not expose remaining usage, persist/display `unknown`.

### AIExecutor contract
At minimum:
- `detect()`
- `health_check()`
- `capabilities()`
- `execute(task, workspace, policy)`
- `cancel(run_id)`

The orchestrator must call this abstraction, not Claude-specific code.

### VCS contract
At minimum:
- detect/health
- repository validation
- status
- diff
- safe baseline/checkpoint creation
- restore to pre-task state without destroying pre-existing work
- change manifest generation

## 8. Core entities
SQLite must support at least:

### PROJECT
id, name, root_path, project_type, created_at, updated_at, status.

### RESOURCE
id, adapter_key, type, display_name, version, availability, auth_state, cost_type, capabilities_json, health_json, checked_at.

### TASK
id, project_id, objective, status, created_at, updated_at.

### TASK_RUN
id, task_id, executor_resource_id, status, started_at, ended_at, timeout, structured_result_json, stdout_path/reference, stderr_path/reference, failure_reason.

### FILE_CHANGE
id, task_run_id, path, change_type, additions/deletions where available, claimed_by_executor boolean/nullable, observed_by_vcs boolean.

### CHECKPOINT
id, project_id, task_run_id, mechanism, reference, created_at, restore_status.

### EVENT
id, project_id, task_id nullable, task_run_id nullable, type, severity, payload_json, created_at.

### APPROVAL
Schema may exist minimally if needed for future permission flows, but M1 does not need a generalized approval engine.

### MEMORY_ITEM
Schema may exist minimally for forward compatibility, but M1 does not implement semantic memory/retrieval.

## 9. Task states
Support a coherent subset of:
`CREATED -> VALIDATING -> READY -> LOCKING -> CHECKPOINTING -> RUNNING -> VERIFYING -> COMPLETED/FAILED`

Also allow `WAITING_APPROVAL`, `BLOCKED`, `CANCELLED` where relevant.

KEEP/ROLLBACK is a result disposition separate from whether executor execution itself completed.

## 10. Workspace and permissions policy
Generated executor instruction must enforce:
- Work only inside project root.
- Never modify `.impulsor/`.
- No `git commit`, `git reset`, `git rebase`, `git stash`, branch switching or history rewriting.
- No dependency installation without explicit user approval (M1 may simply block and surface request rather than implement a full approval workflow).
- No destructive deletion unless explicitly required by objective; risky deletion must be surfaced.
- Minimum necessary change.
- Preserve behavior outside task objective.

The Hub itself must also enforce boundaries where technically possible. Prompt instructions alone are not a security boundary.

Never interpolate untrusted paths/objectives into shell strings. Use argument arrays/subprocess APIs safely and normalize/validate filesystem paths.

## 11. `.impulsor` project metadata
Hub may create `.impulsor/` inside a project for project-local metadata/log references if needed. It is owned by Hub and forbidden to AI executors.

Suggested conceptual layout:
```text
.impulsor/
  project.json
  logs/
  manifests/
  checkpoints/
```
Do not store secrets in this directory.

## 12. Claude Code task envelope
Hub generates a task instruction equivalent to:

```text
IMPULSOR HUB TASK
TASK_ID: <id>
WORKSPACE: <normalized root>
OBJECTIVE: <user objective>

RULES:
- Work only inside WORKSPACE.
- Do not run git commit/reset/rebase/stash/checkout or rewrite history.
- Do not modify .impulsor.
- Do not access files outside WORKSPACE.
- Do not install dependencies without approval.
- Do not delete files unless explicitly required.
- Make the minimum changes necessary.
- Preserve existing behavior outside the objective.
- Return the required structured result.
```

Prefer Claude Code non-interactive execution with structured output. Do not rely on parsing free-form prose if structured output is available.

## 13. Executor result schema
Minimum logical schema:
```json
{
  "task_id": "TASK-000001",
  "status": "completed",
  "summary": "...",
  "files_claimed_modified": [],
  "files_claimed_created": [],
  "files_claimed_deleted": [],
  "commands_executed": [],
  "warnings": [],
  "recommended_validation": []
}
```
Validate it. Malformed structured output must not be treated as verified success.

## 14. Independent change manifest
After executor exits, Git adapter determines actual state. Manifest must distinguish:
- files claimed by executor
- files observed by Git
- modified/created/deleted/renamed when detectable
- additions/deletions when practical
- discrepancies

Example result:
```text
Claude claimed: 3 files
Git observed:   5 files
Discrepancy:    2 unreported files
```
This does not automatically imply malicious behavior; it is evidence for user review and future reliability metrics.

## 15. Safe checkpoint/rollback requirement
This is a release blocker.

The implementation must handle both clean and dirty repositories. A dirty repo can contain tracked modifications and untracked files created by the user before Hub starts.

Required invariant:
> Rolling back an AI task restores the exact pre-task filesystem/repository state without deleting or overwriting work that existed before the task.

Do not use a naive `git reset --hard` / `git clean` implementation. Tests must prove preservation of pre-existing tracked and untracked work.

If a safe approach cannot be implemented confidently in M1, block execution on dirty repositories rather than risk data loss, and document this deviation in M1_REPORT. Data safety wins over convenience.

## 16. UI views
M1 only needs:
1. Projects — list and Add Project.
2. Project — overview/resources/current/recent tasks.
3. New Task — objective + Run.
4. Task Result — summary, executor result, actual Git changes/diff, discrepancies, KEEP, ROLLBACK.
5. Resources — Git/Claude Code detection and health.

Activity can be embedded in Project/Task Result.

UI should be clean and modern, but functionality and safety take precedence. No marketing site or elaborate dashboard.

## 17. Error behavior
Explicitly handle:
- selected path does not exist
- not a Git repository
- Git missing
- Claude Code missing
- Claude Code not authenticated/unresponsive
- task already running for project
- subprocess timeout
- user cancellation
- malformed executor JSON
- executor non-zero exit
- filesystem permission error
- workspace boundary violation
- checkpoint failure
- rollback failure

Errors must be persisted as events and surfaced in understandable UI text. Never report a task as complete solely because the executor process exited successfully.

## 18. Testing requirements
Automated tests must cover at least:
- resource detection contract
- project path normalization/boundary checks
- task state transitions
- single-project execution lock
- Git actual-change detection
- executor claimed-vs-observed discrepancy
- clean-repo rollback
- dirty-repo safety: pre-existing tracked modifications survive rollback
- dirty-repo safety: pre-existing untracked files survive rollback
- AI-created files are removed/restored appropriately on rollback
- `.impulsor` is excluded from executor writes and task diff accounting as appropriate
- malformed executor result
- timeout/cancel path

Use temporary test repositories; never run destructive tests against a real project.

## 19. Definition of Done — M1
M1 is not complete until all applicable boxes are demonstrated:
- [ ] App starts with documented commands.
- [ ] Existing project can be added and persisted.
- [ ] Git detected and health checked.
- [ ] Claude Code detected, authentication/readiness checked.
- [ ] Direct task can be created.
- [ ] Project execution lock works.
- [ ] Safe pre-task baseline/checkpoint works.
- [ ] Pre-existing dirty work is never silently destroyed.
- [ ] Claude Code can execute task in workspace.
- [ ] stdout/stderr/result captured.
- [ ] Timeout and cancel paths handled.
- [ ] Git diff/status independently captured.
- [ ] Manifest generated and persisted.
- [ ] Claim-vs-observed discrepancy recorded.
- [ ] Task result UI shows real changes.
- [ ] KEEP works.
- [ ] ROLLBACK restores exact pre-task state.
- [ ] `.impulsor` cannot be modified by executor under normal policy.
- [ ] Critical automated tests pass.
- [ ] README contains install/run/test instructions.
- [ ] `M1_REPORT.md` delivered.

## 20. Required M1 report
`M1_REPORT.md` must include:
- implementation summary
- final architecture/tree
- exact setup/run commands
- prerequisites and tested OS/environment
- tests run and results
- manual end-to-end test performed
- known limitations
- deviations from SPEC and reasons
- safety/rollback design explanation
- files/modules that should be reviewed next
- recommended M2 starting point

## 21. Future milestones — context only, DO NOT IMPLEMENT
M2: Godot adapter + headless validation + repair loop.
M3: Codex adapter + capability/resource router.
M4: structured handoffs and project memory retrieval.
M5: image/vision resources and asset registry; prove code + asset + integration + validation workflow on MONTARO.
Later: local models, additional tools, budgets, learned reliability, cloud/team features.

## 22. Product acceptance principle
M1 is successful only if it reduces the user's role as an AI intermediary. It must establish a trustworthy execution substrate before multi-agent automation is added.

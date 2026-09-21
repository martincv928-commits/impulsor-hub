# CLAUDE CODE — MILESTONE 1 IMPLEMENTATION BRIEF

You are the implementation executor for Impulsor Hub Milestone 1.

## Authority
`IMPULSOR_HUB_SPEC_V0.1.md` is the implementation contract. Read it completely before changing code.

Do not redesign the product, broaden scope, or implement future milestones. If a specification point is ambiguous, choose the smallest safe implementation consistent with the product principles and record the decision. If a requested stack choice is genuinely incompatible, stop and explain before replacing it.

## Mission
Build a working local-first M1 that proves this pipeline:

`local project -> task -> safe baseline -> Claude Code executor -> actual Git inspection -> manifest -> user KEEP or ROLLBACK`

The primary future validation project is MONTARO, but do NOT hard-code MONTARO or Godot assumptions into M1.

## Priority order
1. Data safety / rollback correctness.
2. Workspace boundary and subprocess safety.
3. End-to-end functionality.
4. Adapter separation/provider neutrality.
5. Automated tests.
6. Usable UI.
7. Visual polish.

## Mandatory constraints
- Hub controls Git. The AI executor must not commit/reset/rebase/stash/switch branches/rewrite history.
- Do not implement Codex, Godot validation, Gemini, Ollama, image generation, planner, MCP marketplace, cloud, billing or teams.
- Do not fake resource quotas or health.
- Do not claim success based on Claude's prose; independently inspect Git.
- Never risk destroying pre-existing dirty work. If exact safe rollback for dirty repositories cannot be guaranteed, block AI execution on dirty repos and document the limitation rather than using destructive Git commands.
- Never run destructive tests against a real user repository.
- Keep secrets out of repository and `.impulsor` metadata.

## Execution plan
Work in checkpoints. After each checkpoint, run relevant tests before continuing.

### Checkpoint A — Foundation
- Create repository/project structure.
- Establish Python core/FastAPI, SQLite/Pydantic and React/TypeScript/Tauri skeleton.
- Add migrations/schema initialization.
- Add event logging primitives.
- Provide documented development startup commands.

### Checkpoint B — Projects and resources
- Add/select/persist existing project.
- Validate normalized workspace path.
- Implement generic Resource/AIExecutor/VCS contracts.
- Implement Git detection/health.
- Implement Claude Code detection/readiness/auth health check without consuming unnecessary work.
- Resources UI.

### Checkpoint C — Task lifecycle and safety
- Task/TASK_RUN persistence and states.
- One active mutating task per project.
- Safe baseline/checkpoint design.
- Dirty-repository detection and user-safe behavior.
- Workspace/policy enforcement utilities.
- Unit/integration tests for rollback safety BEFORE wiring a real executor to a real project.

### Checkpoint D — Claude Code adapter
- Non-interactive execution.
- Structured result validation.
- stdout/stderr capture.
- timeout and cancellation.
- task envelope/policy injection.
- no Git-history management by executor.

### Checkpoint E — Verification and result
- Independent Git status/diff after execution.
- Actual file-change manifest.
- Compare executor claims vs observed state.
- Persist FILE_CHANGE/EVENT records.
- Task Result UI with diff/summary/discrepancy.
- KEEP and ROLLBACK.

### Checkpoint F — End-to-end hardening
- Run automated test suite.
- Run an end-to-end test on a disposable fixture repository.
- Test clean repo and dirty repo safety.
- Test executor failure/malformed result/timeout where feasible.
- Finish README.
- Produce `M1_REPORT.md`.

## Do not silently skip requirements
If something cannot be completed, leave the application in a safe state and list the exact blocker in `M1_REPORT.md`. A partial but truthful M1 is preferable to simulated functionality.

## Completion response
When finished, do not just say "done". Return a concise summary containing:
1. M1 status: PASS / PARTIAL / BLOCKED.
2. Test command(s) and pass/fail counts.
3. End-to-end scenario tested.
4. Any SPEC deviations.
5. Path to `M1_REPORT.md`.
6. The exact command(s) Martín should run to launch the app.

Do not begin M2.

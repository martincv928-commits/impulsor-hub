# Impulsor Hub — Milestone 1 Report

Status: **PASS** (all M1 must-implement items delivered; one honestly-documented
manifest-detection gap under a specific dirty-repo edge case — see
"Known limitations").

## 1. Implementation summary

M1 delivers the full pipeline required by the SPEC:

`local project -> task -> safe baseline -> Claude Code executor -> actual Git inspection -> manifest -> user KEEP or ROLLBACK`

- **Backend**: Python, FastAPI, SQLite (stdlib `sqlite3`, no ORM), Pydantic
  v2 contracts for every entity and for the executor result schema.
- **Adapters**: a `GitAdapter` (detection, status, checkpoint/restore,
  change-manifest computation) and a `ClaudeCodeAdapter` that drives the
  real `claude` CLI non-interactively (`-p --output-format json`).
- **Orchestrator**: a single pipeline function
  (`app/core/orchestrator/orchestrator.py`) that owns every state
  transition, the project-level execution lock, checkpoint creation,
  executor invocation, verification, and KEEP/ROLLBACK.
- **API**: FastAPI routers for projects, resources, tasks, task runs,
  file changes and events.
- **UI**: React + TypeScript, five views (Projects, Project, New Task, Task
  Result, Resources), talking to the API over `fetch`. A Tauri v2 skeleton
  wraps it for desktop packaging (see limitation below on why the desktop
  build itself wasn't verified here).
- **Tests**: 56 automated tests (pytest), see §5.
- **Real end-to-end verification**: two full runs against the *actual*
  `claude` CLI (not a mock) driving the real UI in a headless browser —
  one KEEP scenario, one dirty-repo ROLLBACK scenario. See §6.

## 2. Final architecture / tree

```text
impulsor-hub/
  app/
    core/
      orchestrator/orchestrator.py   # the pipeline: validate -> lock -> checkpoint
                                      # -> run -> verify -> record -> keep/rollback
      router/router.py               # picks git + claude_code adapters (M1: fixed, not intelligent)
      permissions/policy.py          # workspace boundary, forbidden git subcommands, task envelope
      events/events.py               # structured event log (persisted to `event` table)
      resources.py                   # resource detect/health refresh + persistence
    adapters/
      ai/base.py, ai/claude_code/adapter.py     # AIExecutor contract + real Claude Code CLI adapter
      vcs/base.py, vcs/git/adapter.py           # VCS contract + Git adapter (status/checkpoint/restore/manifest)
      tools/                                     # placeholder package for future tool adapters (unused in M1)
    projects/service.py              # add/list/get project, path validation
    tasks/service.py                 # Task/TaskRun/FileChange/Checkpoint CRUD + state-transition guard
    memory/                          # placeholder package (MEMORY_ITEM table exists in schema only)
    database/{schema.sql,db.py,models.py}       # SQLite schema + connection mgmt + Pydantic models
    api/main.py, api/routers/{projects,resources,tasks}.py
  ui/
    src/{App.tsx,main.tsx,styles.css}
    src/api/client.ts                # typed fetch client mirroring the Pydantic models
    src/pages/{Projects,Project,NewTask,TaskResult,Resources}.tsx
    src-tauri/{tauri.conf.json,Cargo.toml,src/main.rs,build.rs}   # desktop shell skeleton
  tests/                             # 56 tests: policy, git adapter, claude_code adapter,
                                      # task lifecycle, orchestrator pipeline, API integration
  docs/
    IMPULSOR_HUB_SPEC_V0.1.md, CLAUDE_M1.md     # copies of the source spec/brief
    e2e/                             # screenshots from the real end-to-end runs (§6)
  README.md
  requirements.txt, pytest.ini
```

## 3. Exact setup/run commands

See `README.md` for the full version. Short form:

```bash
python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
(cd ui && npm install)

# terminal 1
source .venv/bin/activate && uvicorn app.api.main:app --reload --port 8000
# terminal 2
cd ui && npm run dev
# open http://127.0.0.1:5173/
```

Tests: `source .venv/bin/activate && python -m pytest tests/ -v`

## 4. Prerequisites and tested environment

- Python 3.11.15, Node 22.22.2, npm 10.9.7, git 2.43.0, Rust/cargo
  1.94.1, `claude` CLI 2.1.278.
- Linux x86_64 (container sandbox), no display server available.
- Backend and API-level tests need no network. The Claude Code adapter's
  real invocation needs an authenticated `claude` CLI (verified via
  `claude auth status`).

## 5. Tests run and results

```
python -m pytest tests/ -v
======================== 56 passed in ~4.5s ========================
```

Breakdown (files map ~1:1 to SPEC §18 requirements):

| File | Covers |
|---|---|
| `test_policy.py` (14) | path normalization/boundary checks (incl. a sibling-prefix regression guard), forbidden git subcommands, task envelope contents |
| `test_vcs_git.py` (16) | detection, repo validation, status (clean/dirty/non-repo), **clean-repo rollback**, **dirty-repo rollback preserving tracked + untracked pre-existing work**, deleted-file restore, change-manifest computation excluding pre-existing dirty state |
| `test_claude_code_adapter.py` (9) | conforming result parsing, prose-prefixed fenced-JSON extraction, malformed result, CLI-level error, non-JSON CLI output, non-zero exit, **timeout + process termination**, **cancel signalling**, missing-binary detection |
| `test_task_lifecycle.py` (5) | task state machine, illegal transitions rejected, terminal states have no outgoing edges, active-task detection |
| `test_orchestrator.py` (9) | full pipeline happy path + manifest-vs-claim match, **discrepancy detection**, **malformed result → task FAILED (never silently COMPLETED)**, timeout → FAILED, dirty-repo baseline warning + successful run, **KEEP**, **ROLLBACK restoring dirty pre-existing work**, KEEP-then-ROLLBACK rejected, **concurrent second run blocked by the project lock** |
| `test_api_integration.py` (5) | full HTTP flow (add project → create task → run → poll → changes → keep), 400 on bad path, 404 on unknown task, 409 on a locked project |

All of SPEC §18's required coverage areas are exercised, using disposable
`tmp_path` git fixtures — no test ever touches a real project.

## 6. Manual end-to-end test performed

Two **real** runs (actual `claude` CLI, not a fake), driven through the
actual React UI in a headless Chromium browser, against disposable fixture
repositories created solely for this test (never MONTARO, per
instructions):

**Scenario A — clean repo, KEEP.** Added `/tmp/.../e2e_fixture_keep` (one
commit, clean tree), objective: *"Create hello.txt containing 'hello from
impulsor hub'."* Result: task COMPLETED in ~7s, executor claimed and Git
observed exactly one created file, no discrepancy, KEEP persisted it.
Screenshots: `docs/e2e/keep_scenario_completed.png`,
`docs/e2e/keep_scenario_kept.png`.

**Scenario B — dirty repo, ROLLBACK.** Fixture repo with a pre-existing
*uncommitted modification* to a tracked file and a pre-existing
*untracked* file (simulating the user's own unsaved work), objective:
*"Append a line to notes.txt and create ai_output.txt."* The Hub logged a
`task.dirty_repository_baseline` warning, took a checkpoint anyway
(SPEC 15's "if a safe approach can be implemented confidently, use it"
branch — see §8), ran the task, and flagged a real discrepancy (see §9).
On ROLLBACK: verified on the actual filesystem afterward —
`notes.txt` was restored to exactly its pre-task dirty content (the
user's own edit intact, the AI's appended line gone), `ai_output.txt`
(AI-created) was removed, and the pre-existing untracked file was
untouched. Screenshots: `docs/e2e/rollback_scenario_completed_with_discrepancy.png`,
`docs/e2e/rollback_scenario_rolled_back.png`.

This is the strongest evidence available that the core safety invariant in
SPEC 15 holds against the real executor, not just against test doubles.

## 7. Known limitations

1. **Dirty-repo change manifest can miss a second edit to an
   already-dirty file.** The manifest is computed by diffing `git status`
   porcelain codes captured before vs. after the run. If a file was
   already modified before the task (status code `" M"`) and the AI edits
   it further, the code is still `" M"` afterward, so that file does not
   appear as a task-attributable change — **this was caught live** in
   Scenario B above (`notes.txt` showed as "claimed but NOT observed").
   The system did the *safe* thing (surfaced a `task.claim_discrepancy`
   warning rather than silently trusting the claim), but the manifest
   itself is incomplete in this specific case. A fix (content-hash
   comparison instead of/alongside status codes) is a good first task for
   whoever picks this up next.
2. **No OS-level sandbox for the executor.** The workspace-boundary rule
   ("work only inside WORKSPACE") is enforced by the task envelope
   instruction, the CLI's default tool-to-cwd scoping, and Hub-side
   post-hoc Git verification — not by a hard OS boundary (chroot/
   container/etc). The git-history rule (no commit/reset/rebase/
   stash/checkout/branch/push/clean) *is* enforced at the CLI level via
   `--disallowedTools`, which is a real guardrail, not just prompt text.
   SPEC 10 asks for enforcement "where technically possible" within M1;
   full sandboxing is future work.
3. **Checkpoints are full filesystem copies**, not diffs (see §8 for why).
   This is correct and simple but does not scale gracefully to very large
   repositories/binary assets; fine for M1's scope.
4. **The project execution lock is in-process** (a `threading.Lock` per
   `project_id`), backed by a DB-level fallback check
   (`has_active_task`) for crash/restart recovery. It does not span
   multiple Hub processes; M1 only ever runs one.
5. **Tauri desktop build not verified.** This container has no display
   server or GTK/WebKitGTK system libraries, so `cargo tauri build`
   could not be exercised here. The React UI itself *was* fully verified
   (type-checked, built, and driven live in a real Chromium browser via
   Playwright — see §6). The Tauri skeleton is written to the current
   Tauri v2 config schema but is unbuilt/untested.
6. **Resource routing is a fixed pair**, not intelligent selection
   (explicitly correct per SPEC §4 — "no intelligent planner yet"), so
   `ResourceRouter` always returns the one git adapter and one
   claude_code adapter.
7. **Godot detection was not implemented.** SPEC 4 says it "may be
   detected/displayed if convenient" — treated as optional and skipped to
   keep scope minimal, since M1 must not execute/validate with Godot
   anyway.

None of these are silent — each is either caught by a test, caught live in
§6, or was a deliberate, documented scope decision. No requirement was
skipped without being named here.

## 8. Deviations from SPEC and reasons

- **Checkpoint/rollback mechanism**: SPEC 15 requires a safe, non-naive
  restore mechanism and explicitly allows implementing it with `git`
  primitives. This implementation instead uses a **filesystem-level
  snapshot** (`shutil.copytree` of the whole workspace minus `.git` and
  `.impulsor`, stored under `.impulsor/checkpoints/<id>/`) rather than
  `git stash`/`git commit`. Reason: `git stash` does not capture ignored
  files by default and interacts with the index in ways that are easy to
  get subtly wrong under a dirty repo; a plain recursive copy gives an
  exact, trivially-verifiable baseline and restore, independent of git
  plumbing edge cases, and was the approach that let me *prove* (not just
  assert) the dirty-repo invariant in both the unit tests and the live
  E2E run. `git` itself is still used for the observation half of the
  pipeline (`status`/`diff`), since that is specifically what
  "Git-observed changes" means in SPEC 3.10-3.11. This is a substitution
  of mechanism, not a weakening of the guarantee — see §5 and §6 for
  proof it holds.
- **Change manifest derivation**: computed as the delta between two
  `git status` snapshots (before/after) rather than a single post-hoc
  `git diff`, so that changes to files that were *already* dirty before
  the task can, in principle, be distinguished from the user's own
  pre-existing dirty state. §7.1 documents the one case where this
  approach still falls short.
- Everything else follows the SPEC directly; no stack substitution was
  needed (Tauri/React/TypeScript/Python/FastAPI/Pydantic/SQLite all
  worked as specified).

## 9. Safety/rollback design explanation

Three independent layers, each verified by tests and/or the live E2E run:

1. **Never trust the executor's claim.** `ExecutorResult` is validated
   with Pydantic; a non-conforming or missing result is treated as an
   *unverified* run (`task.status = FAILED`, `failure_reason` recorded),
   never as a silent success — even if the CLI process itself exited 0
   (`_final_statuses` in `orchestrator.py`). Observed for real in the
   first attempt at Scenario B in §6 before a parser hardening fix (see
   the git history / adapter docstring) — the model prefixed prose before
   its JSON despite instructions, and the system correctly refused to
   treat that as success.
2. **Independent observation.** After execution, `GitAdapter.status()` is
   called again and diffed against the pre-task snapshot to build the
   `FileChange` manifest, independent of anything the executor said. Each
   `FileChange` row records `claimed_by_executor` and `observed_by_vcs`
   separately; any mismatch is logged as a `task.claim_discrepancy`
   warning event and shown in the UI, without blocking the user's ability
   to inspect and decide.
3. **Reversible by construction.** Every run gets a checkpoint *before*
   the executor touches anything (`CHECKPOINTING` happens before
   `RUNNING` in the task state machine — see `TASK_TRANSITIONS` in
   `database/models.py`). ROLLBACK replays that snapshot exactly: it
   deletes anything created since the checkpoint and restores every path
   that existed at checkpoint time to its exact prior bytes — covering
   modified, deleted, and re-created files uniformly, and proven (unit +
   live E2E) to preserve pre-existing tracked *and* untracked user work.
   KEEP and ROLLBACK are mutually exclusive terminal dispositions on a
   `TaskRun` (`RunDisposition`), independent of whether the run itself
   was verified as COMPLETED or FAILED — a failed/timed-out run can still
   be rolled back if a checkpoint exists.

## 10. Files/modules that should be reviewed next

- `app/adapters/vcs/git/adapter.py` — the safety-critical core; review the
  checkpoint/restore algorithm and `compute_change_manifest` first.
- `app/core/orchestrator/orchestrator.py` — the state machine and where
  every safety decision is wired together.
- `app/adapters/ai/claude_code/adapter.py` — the real CLI integration,
  including `--disallowedTools` and the result-extraction heuristics in
  `_parse_executor_result` (§7.1 fix lives here).
- `tests/test_vcs_git.py` and `tests/test_orchestrator.py` — the safety
  test suite; extend these before changing checkpoint/rollback behavior.

## 11. Recommended M2 starting point

Per CLAUDE_M1: M2 is the Godot adapter + headless validation + repair
loop. Suggested first steps once M1 is reviewed:

1. Fix §7.1 (content-hash-based manifest diffing) first — M2's repair
   loop will depend on an accurate change manifest.
2. Add a `GodotAdapter` implementing a new, narrow "Validator" contract
   (not the existing `AIExecutor`/`VCS` contracts) so the orchestrator's
   verification phase can optionally invoke headless validation after
   the existing Git-based verification, without touching the M1 pipeline.
3. Reuse the existing `EVENT`/`FILE_CHANGE` tables for validation
   results before introducing new schema.

---

## Completion response (per CLAUDE_M1 §"Completion response")

1. **M1 status:** PASS.
2. **Test command / results:** `python -m pytest tests/ -v` → **56 passed**,
   0 failed. UI: `npx tsc -b && npx vite build` → clean build, no
   type errors.
3. **End-to-end scenario tested:** two real runs against the live `claude`
   CLI through the actual UI — a clean-repo KEEP and a dirty-repo
   ROLLBACK — both verified against the real filesystem/git state
   afterward (§6).
4. **SPEC deviations:** checkpoint/rollback implemented as a filesystem
   snapshot instead of git-stash-based, and the change manifest computed
   as a before/after `git status` diff — both documented with rationale
   in §8, and known to still miss one specific edge case (§7.1).
5. **Path to M1_REPORT.md:** `M1_REPORT.md` (this file, repo root).
6. **Exact commands to launch the app:**
   ```bash
   source .venv/bin/activate && uvicorn app.api.main:app --reload --port 8000
   # in a second terminal
   cd ui && npm run dev
   # open http://127.0.0.1:5173/
   ```

M2 is not started.

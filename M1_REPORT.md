# Impulsor Hub — Milestone 1 Report

Status: **PASS.** M1 is closed for external audit: every must-implement
item is delivered, the one previously-documented limitation (§7.1 in the
prior revision of this report — a dirty-repo change-manifest gap) has been
fixed, proven with new tests, and re-verified against the real `claude`
CLI in the exact scenario that first exposed it. This revision documents
that fix; see the "Revision history" note at the end for what changed
since the provisional acceptance.

## 1. Implementation summary

M1 delivers the full pipeline required by the SPEC:

`local project -> task -> safe baseline -> Claude Code executor -> actual Git inspection -> manifest -> user KEEP or ROLLBACK`

- **Backend**: Python, FastAPI, SQLite (stdlib `sqlite3`, no ORM), Pydantic
  v2 contracts for every entity and for the executor result schema.
- **Adapters**: a `GitAdapter` (detection, status, checkpoint/restore,
  content-hash-based change-manifest computation) and a `ClaudeCodeAdapter`
  that drives the real `claude` CLI non-interactively
  (`-p --output-format json`).
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
- **Tests**: 64 automated tests (pytest), see §5.
- **Real end-to-end verification**: three full runs against the *actual*
  `claude` CLI (not a mock) driving the real UI in a headless browser — a
  clean-repo KEEP, a dirty-repo ROLLBACK, and the dirty-file-re-edit
  scenario that specifically re-verifies the §7.1 fix. See §6.

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
  tests/                             # 64 tests: policy, git adapter, claude_code adapter,
                                      # task lifecycle, orchestrator pipeline, API integration
  docs/
    IMPULSOR_HUB_SPEC_V0.1.md, CLAUDE_M1.md     # copies of the source spec/brief
    e2e/                              # screenshots + raw evidence from all real end-to-end runs (§6)
      reedit_scenario/                # §7.1 fix re-verification: screenshots, file_changes.json,
                                       # events.json, filesystem_verification.txt
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
======================== 64 passed in ~5.3s ========================
```

Breakdown (files map ~1:1 to SPEC §18 requirements):

| File | Count | Covers |
|---|---|---|
| `test_policy.py` | 14 | path normalization/boundary checks (incl. a sibling-prefix regression guard), forbidden git subcommands, task envelope contents |
| `test_vcs_git.py` | 19 | detection, repo validation, status (clean/dirty/non-repo), **clean-repo rollback**, **dirty-repo rollback preserving tracked + untracked pre-existing work**, deleted-file restore, and the full §7.1 content-hash manifest suite: dirty tracked file modified-again vs. untouched, dirty untracked file modified-again vs. untouched, new file created, file deleted, created-then-deleted nets to no change, and a broken-symlink hardening case |
| `test_claude_code_adapter.py` | 9 | conforming result parsing, prose-prefixed fenced-JSON extraction, malformed result, CLI-level error, non-JSON CLI output, non-zero exit, **timeout + process termination**, **cancel signalling**, missing-binary detection |
| `test_task_lifecycle.py` | 5 | task state machine, illegal transitions rejected, terminal states have no outgoing edges, active-task detection |
| `test_orchestrator.py` | 12 | full pipeline happy path + manifest-vs-claim match, **discrepancy detection**, **malformed result → task FAILED (never silently COMPLETED)**, timeout → FAILED, dirty-repo baseline warning + successful run, **KEEP**, **ROLLBACK restoring dirty pre-existing work**, KEEP-then-ROLLBACK rejected, concurrent-run project lock, and three §7.1-specific pipeline tests: re-edit detected with **no false discrepancy**, **KEEP** after a dirty re-edit, and **ROLLBACK** after a dirty re-edit with **byte-for-byte** baseline preservation |
| `test_api_integration.py` | 5 | full HTTP flow (add project → create task → run → poll → changes → keep), 400 on bad path, 404 on unknown task, 409 on a locked project |

All of SPEC §18's required coverage areas are exercised, using disposable
`tmp_path` git fixtures — no test ever touches a real project. UI:
`npx tsc -b && npx vite build` → clean, no type errors (unchanged by this
fix; no UI code was touched).

## 6. Manual end-to-end tests performed

Three **real** runs (actual `claude` CLI, not a fake), driven through the
actual React UI in a headless Chromium browser, against disposable fixture
repositories created solely for these tests (never MONTARO, per
instructions). All were re-run after the §7.1 fix landed.

**Scenario A — clean repo, KEEP.** Objective: *"Create hello.txt
containing 'hello from impulsor hub'."* Result: task COMPLETED in ~7s,
executor claimed and Git observed exactly one created file, no
discrepancy, KEEP persisted it. Evidence: `docs/e2e/keep_scenario_*.png`.

**Scenario B — dirty repo, ROLLBACK.** Pre-existing uncommitted
modification to a tracked file + a pre-existing untracked file. Objective:
*"Append a line to notes.txt and create ai_output.txt."* ROLLBACK restored
`notes.txt` to its exact pre-task dirty content, removed the AI-created
file, left the pre-existing untracked file untouched. Evidence:
`docs/e2e/rollback_scenario_*.png`.

**Scenario C — the exact §7.1 regression scenario, re-run post-fix.**
Fresh disposable repo. Pre-task state: `notes.txt` has an uncommitted user
edit, and `scratch_before.txt` is a pre-existing untracked file. Objective
given to Claude: *"Append the line 'AI SECOND EDIT' to notes.txt, and
create a new file named ai_new_file.txt."* — i.e. Claude re-edits the
already-dirty file and also creates a new one, precisely the case §7.1
described as broken.

Observed (real UI, real filesystem, real `claude` CLI):
- Task Result showed **`modified notes.txt (+1/-0)`** and
  **`created ai_new_file.txt (+1/-0)`** — the re-edit of the already-dirty
  file *was* detected as a task-attributable change.
- **No discrepancy was shown or logged** (`GET /api/events` for the task
  has zero `task.claim_discrepancy` entries) — Claude declared both files
  and the Hub's independent observation matched exactly. Confirmed via the
  `FILE_CHANGE` rows too: both entries have `claimed_by_executor: true`
  **and** `observed_by_vcs: true`.
- **ROLLBACK**, verified against the real filesystem afterward:
  `notes.txt` → exactly `"line1\nuser's own uncommitted edit"` (the
  content immediately before the task, byte for byte); `ai_new_file.txt`
  → gone; `scratch_before.txt` → untouched,
  `"pre-existing untracked scratch file\n"`.

Evidence preserved under `docs/e2e/reedit_scenario/`: `completed_task_result.png`,
`after_rollback.png`, `file_changes.json` (raw API response), `events.json`
(raw API response, showing the absence of any discrepancy event), and
`filesystem_verification.txt` (the exact filesystem check transcript).

This is the strongest evidence available that both the original SPEC 15
invariant *and* the §7.1 fix hold against the real executor, not just
against test doubles.

## 7. Known limitations

§7.1 from the prior revision ("dirty-repo change manifest can miss a
second edit to an already-dirty file") is **fixed** — see §8 for the
mechanism and §6 Scenario C for live proof. Remaining limitations:

1. **No OS-level sandbox for the executor.** The workspace-boundary rule
   ("work only inside WORKSPACE") is enforced by the task envelope
   instruction, the CLI's default tool-to-cwd scoping, and Hub-side
   post-hoc Git verification — not by a hard OS boundary (chroot/
   container/etc). The git-history rule (no commit/reset/rebase/
   stash/checkout/branch/push/clean) *is* enforced at the CLI level via
   `--disallowedTools`, which is a real guardrail, not just prompt text.
   SPEC 10 asks for enforcement "where technically possible" within M1;
   full sandboxing is future work.
2. **Checkpoints are full filesystem copies**, not diffs. Correct and
   simple, but does not scale gracefully to very large repositories/binary
   assets. The §7.1 fix adds a full read-and-hash pass over every common
   path on top of that existing copy cost (same order of magnitude as the
   copy itself, so not a new class of limitation, but worth naming
   together): for a very large repo this makes verification, not just
   checkpointing, proportional to total tracked+untracked content size.
   Fine for M1's scope; a future milestone could hash incrementally or
   scope hashing to paths `git status` already flags as touched.
3. **Line-level additions/deletions are `null` for binary files** (or any
   file that isn't valid UTF-8) in a `FileChange`'s `additions`/
   `deletions` fields — `change_type` (created/modified/deleted) is still
   always correct, since that classification is hash-based, not
   line-based. This matches SPEC 14's "additions/deletions when
   practical."
4. **No rename detection.** A file rename still shows as one `deleted` +
   one `created` entry rather than a `renamed` entry. SPEC 14 lists this
   as "when detectable" (optional); unchanged from the original M1
   delivery, not something §7.1's fix touched.
5. **The project execution lock is in-process** (a `threading.Lock` per
   `project_id`), backed by a DB-level fallback check
   (`has_active_task`) for crash/restart recovery. It does not span
   multiple Hub processes; M1 only ever runs one.
6. **Tauri desktop build not verified.** This container has no display
   server or GTK/WebKitGTK system libraries, so `cargo tauri build`
   could not be exercised here. The React UI itself *was* fully verified
   (type-checked, built, and driven live in a real Chromium browser via
   Playwright — see §6). The Tauri skeleton is written to the current
   Tauri v2 config schema but is unbuilt/untested.
7. **Resource routing is a fixed pair**, not intelligent selection
   (explicitly correct per SPEC §4 — "no intelligent planner yet").
8. **Godot detection was not implemented.** SPEC 4 says it "may be
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
  plumbing edge cases.
- **Change manifest derivation (updated by the §7.1 fix).** The original
  M1 delivery computed the manifest as the delta between two `git status`
  snapshots (before/after task execution). That approach could not
  distinguish a file that was already dirty at checkpoint time from one
  the task edited *further* while it stayed dirty, since both cases
  produce the identical git status code (e.g. `" M"`) before and after —
  confirmed live in the original Scenario B run (§6 in the prior
  revision), which is exactly what §7.1 named.

  **Fix:** `GitAdapter.compute_change_manifest` now takes the
  `CheckpointRef` instead of two `VcsStatus` snapshots, and classifies
  every path by comparing **actual file content** against the checkpoint
  snapshot already taken before the task ran:
  - `created` = present now, absent from the snapshot.
  - `deleted` = present in the snapshot, absent now.
  - `modified` = present in both, but `sha256(checkpoint bytes) !=
    sha256(current bytes)`.
  - present in both with **identical** hashes = excluded — genuinely
    untouched during the task, regardless of what `git status` still
    shows relative to HEAD.

  Additions/deletions are computed with `difflib.SequenceMatcher` between
  the checkpoint version and the current version of the file (not `git
  diff` against HEAD), so a re-edited dirty file's reported line delta is
  the task's own contribution only, not the user's pre-existing dirty
  lines mixed in.

  This is a strictly more accurate mechanism than the one it replaces —
  it does not weaken any existing guarantee (checkpoint/restore is
  unchanged; only *detection* changed) and closes exactly the gap named in
  §7.1, proven by 8 new tests (§5) and a live re-run of the exact failing
  scenario (§6 Scenario C).
- Everything else follows the SPEC directly; no stack substitution was
  needed (Tauri/React/TypeScript/Python/FastAPI/Pydantic/SQLite all
  worked as specified).

## 9. Safety/rollback design explanation

Three independent layers, each verified by tests and/or the live E2E runs:

1. **Never trust the executor's claim.** `ExecutorResult` is validated
   with Pydantic; a non-conforming or missing result is treated as an
   *unverified* run (`task.status = FAILED`, `failure_reason` recorded),
   never as a silent success — even if the CLI process itself exited 0.
   Observed for real during the original Scenario B run before a parser
   hardening fix — the model prefixed prose before its JSON despite
   instructions, and the system correctly refused to treat that as
   success.
2. **Independent observation.** After execution, the change manifest is
   computed by comparing actual file content against the pre-task
   checkpoint (§8), independent of anything the executor said. Each
   `FileChange` row records `claimed_by_executor` and `observed_by_vcs`
   separately; any mismatch is logged as a `task.claim_discrepancy`
   warning event and shown in the UI. Since the §7.1 fix, a correctly
   *declared* re-edit of an already-dirty file no longer produces a false
   discrepancy (§6 Scenario C) — the safety net is more accurate without
   being any less strict about undeclared changes.
3. **Reversible by construction.** Every run gets a checkpoint *before*
   the executor touches anything. ROLLBACK replays that snapshot exactly:
   it deletes anything created since the checkpoint and restores every
   path that existed at checkpoint time to its exact prior bytes —
   covering modified, deleted, and re-created files uniformly, and proven
   (unit + live E2E, including the byte-for-byte assertion added for
   §7.1) to preserve pre-existing tracked *and* untracked user work, even
   when the task re-edits an already-dirty file. This mechanism did not
   need to change for the §7.1 fix — it was never the part that was
   broken; only change *detection/reporting* was.

## 10. Files/modules that should be reviewed next

- `app/adapters/vcs/git/adapter.py` — the safety-critical core; review
  `compute_change_manifest`'s hash comparison and the checkpoint/restore
  algorithm together, since they now share the same snapshot.
- `app/core/orchestrator/orchestrator.py` — the state machine and where
  every safety decision is wired together.
- `app/adapters/ai/claude_code/adapter.py` — the real CLI integration,
  including `--disallowedTools` and the result-extraction heuristics in
  `_parse_executor_result`.
- `tests/test_vcs_git.py` and `tests/test_orchestrator.py` — the safety
  test suite; extend these before changing checkpoint/rollback or manifest
  behavior.

## 11. Recommended M2 starting point

Per CLAUDE_M1: M2 is the Godot adapter + headless validation + repair
loop. Suggested first steps once M1 is reviewed:

1. Add a `GodotAdapter` implementing a new, narrow "Validator" contract
   (not the existing `AIExecutor`/`VCS` contracts) so the orchestrator's
   verification phase can optionally invoke headless validation after
   the existing Git-based verification, without touching the M1 pipeline.
2. Reuse the existing `EVENT`/`FILE_CHANGE` tables for validation
   results before introducing new schema.
3. If repo/binary-asset size becomes a real concern for M2's Godot
   projects, revisit limitation §7.2 (hashing cost) before it does.

---

## Completion response (per CLAUDE_M1 §"Completion response")

1. **M1 status:** PASS.
2. **Test command / results:** `python -m pytest tests/ -v` → **64 passed**,
   0 failed. UI: `npx tsc -b && npx vite build` → clean build, no type
   errors.
3. **End-to-end scenario tested:** three real runs against the live
   `claude` CLI through the actual UI — clean-repo KEEP, dirty-repo
   ROLLBACK, and the dirty-file-re-edit scenario that specifically
   re-verifies the §7.1 fix — all verified against the real
   filesystem/git state afterward (§6).
4. **SPEC deviations:** checkpoint/rollback implemented as a filesystem
   snapshot instead of git-stash-based; the change manifest now computed
   by content-hash comparison against that snapshot instead of diffing
   `git status` codes (§8) — this second point is the §7.1 fix itself.
5. **Path to M1_REPORT.md:** `M1_REPORT.md` (this file, repo root).
6. **Exact commands to launch the app:**
   ```bash
   source .venv/bin/activate && uvicorn app.api.main:app --reload --port 8000
   # in a second terminal
   cd ui && npm run dev
   # open http://127.0.0.1:5173/
   ```

M2 is not started.

---

## Revision history

- **Rev 1 (provisional acceptance):** initial M1 delivery, 56 tests, §7.1
  identified and documented as a known limitation (git-status-code-based
  manifest couldn't detect re-edits of already-dirty files).
- **Rev 2 (this revision, audit-ready):** §7.1 fixed via content-hash
  comparison against the checkpoint snapshot (§8); 8 new tests (64 total);
  the exact §7.1 regression scenario re-run against the real `claude` CLI
  and verified (§6 Scenario C); no existing test was deleted or weakened
  to make the suite pass. M2 still not started.

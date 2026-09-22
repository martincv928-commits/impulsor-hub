# Impulsor Hub — Milestone 2 Report

Status: **PASS.** Godot is now the first external validation tool wired into
Impulsor Hub, end to end, with a real repair loop verified against the real
`claude` CLI and a real Godot engine — not mocks. `REAL_GODOT_E2E = VERIFIED`
(see §6).

## 1. Implementation summary

M2 delivers the full cycle required by the SPEC:

```
User creates task
      ↓
Claude Code modifies Godot project
      ↓
Hub observes real changes (checkpoint-vs-final-state manifest, unchanged
                            from the M1 §7.1 content-hash mechanism)
      ↓
Godot validates automatically (headless, real engine)
      ↓
PASS ──────────────────────────→ ready for KEEP
  │
  └ FAIL (repairable)
       ↓
  Claude receives the REAL Godot error text (Repair Context)
       ↓
  Claude attempts a fix (a "repair attempt", not a new task)
       ↓
  Hub re-observes real changes, Godot validates again
       ↓
  PASS, or MAX_REPAIR_ATTEMPTS (2) exhausted
       ↓
  KEEP (gated on PASS, explicit override otherwise) / ROLLBACK (always
  to the ORIGINAL pre-task checkpoint, whatever happened in between)
```

- **Validator contract**: `app/adapters/validator/base.py` — a generic
  `ValidatorAdapter` ABC (`detect`, `health_check`, `capabilities`,
  `supports`, `validate`, `cancel`) and a structured `ValidationResult`
  (`validator`, `status: pass|fail|error|timeout`, `exit_code`,
  `duration_ms`, `command`, `summary`, `errors`/`warnings` as
  `ValidationIssue(file, line, message)`, stdout/stderr excerpts). The
  orchestrator imports only this module and `ResourceRouter` — it has no
  reference to Godot anywhere.
- **GodotAdapter**: `app/adapters/validator/godot/adapter.py` — real
  headless GDScript syntax validation via
  `godot --path <workspace> --script res://<file> --check-only --quiet`
  run once per `.gd` file found in the project (see §8 for why this scope,
  not a full game boot). No fixed install path: `IMPULSOR_HUB_GODOT_PATH`
  override or a PATH search across common binary names
  (`godot4`, `godot`, `godot3-server`, `godot3`, ...); adds `--headless`
  automatically for Godot 4+ (not needed/used for Godot 3's `-server`
  build, which this environment actually has installed and validated
  against).
- **Project-type detection**: `projects/service.py` sets
  `project_type = "godot"` at add-project time when `project.godot` exists
  at the root (M1's existing `project_type` column — no schema addition
  needed there).
- **Resources**: Godot is a third fixed resource (`git`, `claude_code`,
  `godot`) — `ResourceRouter.select_validator()` and `core/resources.py`'s
  dicts extended; still no intelligent routing (M2 SPEC section 4).
- **Repair envelope**: `policy.build_repair_envelope(...)` renders a
  bounded (capped errors/warnings/files, no raw log dumps) "IMPULSOR HUB
  REPAIR ATTEMPT" prompt that explicitly tells the executor this is a
  correction of its own prior work, not a new task, and repeats the same
  workspace rules as the original task envelope. `ExecuteRequest` gained
  `full_prompt_override` so `ClaudeCodeAdapter` stays completely
  repair-agnostic — it just sends whatever prompt it's given.
- **Orchestrator**: `core/orchestrator/orchestrator.py` — after the
  initial execution, if the project wants validation, loops
  validate → repair (`MAX_REPAIR_ATTEMPTS = 2`) reusing the *one* checkpoint
  created before the initial execution throughout; the final
  manifest/`FileChange` rows are always computed checkpoint-vs-final-state
  (never last-repair-vs-previous, per §12); claims are accumulated across
  every attempt for discrepancy detection (§9E). Godot's PASS/FAIL is
  authoritative for the task's technical outcome once a validator applies,
  independent of the executor's own self-report (§9). Non-Godot projects
  are byte-for-byte unchanged M1 behavior (proven by test — §10).
- **Schema**: one additive column, `task_run.validation_status`
  (`pass|fail|error|timeout|NULL`), added to `schema.sql`'s `CREATE TABLE`
  for fresh databases *and* an `ALTER TABLE` migration guard in `db.py`
  for databases created before this column existed. No new tables.
- **KEEP gating**: `keep_task_run(..., override: bool = False)` raises
  unless `validation_status` is `NULL` (non-Godot, M1 behavior) or
  `"pass"`, unless the caller explicitly passes `override=True` — which is
  itself logged as a distinct event (`task_run.kept_with_override`), never
  silent.
- **UI**: Task Result gained a "Validation" card reconstructed from events
  (per-attempt PASS/FAIL/ERROR/TIMEOUT + final verdict) and the KEEP
  button is disabled behind an explicit "I understand validation failed
  and want to keep these changes anyway" checkbox when validation didn't
  pass. Resources needed zero changes — it already renders whatever the
  API returns generically.
- **Tests**: 91 total (64 M1 unchanged + 14 `GodotAdapter` unit tests
  against the real binary + 13 repair-loop pipeline tests), covering all
  24 required scenarios (§10).
- **Real E2E**: two full runs against the *actual* `claude` CLI and the
  *actual* installed Godot engine (§6) — `REAL_GODOT_E2E = VERIFIED`.

## 2. Final architecture / tree (additions since M1)

```text
impulsor-hub/
  app/
    adapters/
      validator/
        base.py                         # ValidatorAdapter contract + ValidationResult/Issue/Status
        godot/adapter.py                # real headless Godot validation
    core/
      orchestrator/orchestrator.py      # + validate/repair loop, MAX_REPAIR_ATTEMPTS, keep(override=)
      permissions/policy.py             # + RESULT_SCHEMA_INSTRUCTION (moved, shared), build_repair_envelope()
      resources.py                      # + godot resource dicts
      router/router.py                  # + select_validator()
    adapters/ai/base.py                 # ExecuteRequest.full_prompt_override
    database/{schema.sql,db.py,models.py}  # + task_run.validation_status (+ migration guard)
    projects/service.py                 # + _detect_project_type() (project.godot -> "godot")
    api/routers/tasks.py                # + keep endpoint accepts {override}
  ui/src/
    api/client.ts                       # + TaskRun.validation_status, keepRun(id, override)
    pages/TaskResult.tsx                # + Validation card, KEEP gated behind explicit override
  tests/
    test_godot_adapter.py               # 14 tests, real godot3-server binary
    test_repair_loop.py                 # 13 tests, fakes (speed/determinism) + real GitAdapter
    conftest.py                         # + godot_fixture_repo, dirty_godot_fixture_repo
    fakes.py                            # + FakeValidatorAdapter, sequenced_* on FakeAIExecutorAdapter
  docs/e2e/
    godot_pass_scenario/                # Scenario A evidence
    godot_repair_scenario/              # Scenario B evidence
  M2_REPORT.md
```

## 3. Setup/run/test commands

Unchanged from M1 (`README.md`) plus one new external prerequisite:

```bash
# Debian/Ubuntu: headless Godot 3 (this is what was actually installed
# and validated against in this environment)
apt-get install -y godot3-server
# or set IMPULSOR_HUB_GODOT_PATH to any Godot 3/4 executable
```

Tests: `source .venv/bin/activate && python -m pytest tests/ -v`

## 4. Prerequisites and tested environment

Same as M1, plus: **Godot 3.5.2.stable.custom_build** (`godot3-server`,
Debian/Ubuntu `universe` package), headless, no display server needed.
Godot 4 support is implemented (executable name detection,
version-conditional `--headless` flag) but **not tested against a real
Godot 4 binary** in this environment — flagged as a limitation (§7).

## 5. Real, load-bearing discovery during development

`godot3-server --version` exits with process code **255 even on success**
on this Debian build. `GodotAdapter.detect()` originally gated availability
on exit code 0 and reported Godot as *not installed* despite it working
perfectly — caught immediately by the adapter's own smoke test against the
real binary, before any test was even written. Fixed by judging success on
output shape (`^\d+\.`) instead of exit code; documented in the adapter's
docstring and covered by `test_godot_detected`/`test_health_check_reports_healthy_when_available`.
This is exactly the kind of real, unpredictable tool quirk that using the
actual binary (rather than only mocks) is meant to catch.

## 6. Real E2E scenarios (REAL_GODOT_E2E = VERIFIED)

Both scenarios ran the actual `claude` CLI and the actual `godot3-server`
binary, driven through the real React UI in headless Chromium, against
disposable fixture repositories created solely for this test (never
MONTARO). Evidence (screenshots, raw event/file-change JSON, filesystem
transcripts) is under `docs/e2e/godot_pass_scenario/` and
`docs/e2e/godot_repair_scenario/`.

**Scenario A — PASS.** Minimal valid Godot 3 project. Objective: *"Add a
new function named add_numbers(a, b) to main.gd that returns a + b."*
Claude wrote valid GDScript; `validation.passed` at 85ms; Task Result
showed `Attempt 0 (initial) — godot: PASS` / `Final: VALIDATED`; KEEP
persisted it; independently re-ran `godot3-server --check-only` against
the real file afterward — exit 0.

**Scenario B — real auto-repair.** Same setup, but the objective asked for
GDScript 4's `@export` annotation on a project whose installed engine is
Godot 3.5.2 — a **genuine, unprompted engine-version mismatch**, not a
fabricated bug: `@export` really doesn't parse under Godot 3 (verified by
hand against the raw binary before building the scenario: real error
`Parse Error: Unexpected '@'`). Observed:
- **Attempt 0**: Claude used `@export var lives: int = 3`.
  `validation.failed` at 97ms, 1 real error, the real Godot message
  surfaced in the Repair Context.
- **Repair 1**: Claude's own summary shows it read and reasoned from the
  real error ("project targets Godot 3.x ... requires `export(type) var`
  syntax instead of Godot 4's `@export`"), rewrote it correctly.
  `validation.passed` at 104ms.
- **Final: VALIDATED**, task COMPLETED. UI showed both attempts with their
  real PASS/FAIL badges.
- **ROLLBACK**, verified against the real filesystem afterward: `main.gd`
  restored to exactly `"extends Node\n\nfunc _ready():\n\tprint(\"hello\")\n"`
  — byte-for-byte the pre-task committed content, reverting *both* the
  initial attempt's and the repair's changes in one step, and `git status`
  showed nothing but the Hub's own `.impulsor/` left untracked.

One more genuine observation from Scenario B worth recording: Claude's own
repair summary noted it *tried* to double-check its fix by running Godot
itself via Bash, and was denied by the session's non-interactive
permission policy (`--permission-prompts none`) — it proceeded anyway,
reasoning correctly from the project config instead. The Hub's own,
independent `godot3-server` invocation is what actually confirmed the
PASS — a live illustration of §9's principle that the external validator
has authority over its own domain, not the executor's self-report or
self-checks.

## 7. Known limitations

1. **Only tested against Godot 3.5.2 in this environment.** Godot 4
   support (executable names, the version-conditional `--headless` flag)
   is implemented but not exercised against a real Godot 4 binary here —
   no Godot 4 package was available through this container's package
   proxy. Recommend re-running `test_godot_adapter.py` and the two E2E
   scenarios against a real Godot 4 install before relying on this in
   production for Godot 4 projects.
2. **Validation scope is GDScript syntax, not a full game boot.**
   Documented as a deliberate M2 decision (§8) — catches real parse
   errors (proven live) but not, e.g., missing resource references, scene
   wiring mistakes, or runtime logic bugs. A reasonable, real external
   check for M2's purpose; broader validation (headless scene boot,
   asset-import correctness) is future work, likely for whoever owns
   MONTARO's actual Godot validation needs.
3. **Hashing cost scales with project size** (inherited from M1 §7.2,
   unchanged): the manifest comparison re-hashes every common path against
   the checkpoint snapshot; for MONTARO-scale projects this and the
   checkpoint copy itself are the first things worth profiling.
4. **Repair attempts share the same `timeout_seconds`** as the original
   task (no separate, possibly-shorter timeout for a repair specifically).
   Reasonable default; not required in the SPEC and not changed.
5. **No rename/scene-level classification** in the manifest (unchanged
   from M1) — a deleted+recreated file still shows as two entries, not one
   `renamed` entry.
6. Everything from M1's own limitations list (`M1_REPORT.md` §7) that
   wasn't specifically addressed by this milestone still applies
   (no OS-level executor sandbox, Tauri desktop build unverified, etc.).

None of these are silent — each is either caught by a test, observed live
in §5/§6, or a deliberate, documented scope decision.

## 8. Deviations from SPEC and reasons

- **Validation scope**: GDScript syntax validation (`--check-only
  --script` per `.gd` file) rather than a full project boot. SPEC section
  2 asks the adapter to "ejecutar Godot mediante CLI/headless" without
  mandating exactly what gets checked. Booting the full project
  (`--path <project> --quit`) is historically unreliable for exit-code
  purposes in Godot CI pipelines (script errors don't reliably propagate
  to the process exit code) and would need a first-run asset-import pass
  that is slow and fragile in a headless container with a dummy video
  driver. `--check-only --script` gives a reliable, real, per-file exit
  code and a clean stderr message with file/line — verified empirically
  (§5) and proven against a genuine error (§6 Scenario B) before this was
  trusted as the mechanism.
- **`ValidationResult` schema**: implemented essentially as SPEC section
  1's example, with `errors`/`warnings` as a small `ValidationIssue`
  dataclass (`file`, `line`, `message`) instead of bare strings, so the UI
  and repair-context formatting can use structure instead of parsing text
  back out — explicitly permitted ("No copies necesariamente este esquema
  literalmente").
- **Attempt history**: no new table. Every attempt (initial + each repair)
  is logged via the existing `EVENT` system
  (`task.execution_started/finished`, `validation.*`, `repair.*`, each
  carrying an `attempt` number in its payload) — fully reconstructable via
  `GET /api/events`, exactly as SPEC section 8 asks, with the one additive
  `task_run.validation_status` column as the only schema change (needed
  for KEEP-gating without re-deriving it from events on every check).
- Everything else follows the SPEC directly.

## 9. Safety design explanation (M2 additions on top of M1)

1. **The checkpoint is created exactly once**, before the initial
   execution, and is the only checkpoint for the task_run's entire
   lifecycle — repairs never create a new one (verified by
   `test_checkpoint_is_created_exactly_once_even_with_repairs` and live in
   §6 Scenario B's rollback). ROLLBACK always restores to that one
   checkpoint, regardless of how many repair attempts happened in
   between.
2. **The final manifest is always checkpoint-vs-final-state**, computed
   once after the whole initial+repair sequence concludes, using the same
   content-hash mechanism from M1 §7.1/§8 (unchanged) — never an
   incremental "last repair vs previous" diff. This is true by
   construction: `compute_change_manifest(workspace, ref)` always compares
   against the *original* `ref`, so calling it after any attempt already
   yields the right answer.
3. **Claims accumulate across every attempt** (initial + each repair) into
   one set compared against the final manifest for discrepancy detection
   — a file claimed in the initial attempt but never touched again still
   correctly shows as claimed-and-observed; a file introduced only during
   a repair is correctly attributed too.
4. **Godot has authority over its own domain.** A PASS is decisive for the
   task's technical outcome even if the *last* executor self-report was
   malformed — the independent validator is a stronger signal than the
   executor's own claim once it applies. A FAIL or an ERROR/TIMEOUT is
   never silently turned into COMPLETED; KEEP is blocked without an
   explicit, distinctly-logged override.
5. **ERROR/TIMEOUT is never confused with FAIL.** A validator crash or
   timeout does not trigger a repair attempt (there's nothing coherent for
   Claude to fix about the *validator* failing to run) and is reported
   with a distinct `validation_status` and failure reason wording
   ("Validator error/timeout: ...") rather than "validation failed".

## 10. Tests run and results

```
python -m pytest tests/ -v
======================== 91 passed in ~8s ========================
```

| File | Count | Covers |
|---|---|---|
| `test_policy.py` | 14 | (M1, unchanged) |
| `test_vcs_git.py` | 19 | (M1, unchanged) |
| `test_claude_code_adapter.py` | 9 | (M1, unchanged) |
| `test_task_lifecycle.py` | 5 | (M1, unchanged) |
| `test_orchestrator.py` | 12 | (M1, unchanged) |
| `test_api_integration.py` | 5 | (M1; one assertion updated to include `godot` in the resources set) |
| `test_godot_adapter.py` | 14 | **items 1-10**: detected, not installed, health check (available/unavailable), project detected, non-Godot project unsupported, PASS, FAIL with file/line, timeout, launch/process error (+ binary-missing, non-Godot-project error variants), cancellation, plus a no-scripts-trivial-PASS case — all against the **real** `godot3-server` binary |
| `test_repair_loop.py` | 13 | **items 11-24**: PASS-needs-no-repair, FAIL→repair→PASS, FAIL→repair-FAIL→repair-PASS, exhausted-after-MAX_REPAIR_ATTEMPTS (with rollback still working), rollback after 1 repair, rollback after multiple repairs, dirty baseline preserved after repair+rollback, final manifest is checkpoint-vs-final-state (not last-repair-only), KEEP after PASS, validation failure never silently COMPLETED (+ override path distinctly logged), non-Godot project keeps M1 behavior (validator never even consulted), claim-vs-reality discrepancy still detected inside the Godot pipeline, checkpoint created exactly once across repairs |

UI: `npx tsc -b && npx vite build` → clean, no type errors.

## 11. Definition of Done — M2

- [x] Los 64 tests de M1 siguen pasando.
- [x] Todos los nuevos tests M2 pasan (27 new; 91 total).
- [x] GodotAdapter existe.
- [x] Validator contract es genérico (orchestrator has zero Godot imports).
- [x] Godot detection funciona (real binary; quirk found and fixed, §5).
- [x] Godot health check funciona.
- [x] Godot aparece en Resources.
- [x] Proyecto Godot es detectado (`project.godot` at add-project time).
- [x] Proyecto no-Godot mantiene comportamiento M1 (validator never called — `test_non_godot_project_keeps_m1_behavior`).
- [x] Godot headless valida proyecto real (§5, §6).
- [x] PASS se registra correctamente.
- [x] FAIL se registra correctamente.
- [x] ERROR/TIMEOUT se distingue de FAIL (§9.5).
- [x] Repair Context funciona (bounded, explicit "repair not new task" framing, real errors flow through — §6 Scenario B).
- [x] Repair loop funciona (real, §6 Scenario B).
- [x] MAX_REPAIR_ATTEMPTS se respeta (`test_repairs_exhausted_never_exceeds_max_attempts`).
- [x] Historial de intentos queda registrado (EVENT system, per-attempt payloads).
- [x] Manifest final usa checkpoint original (§9.2, tested).
- [x] ROLLBACK después de repairs restaura baseline original (real, §6 Scenario B; tested for dirty baselines too).
- [x] KEEP no ignora silenciosamente una validación fallida (§9.4, tested).
- [x] E2E PASS con Claude real + Godot real funciona (§6 Scenario A).
- [x] E2E FAIL→REPAIR→PASS con Claude real + Godot real funciona (§6 Scenario B).
- [x] M2_REPORT.md está completo (this document).
- [x] M3 NO fue iniciado.

---

## Completion response

1. **M2 status:** PASS. `REAL_GODOT_E2E = VERIFIED` (Godot 3.5.2 only —
   see §7.1 for the Godot 4 caveat).
2. **Test command / results:** `python -m pytest tests/ -v` → **91
   passed**, 0 failed (64 M1 + 27 new M2). UI: `npx tsc -b && npx vite
   build` → clean.
3. **E2E scenarios:** both real (`claude` CLI + `godot3-server`) — a
   clean PASS and a genuine engine-version-mismatch FAIL → repair → PASS,
   both verified against the real filesystem after KEEP/ROLLBACK (§6).
4. **SPEC deviations:** validation scope is GDScript syntax
   (`--check-only --script`) rather than a full game boot, and attempt
   history lives entirely in the existing EVENT system plus one additive
   `task_run.validation_status` column — no new tables. Both documented
   with rationale in §8.
5. **Known limitations:** not tested against a real Godot 4 binary; syntax-only
   validation scope; hashing/checkpoint cost scales with project size
   (inherited from M1); repairs share the task's timeout; no
   rename/scene-level manifest classification. Full list in §7.
6. **Path to M2_REPORT.md:** `M2_REPORT.md` (this file, repo root).

M3 is not started.

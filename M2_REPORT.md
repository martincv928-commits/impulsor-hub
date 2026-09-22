# Impulsor Hub — Milestone 2 Report

Status: **PASS, HARDENED.** Godot is now the first external validation tool
wired into Impulsor Hub, end to end, with a real repair loop verified against
the real `claude` CLI and real Godot engines — not mocks.
`REAL_GODOT_E2E = VERIFIED` for both Godot 3.5.2 and Godot 4.2.2 (see §6 and
§12 "M2 HARDENING").

**Document structure**: §1-11 and the original "Completion response" below
are the **unmodified original M2 delivery report** (before external audit).
Nothing in that original text was deleted or rewritten. **§12 "M2 HARDENING"**
at the end of this document is what was added afterward in response to the
external audit's two findings (test-suite portability, Godot 4 verification)
— read it for the current, final state of those two points; where it
supersedes a statement made earlier in this document (e.g. §7.1's "not
tested against Godot 4"), §12 says so explicitly rather than silently
overwriting the earlier text.

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

*(End of the original M2 delivery report. Everything below was added during
M2 HARDENING, in response to external audit findings.)*

---

## 12. M2 HARDENING

Triggered by external audit of the M2 delivery ZIP, which surfaced two
concrete, valid findings:

1. Running `python -m pytest tests/ -v` on a machine **without Godot
   installed** produced **83 passed, 8 FAIL** — the 8 failures were all in
   `test_godot_adapter.py` and were caused purely by the absence of a real
   Godot binary, not a real defect. The original M2 report's own "91
   passed, 0 failed" was only true because this development environment
   happened to have `godot3-server` installed; that dependency was never
   made explicit to the test *runner*, only to a human reading the README.
2. `M2_REPORT.md` §7.1 honestly flagged Godot 4 as "implemented but not
   real-world verified" — a real gap, not a documentation shortcut, since
   no Godot 4 package was available through this container's `apt` proxy
   at the time.

Both are now closed. Nothing about the orchestrator, checkpoint/rollback,
content-hash manifest comparison, `ClaudeCodeAdapter`, the repair loop's
control flow, `MAX_REPAIR_ATTEMPTS` (still 2), or the general UI layout was
touched — this work is scoped entirely to the `GodotAdapter`/test-suite
area, as instructed.

### 12.1 Why the suite failed without Godot, and how it was fixed

Every `test_godot_adapter.py` test that calls `GodotAdapter.validate()` or
`.detect()` against reality (not a monkeypatched `subprocess`) needs a real
executable on the machine; there was previously no mechanism to distinguish
"this is a real defect" from "this environment simply doesn't have Godot."
Pytest's `skip` mechanism is exactly built for that second case, and hadn't
been used.

**Fix**: a `real_godot` pytest marker (registered in `pytest.ini`) plus a
`pytest_collection_modifyitems` hook in `tests/conftest.py`:

```python
def pytest_collection_modifyitems(config, items):
    from app.adapters.validator.godot.adapter import GodotAdapter
    if GodotAdapter().detect()["available"]:
        return
    skip_marker = pytest.mark.skip(reason="real Godot executable not available in this environment (SKIPPED, not FAILED)")
    for item in items:
        if "real_godot" in item.keywords:
            item.add_marker(skip_marker)
```

The 8 tests that need a real binary now carry `@pytest.mark.real_godot`;
everything else (including 4 *new* resource-discovery/version-parsing tests
added during this hardening pass, §12.3) is unmarked and always runs.

#### A) Portable unit/integration tests (no Godot required, always run)

These use `monkeypatch` on `subprocess.Popen`/env vars, or don't touch a
binary at all (`supports()` only stats a file; resource-discovery tests
fake `shutil.which`). They validate exactly what the audit asked for:
detection-when-missing, health-check-when-missing, command construction
(the `--path`/`--script`/`--check-only`/`--headless` argument list),
result parsing, the ERROR paths (launch failure, binary missing, non-Godot
project), and the entire repair pipeline (`test_repair_loop.py`, all 13
tests, which were *already* fully portable — they use `FakeValidatorAdapter`
and never touch a real binary).

#### B) Real Godot integration/E2E tests (`@pytest.mark.real_godot`)

Detection-when-present, health-check-when-present, a real PASS, a real FAIL
with a real file/line, a real timeout (simulated subprocess hang, but a
real `detect()` call first), a real launch-failure path, real cancellation
of a real in-flight subprocess, and the real "no scripts = trivial pass"
case. These run automatically whenever Godot is present, and are cleanly
skipped (never failed) when it isn't. `docs/e2e/godot*_scenario/` also
still holds the full real end-to-end evidence (screenshots, raw
events/file-changes JSON) from actually driving the app through the UI —
these were never pytest tests and are untouched by this hardening pass.

#### Commands

```bash
# Portable suite (works with or without Godot installed)
python -m pytest tests/ -v

# Force-select only the real-Godot tests (they still individually skip
# whatever genuinely can't run, e.g. if pointed at a fake path on purpose)
python -m pytest -m real_godot -v
```

#### Verification (this environment, both Godot 3 and Godot 4 installed)

| Scenario | Command | Result |
|---|---|---|
| Godot binaries hidden (simulated clean machine) | `pytest tests/ -v -rs` | **87 passed, 8 skipped**, 0 failed — every skip reason reads `"real Godot executable not available in this environment (SKIPPED, not FAILED)"` |
| Godot binaries hidden | `pytest -m real_godot -v -rs` | **8 skipped**, 87 deselected, 0 failed |
| Both Godot binaries present | `pytest tests/ -v` | **95 passed**, 0 failed, 0 skipped |

This directly answers the audit: the same command (`pytest tests/`) that
used to report 8 FAIL on a Godot-less machine now reports 8 SKIPPED there,
and unchanged full-pass behavior wherever Godot *is* installed.

A genuine, secondary bug was found and fixed while doing this verification:
two of the new resource-discovery tests (§12.3) didn't clear
`IMPULSOR_HUB_GODOT_PATH` from the ambient environment before asserting
PATH-search behavior, so running the suite with that variable deliberately
set (exactly what re-verifying Godot 3 below requires) made them fail on a
false premise — a real test-isolation defect, fixed with an explicit
`monkeypatch.delenv("IMPULSOR_HUB_GODOT_PATH", raising=False)`.

### 12.2 Godot 4: obtained, verified, real

An **official** Godot 4.2.2-stable Linux x86_64 build was downloaded from
`github.com/godotengine/godot`'s own GitHub Releases (the project's
canonical release channel) and its integrity was verified against that
same release's own published `SHA512-SUMS.txt` **before** it was used for
anything:

```
$ sha512sum Godot_v4.2.2-stable_linux.x86_64.zip
4c0294f4...  Godot_v4.2.2-stable_linux.x86_64.zip
$ grep linux.x86_64.zip SHA512-SUMS.txt
4c0294f4...  Godot_v4.2.2-stable_linux.x86_64.zip
```
Hashes matched exactly. `godot4 --version` → `4.2.2.stable.official.15073afe3`.

No unofficial/third-party source was used; no Godot 3 binary was renamed or
disguised as Godot 4 (they are two genuinely distinct installed executables,
`/usr/bin/godot3-server` 3.5.2 and `/usr/local/bin/godot4` 4.2.2, and both
are exercised by name in the resource-discovery tests).

**A real quirk this uncovered**: `godot4 --version` exits `0`, in contrast
to `godot3-server --version`, which — as the original M2 report already
documented — exits `255` even on success. `GodotAdapter.detect()` already
judged success by output shape (`^\d+\.`) rather than exit code specifically
*because* of the Godot 3 quirk found earlier; that same code path turned
out to already be correct for Godot 4 too, needing no change. This is a
second confirmation that judging by output shape rather than exit code was
the right call, not a lucky one-off fix.

#### Godot 4 unit tests

All 18 `test_godot_adapter.py` tests (including the 8 `real_godot` ones)
pass with Godot 4 as the default-selected binary (§12.3). Re-run explicitly:

```
$ pytest tests/test_godot_adapter.py -v      # godot4 preferred by default
18 passed in 0.81s
```

#### Godot 4 real E2E

Two more real scenarios, same method as the original M2 E2E (§6): real
`claude` CLI, real Godot binary (this time 4.2.2), disposable fixture
projects, never MONTARO. Evidence under `docs/e2e/godot4_pass_scenario/`
and `docs/e2e/godot4_repair_scenario/`.

**Scenario C — Godot 4 PASS.** Minimal valid Godot 4 project
(`config_version=5`, `features=["4.2"]`). Objective: *"Add a new function
named multiply(a, b) to main.gd that returns a * b... use modern Godot 4
GDScript syntax."* Claude wrote valid GDScript; `validation.passed` at
184ms; KEEP persisted it; independently re-ran
`godot4 --headless --check-only` against the real file afterward — exit 0.

**Scenario D — Godot 4 real auto-repair.** Same setup, but the objective
explicitly asked for the **classic bare `onready var` keyword** — syntax
Godot 4 genuinely removed in favor of the `@onready` annotation. This was
verified by hand *before* the scenario was run through the app (not
inferred): running `godot4 --headless --check-only --script` against a
file using bare `onready var x = 1` produces the real engine error
`Parse Error: Unexpected 'Identifier' in class body`. This mirrors the
original M2 report's Scenario B methodology exactly (there: asking for
Godot-4-only `@export` on a Godot 3 project), just in the opposite
direction (asking for pre-4.0 `onready` on a Godot 4 project) — a real,
hand-confirmed engine rejection, never a manually constructed
`ValidationResult`.
- **Attempt 0**: Claude used bare `onready var self_ref = self`.
  `validation.failed` at 177ms, the real Godot 4 error text flowed into the
  Repair Context.
- **Repair 1**: Claude's own summary explicitly names the mechanism ("The
  bare 'onready' keyword was removed in Godot 4's GDScript... Used
  '@onready' instead since it is the only Godot-4-valid way..."), rewrote
  it correctly. `validation.passed` at 182ms.
- **Final: VALIDATED**, task COMPLETED.
- **ROLLBACK**, verified against the real filesystem afterward: `main.gd`
  restored to exactly the pre-task committed content, byte for byte,
  reverting both the initial attempt and the repair in one step from the
  original checkpoint only; `git status` showed nothing but the Hub's own
  `.impulsor/` left untracked.

`REAL_GODOT_E2E = VERIFIED` now covers **both** Godot 3.5.2 and Godot 4.2.2
— this explicitly supersedes §7.1's original "not real-world verified"
note and item 1 of the original §7 limitations list (both left as-written
above for the historical record, per instructions not to delete prior
content).

### 12.3 Godot 3 + Godot 4 resource discovery (deterministic)

With both `/usr/bin/godot3-server` (3.5.2) and `/usr/local/bin/godot4`
(4.2.2) installed simultaneously:

- **What gets selected**: Godot 4. `GodotAdapter._resolve_executable()`
  searches a fixed, ordered candidate-name list —
  `["godot4", "godot", "godot3-server", "godot3", "Godot",
  "godot.x11.opt.tools.64"]` — via `shutil.which`, first match wins. Since
  both were on `PATH`, `"godot4"` (checked first) won deterministically.
  Confirmed live: `GodotAdapter().detect()` →
  `{'available': True, 'version': '4.2.2.stable.official.15073afe3',
  'executable_path': '/usr/local/bin/godot4'}`.
- **Why this order**: prefer the explicitly-versioned modern name when
  present, matching the reasonable default expectation that a project
  without other configuration should validate against the newer engine
  generation. It is a fixed, hard-coded preference order — not a smart
  per-project selector — consistent with M2 SPEC section 4's "no
  intelligent router yet" and this task's explicit "no necesitamos
  todavía un selector gráfico sofisticado."
- **Manual override**: `IMPULSOR_HUB_GODOT_PATH` (an executable name
  resolved via `PATH`, or an absolute path) always wins over the
  candidate-name search, regardless of what else is installed — e.g.
  `IMPULSOR_HUB_GODOT_PATH=godot3-server` forces Godot 3 even with Godot 4
  present, which is exactly how Godot 3 was re-verified below. Proven by
  `test_manual_override_wins_over_path_discovery_even_with_both_installed`.
- **What appears in Resources**: whatever `detect()`/`health_check()`
  currently resolve to — with both installed and no override, `GET
  /api/resources` reports the `godot` resource with
  `"version": "4.2.2.stable.official.15073afe3"`. Setting
  `IMPULSOR_HUB_GODOT_PATH` and refreshing resources would show 3.5.2
  instead. No new UI was added for this — Resources already renders
  whatever the API returns generically (unchanged from the original M2
  delivery).
- Determinism, override-still-works, and version-string parsing for both
  major versions are all covered by four new, fully portable tests (no
  real binary needed — they fake `shutil.which`):
  `test_resource_discovery_prefers_godot4_name_when_both_present`,
  `test_resource_discovery_falls_back_to_godot3_when_godot4_name_absent`,
  `test_manual_override_wins_over_path_discovery_even_with_both_installed`,
  `test_major_version_parses_godot3_and_godot4_version_strings`.

### 12.4 Godot 3 re-verified (no regression)

With Godot 4 now installed and preferred by default, Godot 3 support was
explicitly re-confirmed rather than assumed unaffected:

```
$ IMPULSOR_HUB_GODOT_PATH=godot3-server pytest tests/test_godot_adapter.py -v
18 passed in 0.55s
```

All 8 `real_godot` tests (including a real PASS and a real FAIL with a real
parse error) ran against the real `godot3-server` 3.5.2 binary specifically,
forced via the same manual-override mechanism §12.3 describes, and all
passed. The original M2 report's Scenario A/B E2E evidence
(`docs/e2e/godot_pass_scenario/`, `docs/e2e/godot_repair_scenario/`) is
untouched and still valid — nothing about the Godot 3 code path changed
during this hardening pass, so it was not re-run end-to-end through the UI
a third time; the targeted adapter-level re-verification above plus the
unchanged evidence together demonstrate no regression.

### 12.5 Full validation performed for this hardening pass

1. Portable suite, Godot hidden: **87 passed, 8 skipped**, 0 failed (§12.1).
2. Godot 3 real, forced via override, Godot 4 also installed: **18/18
   passed** (§12.4).
3. Godot 4 real, default selection: **18/18 passed** (§12.2).
4. Full suite, both installed: **95 passed**, 0 failed, 0 skipped.
5. Frontend: `npx tsc -b` clean, `npx vite build` clean.
6. Existing E2E evidence (Scenarios A, B) re-confirmed present and
   untouched; two new real E2E scenarios (C, D) run fresh against Godot 4
   (§12.2).

### 12.6 Remaining limitations after hardening

- Godot 4 is now verified with one real build (4.2.2-stable). Different
  Godot 4.x point releases, or the `.NET`/Mono build variant, were not
  separately tested.
- Resource discovery's preference order (`godot4` name checked before
  `godot3-server`) is a fixed default, not configurable except via the
  full `IMPULSOR_HUB_GODOT_PATH` override (i.e. there's no "prefer Godot 3
  by default" setting short of always passing the override) — acceptable
  for M2's explicitly-non-intelligent scope, flagged here in case a future
  milestone wants a per-project pinned engine version instead.
- All other limitations from §7 (original M2) and from `M1_REPORT.md`
  remain unchanged and are not repeated here.

### 12.7 M2 HARDENING — Definition of Done

- [x] Suite estándar funciona sin Godot instalado (87 passed, 8 skipped, 0 failed).
- [x] Ausencia de Godot produce SKIP donde corresponda, no falsos FAIL.
- [x] Tests reales de Godot siguen existiendo (`@pytest.mark.real_godot`, 8 tests).
- [x] Godot 3 continúa funcionando (re-verified explicitly, §12.4).
- [x] Godot 4 real fue probado (official 4.2.2-stable, checksum-verified, §12.2).
- [x] Detección Godot 3/4 es determinista (§12.3, tested).
- [x] Override manual de executable sigue funcionando (§12.3, tested).
- [x] Repair loop sigue funcionando (unchanged; real E2E Scenario D).
- [x] KEEP gating sigue funcionando (unchanged; real E2E Scenario C KEEP).
- [x] ROLLBACK sigue funcionando (real E2E Scenarios C/D rollback verified).
- [x] Los tests M1 siguen pasando (64/64, part of the 95).
- [x] Frontend compila (`tsc -b` + `vite build` clean).
- [x] M2_REPORT.md actualizado (this section).
- [x] M3 NO iniciado.

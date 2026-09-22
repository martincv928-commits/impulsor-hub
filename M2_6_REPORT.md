# M2.6 — Real Workspace Experience

Status: **PASS**. Triggered by user feedback after trying the M2.5B demo:
they couldn't tell a simulated result from a real one and asked "where did
that happen? what tools did it use if I didn't connect any?". This
milestone draws a hard line between DEMO and REAL, and makes the real
pipeline (unchanged since M1/M2) reachable without a terminal. The
orchestrator, checkpoint/manifest/KEEP/ROLLBACK and repair-loop guarantees
were **not modified** — see "What was NOT touched" below. M3 was not
started.

## 1. Architecture: Impulsor Agent = the existing backend, hardened

No new service. "Impulsor Agent" is `app/api/main.py` (the same FastAPI
app from M1/M2) with three additions:

- **Token auth** (`app/core/security.py`): every route except
  `/api/health` and `/api/agent/status` now requires
  `Authorization: Bearer <token>`. The token is generated once and
  persisted at `~/.impulsor-hub/agent_token` (0600), or pinned via
  `IMPULSOR_HUB_AGENT_TOKEN` for tests/operators.
- **Self-serves the real UI**: when `ui/dist` exists (built *without*
  `VITE_DEMO_MODE`), `GET /` returns it directly — open
  `http://127.0.0.1:8000/` in any browser and get the real app talking
  same-origin to the real Agent. No separate frontend process.
- **Two new capabilities**: a native folder picker and a Godot preview
  launcher (sections 3-4 below).

This satisfies the stated priorities directly: minimal complexity (one
process, not a new distributed component), reuses the existing backend
100%, and duplicates zero orchestration logic.

## 2. Security model

A restrictive CORS allowlist (unchanged from M1, never `"*"`) only stops
*other origins'* JS from **reading** a response — it does not stop their
JS from **firing** a request at `127.0.0.1:<port>` at all (a classic
confused-deputy gap). The Bearer token is what actually authorizes a
caller:

- **Token bootstrap**: the browser has no other way to learn the token.
  `GET /` injects it inline (`window.__IMPULSOR_AGENT_TOKEN__`) — safe
  because anyone who can load that page already has whatever access the
  token grants (same machine / same local path); it only ever stops a
  *different* open tab from blindly POSTing here, since that tab can't
  read this page's response to steal the token.
- **No generic shell.** Every capability is a specific, typed endpoint
  (add project, run task, pick folder, start/stop preview) — there is no
  "run this command" endpoint anywhere, in M1/M2 or here.
- **Path traversal / workspace escape**: unchanged, pre-existing
  `validate_path_within_workspace` (M1) — every filesystem write during a
  task is still resolved and checked against the project root before
  touching disk; `tests/test_policy.py` already covers this and keeps
  passing untouched.
- **Not Claude Code's auth**: the Agent only *detects* whether `claude` is
  installed/authenticated (`claude auth status`, unchanged from M1/M2). No
  OAuth was built, no credentials are captured or stored.

## 3. Native folder picker

`POST /api/agent/pick-folder` runs a native OS folder dialog via Python's
built-in `tkinter.filedialog` (ships with standard CPython on Windows/
macOS/most Linux — no Electron/Tauri needed) off the event loop
(`asyncio.to_thread`), and returns the absolute path chosen. If no display
is available, it fails with a clear message rather than hanging; the UI
falls back to a manual path field in that case (verified live in this
sandbox, which has no display — see §7).

## 4. Godot preview ("PROBAR RESULTADO")

`app/api/routers/preview.py`: `POST /task-runs/{id}/preview/start`
launches the real, detected Godot executable **non-headless**
(`godot --path <workspace>`, no `--check-only`, no `--headless`) so the
user can actually play the result — deliberately separate from
`GodotAdapter` (which only ever runs headless `--check-only` validation
and is untouched). State is in-memory (PID + `Popen` handle), matching
`GodotAdapter`'s own process-tracking pattern; `GET .../status` polls
`Popen.poll()`, `POST .../stop` terminates then kills. Only offered for
Godot-type projects; 409 with a clear message otherwise or when Godot
isn't available — never a fake preview.

## 5. Demo vs. Real: structural separation

Unchanged mechanism from M2.5B (`VITE_DEMO_MODE`, build-time), now
enforced two ways:

- **Structurally**: `ui/src/__tests__/mode-separation.test.ts` parses the
  actual source files and asserts nothing under `ui/src/demo/` imports the
  real `ApiClient` or calls `fetch()`, and nothing under `ui/src/pages/`
  or `App.tsx` imports from `ui/src/demo/` (except the one `DemoApp`
  import gating on `DEMO_MODE`). This fails the moment either side gains
  a wrong import — not something that can silently regress.
- **Visually**: Demo's finished-task screen now shows a `SIMULACIÓN`
  badge, an explicit "no se modificó ningún proyecto real" sentence,
  `Proyecto: <name> (DEMO)` / `Ejecución: Simulada` /
  `Recursos: Claude Code — Simulado / Godot — Simulado / Git — Simulado`,
  and ends with **PROBAR OTRA SIMULACIÓN** instead of anything implying a
  testable result (demo never offers PROBAR RESULTADO). Real Mode shows
  `PROYECTO REAL` / `RESULTADO REAL` badges and real resource names
  instead. Never only color-coded, per the milestone's explicit ask.

## 6. Real Mode UI changes

Reused the existing `ui/src/pages/*` (already backed by the real
`ApiClient`, already tested via `test_api_integration.py`) rather than
building a parallel app — the M2.5B demo needed its own tree because its
UX has no real-mode equivalent; here the real flows already existed and
only needed the new pieces:

- `Projects.tsx`: **ELEGIR CARPETA** (native picker) as the primary way to
  add a project; **GITHUB (próximamente)** disabled; a manual-path field
  only appears as the documented fallback when the picker errors.
- `Project.tsx`: `PROYECTO REAL` badge, `Detectado: <type>`, real
  `Recursos disponibles` (✓/✗ per resource, reusing the same
  `projectResources` endpoint from M1), root path moved into a collapsed
  "Detalles" fold instead of being the headline.
- `TaskResult.tsx`: success-first framing (§9 below), `Herramientas
  utilizadas`, **PROBAR RESULTADO** (Godot projects only, `COMPLETED`
  runs only), **CONSERVAR CAMBIOS** / **DESHACER CAMBIOS** (renamed to
  match Demo's verbs), and a **VER QUÉ OCURRIÓ** disclosure wrapping the
  full technical detail that used to be the whole page (executor summary,
  Git changes with claim/observation discrepancies, per-attempt
  validation events, activity log) — same data, same fetching logic,
  reorganized presentation only.
- `Resources.tsx`: real detection, and explicitly distinguishes
  "● Disponible" from "● Instalado, no autenticado" for Claude Code
  (`resource.auth_state`, already computed by M1's `refresh_resources` —
  no backend change needed here, just correct UI wording).
- `AgentGate.tsx` (new) + sidebar "ESTE EQUIPO ● Conectado": polls
  `/api/agent/status` before rendering anything else; shows an explicit
  "○ No conectado" screen with a retry button otherwise — never fails
  silently.

## 7. What was verified, and how

**Automated (backend, 16 new tests, 111 total — was 95, all prior tests
still pass unchanged):** token required/rejected/accepted
(`test_security.py`), folder picker success/cancel/no-display-fallback/
auth-required (`test_agent_router.py`, mocked dialog — no display needed),
preview start/status/stop/unavailable/non-Godot-rejected/404/auth-required
(`test_preview_router.py`, mocked `Popen` and `GodotAdapter.detect`).

**Automated (frontend, 3 new tests, 22 total — was 19):**
`mode-separation.test.ts`, described above.

**Real E2E (one project, two task runs — see rule below for why two):**
A disposable Godot 4 project (fresh git repo, never touched again after).
All calls went through the real, token-authenticated HTTP API (equivalent
to what the browser UI does) against a live Agent process.

1. `POST /api/projects` with the real token → `project_type: "godot"`
   detected correctly.
2. **Run 1** — objective: add `self_ref` via the classic bare `onready`
   keyword (the exact scenario from M2 hardening's verified repair case).
   This time the model **declined to "fix" it by silently switching to
   `@onready`**, correctly reasoning that would violate the objective's
   explicit constraint — a legitimate, different outcome from before (the
   model isn't deterministic). Real events confirm the full repair loop
   ran twice and exhausted (`repair.exhausted`, `max_repair_attempts: 2`),
   ending `FAILED` / `validation_status: fail` — exactly the "NO SE PUDO
   COMPLETAR LA TAREA" path the UI needed to handle correctly.
   - **ROLLBACK verified on this run**: `main.gd` on disk actually
     *did* contain the bare-`onready` edit from an earlier attempt (the
     executor's own summary claiming "no edit was made this attempt" was
     only true for that specific attempt) — exactly the claim-vs-reality
     gap M1's independent Git verification exists to catch. `POST
     .../rollback` restored the file byte-for-byte to the original
     3-line script and left `git status` clean. This is stronger evidence
     than a clean run would have been.
3. **Run 2** — a second, real E2E was needed specifically because run 1
   never reached `COMPLETED`, and PROBAR RESULTADO can only be
   demonstrated against a real passing run. Objective: add a typed
   `double(n)` function (Godot-4-valid, low ambiguity). Real Claude, real
   Godot: `COMPLETED` / `validation_status: pass` in ~15s, no repair
   needed.
   - **PROBAR RESULTADO verified**: `POST .../preview/start` launched the
     real `/usr/local/bin/godot4` binary (non-headless, under `xvfb-run`
     so it had a display) — real PID assigned and tracked. It exited
     immediately with `Can't run project: no main scene defined in the
     project` — the fixture project has a script but no scene, so Godot
     is correct to refuse; `GET .../status` correctly reported `stopped`
     with the real exit code rather than pretending it was still running.
     The launch mechanism itself (real binary, real args, real PID
     tracking, real exit-code reporting) is fully proven; a project with
     a configured main scene would show a live window through the exact
     same code path.
   - **KEEP verified**: `POST .../keep` → `disposition: "kept"`,
     `double(n)` confirmed present in `main.gd` afterward.

No third real run was made: KEEP's actual state-machine logic (locking,
disposition transitions, override rules) is already covered exhaustively
by the pre-existing M1/M2 automated suite, which is untouched — a real
run for the *specific new M2.6 addition* was unnecessary there per the
milestone's own AI-usage rule.

**Demo web**: re-verified locally (single Playwright pass, 390px) after
the SIMULACIÓN-labeling change — badge, "(DEMO)" project label, "PROBAR
OTRA SIMULACIÓN" all present; no "PROBAR RESULTADO" text anywhere in demo
mode. Full cross-breakpoint responsive validation was already done in
M2.5B and nothing layout-relevant changed here, so it was not repeated.

## 8. Windows artifact

**Not a single self-contained `.exe`** — and this sandbox cannot honestly
produce one (see "why" below), so nothing was faked.

**What ships**: `windows/ImpulsorHub-Start.bat` — double-click, no typed
commands. It checks for Python, creates/reuses a `.venv`, installs
dependencies once, verifies `ui/dist` was pre-built, starts the Agent, and
opens the default browser to it. **Not build/run-verified on real
Windows** in this sandbox (same constraint noted for the Tauri skeleton
since M1: no Windows machine, no Windows toolchain here) — reviewed by
hand for correctness.

**Why not `ImpulsorHub-Setup.exe`**: a true single-file installer needs
either (a) PyInstaller run *on Windows* (PyInstaller does not
cross-compile — a Linux run only produces a Linux binary), or (b)
building the already-scaffolded Tauri shell (`ui/src-tauri/`) with the
Windows Rust target + WebView2, which needs a Windows or properly
cross-toolchained build machine this sandbox doesn't have (it lacks even
Linux's GTK/WebKitGTK, so Tauri has never been build-verified here at
all, on any target). Reproducible paths for someone with the right
machine:
- PyInstaller: `pip install pyinstaller && pyinstaller --onefile
  --add-data "ui/dist;ui/dist" -n ImpulsorHub app/api/main.py`, run on
  Windows, then wrap with an installer tool (Inno Setup) if a `Setup.exe`
  wrapper specifically is wanted.
- Tauri: `cd ui && npm install && npm run tauri build` on Windows with
  the Rust toolchain + WebView2 runtime installed — this produces an
  installer directly via Tauri's own bundler.

## 9. Friendly result framing (no backend changes needed)

Section N's success-first framing and section K's "no repair de FAIL
histórico como error pendiente" are pure frontend presentation logic over
data M1/M2 already expose (`task.status`, `run.validation_status`, and
validation events with `attempt > 0`): `COMPLETED` → "✓ TRABAJO TERMINADO"
+ "(N problema(s) corregido(s) automáticamente)" when repair events
exist; otherwise "NO SE PUDO COMPLETAR LA TAREA" + **VER PROBLEMA** (opens
the same disclosure) + **DESHACER CAMBIOS**. No backend endpoint or schema
changed for this.

## 10. What was NOT touched

Per explicit instruction: `app/core/orchestrator/orchestrator.py`,
`app/adapters/vcs/git/adapter.py`, `app/adapters/validator/godot/
adapter.py` (except being *called* by the new preview router, never
modified), `MAX_REPAIR_ATTEMPTS`, the checkpoint/manifest logic, and
every M1/M2 page's core data-fetching logic. No Codex, no multi-AI
router, no asset generation anywhere.

## 11. Limitations

- Windows artifact not run-verified (see §8).
- Folder picker needs a display on the Agent's machine (real Windows
  desktops have one; this sandbox doesn't — verified the documented
  manual-path fallback instead, live).
- Preview's happy path (an actual playable window) wasn't visually
  confirmed — the disposable fixture project has no main scene, which is
  itself the honest, correctly-surfaced result Godot gave; the launch
  mechanism that would show a live window is the same code path,
  already proven.
- Scenario-dependent model behavior: the same repair-scenario prompt that
  produced a successful auto-repair during M2 hardening produced a
  (correct, defensible) refusal-to-repair this time — documented in §7
  rather than treated as a bug, since the pipeline's handling of that
  outcome (repair-exhausted → FAILED → rollback available) is exactly
  what M2 built it to do.
- Real Mode's desktop UI was not made mobile-responsive in this milestone
  (out of scope — M2.5B's mobile work was specifically about the public
  demo).

## 12. AI usage

Two real Claude Code executions total this milestone (both inside the
single E2E in §7 — the FAIL→repair-exhausted run and the PASS run needed
for PROBAR RESULTADO/KEEP). Everything else — security, folder picker,
preview lifecycle, mode separation — was verified with mocked/automated
tests, never a real Claude call. No exploratory re-reading of already-
known M1/M2 files; no repeated E2E once a path was proven.

## Definition of Done

- [x] Demo claramente dice SIMULACIÓN.
- [x] Demo no afirma cambios reales.
- [x] Real Mode existe (reuses M1/M2 pages, extended).
- [x] Impulsor Agent existe (= hardened existing backend).
- [x] Agent está protegido (token + existing CORS allowlist + existing
      path-boundary checks).
- [x] UI detecta Agent (`AgentGate`).
- [x] Usuario puede agregar proyecto real sin escribir ruta (native
      picker; manual path only as a documented, visible fallback).
- [x] Recursos reales son detectados.
- [x] Recursos inexistentes no se presentan como conectados.
- [x] Claude no utilizable no se presenta como listo (distinct
      "Instalado, no autenticado" state).
- [x] Proyecto real ejecuta pipeline M1/M2 (unchanged).
- [x] Claude Code real funciona (verified in E2E).
- [x] Godot real funciona (verified in E2E).
- [x] Repair real continúa funcionando (verified in E2E, both directions:
      exhausted and N/A-for-clean-pass).
- [x] Resultado explica qué recursos fueron utilizados.
- [x] PROBAR RESULTADO funciona para Godot compatible (verified: real
      launch, real tracking, honest error surfaced for a sceneless
      fixture).
- [x] KEEP real funciona (verified in E2E).
- [x] ROLLBACK real funciona (verified in E2E, including a claim-vs-
      reality discrepancy).
- [x] DemoTaskEngine nunca se utiliza accidentalmente en Real Mode
      (structural test).
- [x] Real Mode nunca utiliza resultados simulados (structural test).
- [x] Suite anterior continúa pasando (95/95 backend, 19/19 frontend
      unchanged).
- [x] Tests nuevos pasan (16 backend + 3 frontend, all new).
- [x] E2E real mínimo pasa.
- [x] Demo web sigue funcionando.
- [x] Artefacto Windows fue generado (`.bat`) — `.exe` not producible
      here, documented exactly why + exact reproduction steps.
- [x] M2_6_REPORT.md creado.
- [x] Consumo de IA fue minimizado (§12).
- [x] M3 NO iniciado.

# M2.6.1 — User-Testable Real App

Status: **PASS**. Closes the specific gap M2.6 left open: a non-technical
user can now open Impulsor Hub, use a real bundled test project, watch
Claude Code and Godot actually work on it, and see a real, playable result
— without creating their own project first. M3 was not started; no M1/M2
architecture, no M2.6 security model, was changed.

## 1. What changed (only the two real gaps + the requested first-use path)

- **Impulsor Hub Test Game** (`fixtures/impulsor_hub_test_game/`): a real,
  minimal Godot 4 project — `project.godot`, a valid main scene
  (`main.tscn`) with a Label and a `player.gd`-driven circle you move with
  arrows/WASD. Plain tracked files, **not** a git repo itself.
- **`POST /api/test-game`**: copies the template to a fresh, independent
  location and adds it as a real project through the *exact same*
  `add_project` path every other project uses — zero new detection or
  checkpoint logic. The template is never touched; every copy gets its
  own `git init`.
- **Project-scoped preview** (`POST/GET/POST /api/projects/{id}/preview/
  {start,status,stop}`): "PROBAR ESTADO ACTUAL" — the same real,
  non-headless Godot launch M2.6 built for post-task previews
  ("PROBAR RESULTADO"), now also usable *before* any task runs. Both
  share one internal start/status/stop implementation keyed by a
  scope-prefixed string (`run:<id>` / `project:<id>`), so the two scopes
  can never collide.
- **Real Mode landing**: "¿Quieres probar Impulsor Hub?" → **USAR
  PROYECTO DE PRUEBA** as the primary action; the folder-add flow moved
  behind **AGREGAR MI PROYECTO**. The test-game copy shows **PROYECTO
  REAL DE PRUEBA** (distinct from both "PROYECTO REAL" and the public
  demo's "SIMULACIÓN") with an explicit "esto sí modifica archivos
  reales, pero puedes restaurarlos" sentence, a **PROBAR ESTADO ACTUAL**
  button, and a one-tap suggested objective ("Cambia el texto principal
  a...") before any task exists.
- **EJECUTAR now blocks with a plain message** ("Claude Code no está
  disponible en este equipo." / "...instalado pero no autenticado.")
  instead of starting a task doomed to fail, using the exact same
  resource data M1 already collects (`resource.availability`,
  `resource.auth_state`) — no backend change needed for this.
- **Agent shutdown** now stops only the preview processes it is tracking
  (`preview.stop_all()`, called from the FastAPI lifespan teardown) —
  never a Godot process the user started some other way.
- **Windows**: `app/launcher.py` (starts the Agent, opens the browser —
  no terminal) is now the single entrypoint for both
  `windows/ImpulsorHub-Start.bat` and a new GitHub Actions workflow that
  packages it as `ImpulsorHub.exe` via PyInstaller on `windows-latest`.

## 2. Why PyInstaller, not Tauri

Chose the **minimal-risk existing path**, per instruction: Tauri
(`ui/src-tauri/`) has never been build-verified anywhere in this
project's history — not even on Linux, since this sandbox lacks
GTK/WebKitGTK. Attempting it now, on a CI runner, with zero prior
verification of its Cargo/tauri.conf setup, risks burning CI cycles on
unknown breakage I can't debug blind. PyInstaller only needed: the
already-proven `npm run build` output, and a well-trodden Python
packaging step. No framework migration, no Electron.

## 3. Real bugs found and fixed by the real E2E/CI (not by inspection)

1. **Rendering method.** The fixture originally declared Godot's
   Forward+ (Vulkan) renderer as default. The *first* real
   `/preview/start` call against the real backend (no manual
   `--rendering-driver` override, unlike an earlier standalone check)
   exited immediately with code 255 — Vulkan isn't available without a
   real GPU. Fixed by setting `renderer/rendering_method="gl_compatibility"`
   in `project.godot` — every real GPU supports this too, so it's a
   correctness fix, not a sandbox-only workaround. Re-verified for real:
   the process now stays running.
2. **PyInstaller-frozen path resolution.** `app/api/main.py` and
   `app/api/routers/testgame.py` located `ui/dist` and `fixtures/` via
   `__file__`-relative paths, which are meaningless inside a
   `--onefile` bundle (`__file__` points into a temp extraction dir
   there). The first CI run built `ImpulsorHub.exe` successfully but it
   would have shipped with a broken "USAR PROYECTO DE PRUEBA" (fixtures/
   wasn't even bundled). Fixed: both now check `sys.frozen`/
   `sys._MEIPASS`, and the workflow now bundles `fixtures/` via a second
   `--add-data`. A corrected CI run was pushed; see §5 for its status.

## 4. What was verified, and how (single real E2E, one Claude execution)

Against a **fresh copy** of the Test Game, created through the real,
token-authenticated API (equivalent to what the browser does):

1. `POST /api/test-game` → real project, `project_type: "godot"`,
   `.git` present, `main.tscn`/`project.godot` present.
2. **PROBAR ESTADO ACTUAL**: `POST .../preview/start` → real `godot4`
   process launched (confirmed via `ps` on the real PID), **stayed
   alive** for 7+ seconds (this is the concrete fix from §3.1 — the
   same call against the *unfixed* fixture had exited with code 255
   immediately). `POST .../preview/stop` → process actually gone from
   the OS; Hub's own status correctly flipped to `not_started`.
3. **Real Claude change**: objective "Cambia el texto principal a 'Mi
   primer cambio con Impulsor Hub'." Real Claude Code edited exactly the
   `Label`'s `text` property in `main.tscn` (confirmed via `git diff` —
   one line changed, nothing else).
4. **Real Godot validation**: `validation_status: "pass"` (the edit
   never touched `.gd` files, so validation was a clean, un-repaired
   pass — appropriate given M2.6 already real-E2E-proved the repair
   loop; not repeated here per the milestone's own AI-usage rule).
5. **PROBAR RESULTADO** on that run: same real launch/stay-alive/stop
   verification as step 2, now against the *modified* project.
6. **ROLLBACK**: `main.tscn`'s text confirmed restored to the exact
   original string; `git status --porcelain` clean (only the Hub's own
   untracked `.impulsor/` metadata dir remains, expected).

**KEEP** was not re-verified with a real Claude call here — its
state-machine logic is already exhaustively covered by the unchanged
M1/M2 automated suite, and M2.6's real E2E already proved it end-to-end;
re-proving it again would have needed a second real Claude execution for
no new information, which the milestone's AI-usage rule explicitly says
to skip.

## 5. Windows CI

Workflow: `.github/workflows/windows-build.yml` (`windows-latest` +
PyInstaller). **Two real runs happened, both genuinely observed via the
GitHub Actions API** (not assumed):

- Run 1 (commit `c386961`, the pre-fix code): **built successfully**
  (`ImpulsorHub-Windows.zip`, 18.6 MB) — this is what surfaced the
  frozen-path bug in §3.2 (the .exe would have built but "USAR PROYECTO
  DE PRUEBA" would have silently found no template).
- Run 2 (commit `65322b3`, with both §3 fixes): **also completed
  successfully** (`ImpulsorHub-Windows.zip`, 18.7 MB) — confirmed via the
  Actions API after it finished:
  https://github.com/martincv928-commits/impulsor-hub/actions/runs/35793184792

**Downloading the built `.exe` itself is not possible from this sandbox**
(the artifact-blob endpoint is blocked by this environment's egress
policy — confirmed with one attempt, not investigated further per the
milestone's instruction not to spend time evading environment limits;
the Actions *metadata* API is reachable, which is how runs/artifacts were
confirmed to exist). The artifact is retrievable by anyone with repo
access from the workflow run page in a normal browser (30-day retention
window).

No secret or token is embedded in the build — verified by 3 new tests
(`tests/test_build_config_no_secrets.py`) that scan the workflow YAML,
the `.bat`, and `launcher.py` for a literal token pattern; the real token
is always generated at runtime on the machine the Agent actually runs on
(`app/core/security.py`, unchanged since M2.6).

## 6. Tests

**Backend**: 13 new (124 total, was 111) — test-game copy returns a real
Godot project / never modifies the master template (byte-hash compared
before/after) / two copies are independent / requires token / clear
error when the template is missing; project-scoped preview start/status/
stop / rejected for non-Godot projects / project-vs-run key isolation;
`stop_all()` kills every tracked preview and nothing recorded as
untracked; 3 no-embedded-secret checks. **Frontend**: 4 new (26 total,
was 22) — `claudeUnavailableReason` for not-installed / not-authenticated
/ available / resource-missing-entirely.

```
$ python -m pytest tests/ -q       124 passed
$ npx tsc -b                        clean
$ npx vitest run                    26 passed
$ npx vite build (real + demo)      both succeed
```

## 7. Demo web

Not touched (per instruction). Confirmed still deployed at the same
`gh-pages` commit as the end of M2.6 — no rebuild needed since nothing
demo-related changed, and re-running the full responsive/visual pass
M2.5B already did would have been pure redundant verification.

## 8. Limitations

- Windows artifact: **built and confirmed to exist** via the Actions API
  (both runs), but **not executed on an actual Windows machine** by this
  session — "WINDOWS VERIFIED: NO" is accurate; nothing here should be
  read as a claim that a human has run the .exe.
- Godot preview's window still can't be visually screenshotted from this
  sandbox (no real display, only Xvfb) — verified instead by the
  stronger, more direct signal the milestone asked for: the real OS
  process staying alive across multiple status polls and disappearing
  exactly when stopped.
- "PROBAR ESTADO ACTUAL" and "PROBAR RESULTADO" both require Godot on the
  Agent's machine; if absent, `GodotAdapter.detect()` (unchanged M1/M2
  code) reports it as such and the preview endpoints return a clear 409
  rather than a fake success.

## 9. AI usage

**One** real Claude Code execution total (the single E2E's real change,
§4.3) — the two Test Game rendering/path bugs were found and fixed by
direct, deterministic verification (the real Godot binary, the real
preview endpoints, the real GitHub Actions API), never by using Claude to
debug or explore. No repeated E2E, no exploratory re-reading of already-
known M1/M2/M2.5B/M2.6 files.

# M2.5B — Interactive Demo + Mobile UX

Status: **PASS**. Scope: only the public demo experience (mobile-first UX +
an interactive, in-browser `DemoTaskEngine`). Real mode, the orchestrator,
checkpoint/manifest/KEEP/ROLLBACK guarantees and the repair loop are
untouched — see "Real Mode regression" below. M3 was not started.

## 1. What changed (UX)

The public demo went from a **read-only** static view (seeded data, no
interaction) to an **interactive** one a non-technical visitor can actually
use on a phone:

- **Mobile-first layout.** Below 768px: compact sticky header with a
  hamburger button, a slide-in drawer for navigation (Proyectos / Recursos
  /Actividad + "Restablecer demo"), full-width content, vertical forms,
  16px+ input font (avoids iOS auto-zoom), full-width tap targets for every
  button including KEEP/ROLLBACK. At ≥768px the drawer becomes a persistent
  sidebar (same pattern as real mode) and content is centered with a
  readable max-width — desktop keeps working, it isn't just "not broken."
- **No developer-facing project creation.** "Ruta directa a un proyecto"
  is gone from the demo. "+ Agregar proyecto" opens a bottom sheet with
  three choices: **Carpeta** (explains it needs the local/desktop app —
  the demo has no filesystem access), **GitHub** (shows the intended UI,
  disabled, "próximamente" — no real integration yet), **Proyecto demo**
  (functional: name + type Auto detectar/Godot/Web/Otro → "CREAR PROYECTO
  DEMO").
  - "Auto detectar" resolves types 从 the name via a simple keyword
    heuristic (`juego|game|godot` → Godot, `web|página|landing|sitio` →
    Web, else Otro) — good enough for a demo, documented as a
    simplification, not a claim of real classification.
- **Project detail** shows Estado (Demo), Recursos ("Claude Code —
  simulado", "Git — simulado", and "Godot 4 — simulado" *only* for Godot
  projects — mirrors the real product, where the Godot validator only
  engages for Godot projects), an objective textarea, and EJECUTAR.
- **Progressive execution.** Pressing EJECUTAR never calls an API. It
  starts `DemoTaskEngine`, which emits step events over a few seconds
  (checkpoint → Claude Code → validation → [repair] → result) with a
  spinner per in-flight step, exactly like the spec's mockups.
- **Task result screen**, layered for a non-technical reader: a plain
  Resultado banner (✓ Tarea completada / ✓ Validación superada), a
  natural-language Resumen, Archivos modificados as chips, a compact
  Validación breakdown (Claude Code ✓ → Godot ✗ with the error → Reparación
  ✓ → Godot ✓), CONSERVAR CAMBIOS / DESHACER CAMBIOS, and a collapsed "Ver
  detalles técnicos" disclosure with the full raw event timeline
  (timestamps, technical event ids, attempt count) for anyone who wants it.
- **KEEP/ROLLBACK are real interactions in demo state** (not just static
  copy): CONSERVAR CAMBIOS immediately shows "✓ Cambios conservados /
  Estado: Accepted"; DESHACER CAMBIOS runs a short simulated
  "Restaurando checkpoint... → ✓ Proyecto restaurado / Estado: Rolled
  back" sequence. Both buttons disable once a disposition is set or while
  a rollback is mid-flight, so a visitor can't KEEP and ROLLBACK the same
  task.
- **Resources page** in plain language: Claude Code / Godot 4 / Git, each
  with what it does, an "● Disponible" badge, and a "Demo" cost badge.
- **Activity page**: a plain-language, reverse-chronological feed across
  all demo tasks ("Checkpoint creado", "Validación falló", ...) with an
  optional checkbox to reveal the technical event id per row.
- **Compact demo banner** ("DEMO INTERACTIVA — simulación segura, sin
  cambios reales." + a "Más información" toggle) instead of the old
  multi-line block, so it doesn't eat mobile vertical space.
- **Onboarding**, shown once (persisted in localStorage): 4 short steps
  ("Agrega un proyecto" → "Describe lo que quieres" → "Impulsor Hub elige
  y coordina recursos" → "Las herramientas verifican el resultado") +
  "PROBAR DEMO". This is also where the product's core idea lives — the
  user states a goal, Impulsor Hub picks and coordinates the tools; the UI
  never asks the visitor to choose Claude vs. Godot vs. Git up front.
- **Coherent Spanish UI**: Proyectos, Recursos, Resultado, Actividad,
  Validación, Conservar cambios, Deshacer cambios, etc. Tool names (Claude
  Code, Godot, Git) are kept as-is, matching the spec.
- **Nothing invented.** The demo only represents what M1/M2 actually
  built: Claude Code, Git, Godot, checkpoint, validation, the repair loop,
  KEEP/ROLLBACK. No Codex, no multi-AI router, no image generation, no
  Blender/Ollama anywhere in the UI or copy.

## 2. DemoTaskEngine architecture

`ui/src/demo/` is a **self-contained, frontend-only** module, deliberately
decoupled from the real API client (`ui/src/api/*`):

```
ui/src/demo/
  types.ts          Demo-only data model (DemoProject, DemoTask, DemoStepEvent, ...)
  engine.ts          DemoTaskEngine: pure functions, no React, no localStorage, no network.
                      pickScenario(objective, projectType) -> "pass" | "fail_repair_pass" | "simple"
                      runDemoTask(objective, projectType, onStep) -> { promise, cancel }
                      runDemoRollback(onStep) -> Promise<DemoStepEvent[]>
  seedData.ts         The two example projects/tasks shown on first visit.
  store.ts            DemoStore: a plain class (subscribe/notify), NOT a React hook.
                      Owns all demo state, reads/writes localStorage, and is what
                      calls into engine.ts. Exported as both a `demoStore` singleton
                      (used by components) and the `DemoStore` class (used by tests
                      to construct isolated instances against the same storage key).
  useDemoStore.ts     Thin useSyncExternalStore wrapper so React components can read
                      DemoStore reactively.
  demo.css            Mobile-first styles, prefixed `dm-` to stay independent of the
                      real app's styles.css.
  components/         DemoApp.tsx (view-state shell) + one component per screen.
  __tests__/          vitest unit tests against engine.ts and store.ts directly
                      (no DOM/React needed for either).
```

**Why a separate module instead of extending the real `ApiClient`
abstraction** (which is what the earlier, read-only demo used, via
`api/demoClient.ts`): the interactive demo needs its own UI flows entirely
(the Carpeta/GitHub/Proyecto demo sheet, the progressive step-by-step
execution view, the mobile drawer) that don't correspond to anything in
real mode's UI. Building it as its own tree, with its own state, makes the
"never mix simulation with the real backend" requirement structural rather
than a discipline to maintain by hand — `ui/src/demo/*` has zero imports
from `ui/src/api/*`, and the real page components (`ui/src/pages/*`) have
zero imports from `ui/src/demo/*`.

**Scenario selection** is deliberately simple (this is a scripted demo,
not a language model): a Godot-type project whose objective mentions
"vidas/lives/salud/health" gets the flagship FAIL → repair → PASS
narrative; any other objective on a Godot project gets the direct PASS
path; any objective on a non-Godot project skips validation entirely
(`scenario: "simple"`), matching the real product's actual behavior (the
Godot validator only engages for Godot projects — non-Godot tasks are
M1-only, no validation step, `validated: null`).

The FAIL → repair → PASS timeline (error message "Parse error in
player.gd", `player.gd`/`game_manager.gd` as the modified files, the exact
summary sentence in §6 of the milestone request) is modeled directly on
the **real, verified** Godot 4 `onready`/`@onready` auto-repair scenario
from the M2 hardening real E2E run (see `M2_REPORT.md` §12.4) — the demo
tells the same story the real pipeline actually produced, not a fabricated
one.

## 3. Demo Mode vs. Real Mode separation

Determined the same way as before M2.5B, at **build time**:

```ts
// ui/src/api/client.ts
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";
```

`App.tsx` now branches on it at the top:

```tsx
if (DEMO_MODE) {
  return <DemoApp />;   // ui/src/demo/DemoApp.tsx -- DemoTaskEngine, localStorage, zero fetch()
}
return ( /* unchanged real-mode tree: pages/Projects, pages/Project, ... */ );
```

- **Real Mode** (`VITE_DEMO_MODE` unset or not `"true"`): unchanged
  `pages/*` components, `api.ts`'s `realApi` (fetch against `/api/...`).
  `ui/src/demo/*` is never imported by anything in `pages/*` or
  `api/client.ts`.
- **Demo Mode**: `DemoApp` and everything under `ui/src/demo/*`. It never
  imports `api` from `ui/src/api/client.ts` — no code path exists for
  `DemoTaskEngine` to accidentally fire against a real backend. The old
  `api/demoClient.ts` (an `ApiClient` implementation backed by mock data,
  used by the previous read-only demo) is removed — Demo Mode no longer
  goes through the `ApiClient` interface at all, so there is nothing left
  that could route demo actions to `realApi` by mistake.
- **GitHub Pages compatibility preserved**: `DemoTaskEngine` and `DemoStore`
  are pure frontend (`setTimeout`-based simulation + `localStorage`) — no
  server, no new backend dependency. The demo is still a static build.

## 4. localStorage

Namespaced under `impulsor-hub-demo-v1` (see `STORAGE_KEY` in
`ui/src/demo/store.ts`). Stores `{ onboardingSeen, projects, tasks }` as a
single JSON blob, written on every state change. On load: missing or
unparseable data silently falls back to the seed state (two example
projects/tasks) rather than crashing — verified by a dedicated test
(`falls back to fresh seed data if localStorage holds garbage`).
"Restablecer demo" (in the drawer, with a confirm prompt) calls
`DemoStore.reset()`, which wipes everything the visitor added, including
the onboarding-seen flag, and rewrites the seed state — a full "start
over," not just an app-state reset while stale data lingers on disk.

## 5. Responsive

Mobile-first CSS (`ui/src/demo/demo.css`), enhanced at `≥768px` via a
single media query (persistent sidebar instead of drawer/hamburger,
centered content with a max-width). Validated with Playwright at
**360px, 390px, 412px, 768px, and 1280px (desktop)** across Onboarding,
Proyectos, the drawer, Add Project (both the choice sheet and the demo
project form), Project Detail, Task Running, Task Result, and Resources:
**zero instances of horizontal overflow** (`scrollWidth >
clientWidth`) at any breakpoint/page combination (9 pages × 5 viewports =
45 checks, all `false`). Screenshots were reviewed manually at 360px,
390px, 768px and desktop for visual correctness (button sizing, text
wrapping, drawer/sidebar behavior).

One real bug was found and fixed during this pass: the finished Task
Result screen's "Validación" summary was including the transient
"Validando con Godot..." (running-status) step alongside the terminal
"Validación superada"/"Validación falló" step, so a *completed* task
appeared to still show an active spinner. Fixed by filtering the summary
to terminal-status steps only (`status !== "running"`); the full raw
timeline, including the transient entries, is still visible under "Ver
detalles técnicos" for anyone who wants it.

A second design fix from this pass: the header originally replaced the
hamburger button with a "← Volver" back button on Project Detail/Task
pages, which made Recursos/Actividad unreachable from those screens.
Fixed by keeping the hamburger always in the header and moving "← Volver"
into the page content itself (as a small link above the page title).

## 6. Tests

**Frontend (new, vitest + jsdom):** 19 tests, `ui/src/demo/__tests__/`.

- `engine.test.ts` (8): `pickScenario` for all three paths (PASS, FAIL→
  repair→PASS, non-Godot "simple"); `runDemoTask` resolves correctly for
  each scenario (validated flag, attempts, files, the specific
  `validation.failed`/`repair.finished`/`validation.passed` steps and
  their statuses); `cancel()` stops further step callbacks;
  `runDemoRollback` emits the two expected steps in order.
- `store.test.ts` (11): demo-mode's own namespaced localStorage key;
  seed data shape; `addProject`; `startTask` for both scenarios (via
  `demoStore`, asserting on the resulting `DemoTask`); `keep`;
  `rollback` (including the async rollback-steps sequence); `reset`
  (wipes user-created data, restores seed); localStorage persistence
  across a simulated reload (`new DemoStore()` reading back what a prior
  instance wrote) for both project data and the onboarding-seen flag;
  garbage-localStorage fallback.

All async engine/store timing is driven with `vi.useFakeTimers()` +
`vi.runAllTimersAsync()`, so the suite runs in under a second rather than
actually waiting out the multi-second demo timelines.

```
$ npx vitest run
 Test Files  2 passed (2)
      Tests  19 passed (19)
```

**Backend (regression, unchanged):**

```
$ python -m pytest tests/ -v
======================= 95 passed, 2 warnings in 12.91s ========================
```

No backend file was touched in this milestone; this run exists purely to
confirm M2.5B's frontend-only changes didn't regress anything.

**Frontend typecheck/build:**

```
$ npx tsc -b                                         # clean
$ npx vite build                                      # real mode, unchanged (162 KB gzip 51.5 KB)
$ VITE_DEMO_MODE=true BUILD_BASE_PATH=/impulsor-hub/ npx vite build   # demo mode (165 KB gzip 52.0 KB)
```

**Real Mode regression:** the production real-mode build was served and
opened in a headless browser with no backend running. Result: page
mounts cleanly, shows the original English real-mode UI ("Projects",
"Resources"), **no** demo banner, **zero** JS console errors. `App.tsx`'s
only change is the `if (DEMO_MODE) return <DemoApp/>` early return at the
top — the real-mode JSX below it is byte-for-byte what it was before this
milestone.

## 7. Deployed URL

**https://martincv928-commits.github.io/impulsor-hub/**

Same GitHub Pages mechanism as before (no hosting change) — the `gh-pages`
branch was updated with a fresh `VITE_DEMO_MODE=true
BUILD_BASE_PATH=/impulsor-hub/` build from `master@c1b06a3`, pushed as
commit `ef46b34`.

## 8. Limitations

- **Live URL not curl-verified from this sandbox.** `github.io` is
  blocked by this environment's egress policy (same constraint hit when
  the demo was first deployed) — neither `curl` nor the WebFetch tool can
  reach it from here. The exact same production build that was pushed to
  `gh-pages` was verified locally (served statically, driven with
  Playwright) across every scenario and all 5 breakpoints before pushing;
  GitHub Pages typically republishes within 1-2 minutes of a push to the
  branch it's configured to serve.
- **Scenario selection is a keyword heuristic**, not real language
  understanding — an objective has to mention "vidas/lives/salud/health"
  to trigger the FAIL→repair→PASS narrative on a Godot project; anything
  else takes the direct PASS path. Documented in `engine.ts` itself, not
  hidden behind a black box.
- **"Auto detectar" project type** is likewise a simple keyword guess on
  the project name (`juego|game|godot` → Godot, `web|página|landing|sitio`
  → Web, else Otro), not real project inspection (the demo has no
  filesystem access, by design).
- **Demo state is per-browser, not synced anywhere** — localStorage only,
  same device/browser. A visitor who clears site data or opens the demo
  in a different browser starts fresh from the seed data.
- **The desktop layout for Demo Mode is new** in this milestone (a
  persistent sidebar variant of the mobile drawer) and was visually
  reviewed but not stress-tested the way the mobile breakpoints were,
  since the milestone's emphasis was mobile.
- Real Mode's own desktop UI (`ui/src/App.tsx`'s non-demo branch,
  `ui/src/pages/*`) was **not** made responsive in this milestone — out of
  scope per the milestone's own framing (it's about the public demo);
  it's used locally by technical users on desktop today.

## 9. Main files changed

```
ui/src/App.tsx                          DEMO_MODE branch: render DemoApp entirely, or the
                                         unchanged real-mode tree.
ui/src/api/client.ts                    `api` is now always realApi; DEMO_MODE constant kept
                                         (App.tsx's branch point) but no longer selects a demo
                                         client here.
ui/src/api/demoClient.ts (removed)      Superseded by ui/src/demo/store.ts + engine.ts.
ui/src/api/demoData.ts (removed)        Superseded by ui/src/demo/seedData.ts.

ui/src/demo/types.ts                    Demo-only data model.
ui/src/demo/engine.ts                   DemoTaskEngine (pure, testable).
ui/src/demo/seedData.ts                 The 2 example projects / 1 example task.
ui/src/demo/store.ts                    DemoStore (localStorage + pub/sub, no React).
ui/src/demo/useDemoStore.ts             React binding (useSyncExternalStore).
ui/src/demo/demo.css                    Mobile-first styles + >=768px sidebar variant.
ui/src/demo/DemoApp.tsx                 View-state shell (Proyectos/Proyecto/Tarea/Recursos/
                                         Actividad) + onboarding gate.
ui/src/demo/components/*.tsx            One component per screen (see §1).
ui/src/demo/__tests__/*.test.ts         19 vitest tests.

ui/vitest.config.ts (new)               jsdom test environment.
ui/package.json                         + vitest/jsdom devDependencies, `npm test` script.
```

## Definition of Done

- [x] Demo abre desde Android (confirmado por el usuario en la iteración
      previa de despliegue; este milestone reutiliza el mismo mecanismo).
- [x] Mobile sidebar sustituido por header compacto + drawer.
- [x] Sin overflow horizontal (45/45 combinaciones página×breakpoint).
- [x] Usuario puede crear proyecto demo.
- [x] Usuario puede entrar al proyecto.
- [x] Usuario puede escribir una tarea.
- [x] Demo simula ejecución progresivamente (steps con esperas, no
      instantáneo).
- [x] Existe escenario PASS.
- [x] Existe FAIL→REPAIR→PASS.
- [x] Resultado es entendible (resumen en lenguaje natural + detalle
      técnico opcional).
- [x] KEEP funciona en demo.
- [x] ROLLBACK funciona en demo.
- [x] Activity es comprensible (lenguaje plano + toggle de ID técnico).
- [x] Resources está adaptado.
- [x] Demo persiste en localStorage.
- [x] Reset Demo funciona.
- [x] Interfaz coherente en español.
- [x] Real Mode permanece intacto (verificado: sin banner demo, sin
      errores JS, UI real sin cambios).
- [x] Tests M1/M2 siguen pasando (95/95).
- [x] Frontend compila (typecheck limpio, ambos builds).
- [x] URL pública actualizada (desplegada; ver limitación sobre
      verificación directa desde este entorno).
- [x] M2_5B_REPORT.md creado.
- [x] M3 NO iniciado.

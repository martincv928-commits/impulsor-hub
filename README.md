# Impulsor Hub — Milestone 2

Local-first orchestration layer that lets a user add an existing local
project, run a direct task through the Claude Code CLI, independently
inspect the real Git changes, and safely KEEP or ROLLBACK the result. For
Godot projects, changes are also automatically validated headlessly, with
an automatic repair loop when validation fails.

See `docs/IMPULSOR_HUB_SPEC_V0.1.md` (product/technical contract),
`docs/CLAUDE_M1.md` / `M1_REPORT.md` (Milestone 1: local project → task →
safe baseline → Claude Code → independent Git verification → KEEP/
ROLLBACK) and `M2_REPORT.md` (Milestone 2: the Godot validator adapter,
the validation + repair loop, and known limitations).

## Live demo

**https://martincv928-commits.github.io/impulsor-hub/**

A static, read-only build of the frontend with seeded sample data (no
live backend, no real AI tasks or file changes) — see "Demo mode"
below. For the real thing, run it locally per "Setup" / "Run" or with
Docker below.

## Prerequisites

- Python 3.11+
- Node.js 18+ (tested on Node 22) and npm
- `git` CLI
- `claude` CLI (Claude Code), authenticated (`claude auth status`)
- A Godot executable, only needed for **Godot projects** (any project
  without a `project.godot` at its root works exactly like M1 regardless
  of whether Godot is installed). If a project *is* a Godot project but no
  Godot executable is available, tasks on it fail clearly (a distinct
  "validator error", never a silent pass) rather than the Hub crashing.
  Verified against two official builds: Godot 3.5.2
  (`apt-get install godot3-server` on Debian/Ubuntu) and Godot 4.2.2
  (official release from github.com/godotengine/godot, checksum-verified
  — see `M2_REPORT.md` §12.2). Auto-detected on PATH (prefers a `godot4`
  binary over `godot3-server` when both are present — see §12.3), or set
  `IMPULSOR_HUB_GODOT_PATH` to force a specific executable.
- Rust + `cargo` only if you intend to build the Tauri desktop shell
  (`ui/npm run build` + `tauri` — see "Known limitations" in
  `M1_REPORT.md` for why this wasn't build-verified in the dev sandbox)

Tested on Linux x86_64.

## Setup

```bash
# Backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Frontend
cd ui
npm install
cd ..
```

## Run (development)

Two processes, in separate terminals:

```bash
# 1. API backend (FastAPI/uvicorn) on :8000
source .venv/bin/activate
uvicorn app.api.main:app --reload --host 127.0.0.1 --port 8000

# 2. UI dev server (Vite) on :5173, proxies /api to :8000
cd ui
npm run dev
```

Open http://127.0.0.1:5173/ in a browser. The Hub's own SQLite database
lives at `~/.impulsor-hub/hub.db` by default (override with
`IMPULSOR_HUB_DB_PATH`).

### Desktop shell (Tauri)

`ui/src-tauri/` contains a Tauri v2 skeleton (`tauri.conf.json`,
`Cargo.toml`, `src/main.rs`) that points the webview at the same
frontend. It was not build-verified in this environment (no display
server / GTK+WebKitGTK system libraries); see `M1_REPORT.md`. To try it
where those are available:

```bash
cd ui
npm install -g @tauri-apps/cli   # or use npx
npm run tauri dev
```

## Tests

```bash
source .venv/bin/activate
python -m pytest tests/ -v
```

This is fully portable: it runs (and passes) with or without Godot
installed. Tests that need a real Godot binary are marked
`@pytest.mark.real_godot` and auto-skip (never falsely fail) when none is
detected. To force-select only those:

```bash
python -m pytest -m real_godot -v
```

UI type-check / build:

```bash
cd ui
npx tsc -b
npx vite build
```

## Demo mode

`VITE_DEMO_MODE=true` builds the frontend against an in-memory mock API
client (`ui/src/api/demoClient.ts`) seeded with realistic sample data
instead of the real `fetch()`-based client — no backend needed, nothing
is written to disk, and a visible banner marks it as a demo. This is
what's deployed at the live demo URL above.

```bash
cd ui
# BUILD_BASE_PATH only matters when hosting under a subpath (e.g. GitHub
# Pages project sites); omit it (defaults to "/") for local use.
VITE_DEMO_MODE=true BUILD_BASE_PATH=/impulsor-hub/ npx vite build
npx serve dist   # or any static file server
```

Demo mode never talks to `/api` — `git grep DEMO_MODE ui/src` shows
every branch point.

## Adding a project

Use an **existing local git repository**. For a first try, do not point
it at a real project you care about — create a disposable one:

```bash
mkdir /tmp/demo-project && cd /tmp/demo-project
git init && git commit --allow-empty -m "init"
```

Then in the UI: Projects → paste `/tmp/demo-project` → Add Project → open
it → New Task → describe an objective → Run.

## Docker (optional, real backend + frontend — separate from the public demo)

This is a local convenience for running the *real* Hub (real backend,
real Claude Code CLI, real Git checkpoints) with one command instead of
two manual processes. It is unrelated to the read-only public demo
above, which has no backend at all.

```bash
docker compose up --build
```

- Frontend: http://localhost:8080/
- Backend directly: http://localhost:8000/api/health

Before running a task, authenticate the `claude` CLI once (the compose
file mounts your host `~/.claude` into the container read-only, so a
host login is normally picked up automatically; if not, run
`docker compose exec backend claude auth login`).

Projects you add through the UI must live under `/workspaces` **inside
the container** — by default this is bind-mounted from `./workspaces`
in the repo root (set `IMPULSOR_HUB_WORKSPACES` to point it elsewhere).
So to add the project at `./workspaces/my-project` on the host, add
`/workspaces/my-project` as the project's root path in the UI.

The Hub's SQLite database persists in a named Docker volume
(`hub-db`), independent of the container lifecycle.

Godot validation is not included in the backend image (Godot isn't
installed there) — non-Godot projects work exactly as in M1 regardless;
add a Godot install to `docker/Dockerfile.backend` if you need it.

**Not build-verified in this environment** (no Docker daemon available
in this sandbox — see `M1_REPORT.md`'s "Known limitations" for the same
constraint on the Tauri build). Reviewed by hand against the same
commands documented above for a bare-metal run; verify with
`docker compose up --build` in an environment with Docker before relying
on it.

## Repository layout

```text
app/
  core/{orchestrator,router,permissions,events}/  pipeline (incl. validation/
                                                    repair loop), resource
                                                    selection, policy, events
  adapters/{ai,vcs,validator,tools}/               Claude Code, Git, Godot adapters
  projects/, tasks/                                persistence + services
  database/                                        SQLite schema + Pydantic models
  api/                                              FastAPI app + routers
ui/                                                 React + TypeScript + Tauri
tests/                                              pytest suite (91 tests)
docs/                                                spec, execution brief, E2E screenshots
```

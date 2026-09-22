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

## Prerequisites

- Python 3.11+
- Node.js 18+ (tested on Node 22) and npm
- `git` CLI
- `claude` CLI (Claude Code), authenticated (`claude auth status`)
- A Godot executable, only for Godot-project validation (optional —
  everything else works without it; Godot projects just skip validation
  and behave like M1 if it's missing). Tested against Godot 3.5.2
  (`apt-get install godot3-server` on Debian/Ubuntu). Auto-detected on
  PATH, or set `IMPULSOR_HUB_GODOT_PATH` to a specific executable.
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

UI type-check / build:

```bash
cd ui
npx tsc -b
npx vite build
```

## Adding a project

Use an **existing local git repository**. For a first try, do not point
it at a real project you care about — create a disposable one:

```bash
mkdir /tmp/demo-project && cd /tmp/demo-project
git init && git commit --allow-empty -m "init"
```

Then in the UI: Projects → paste `/tmp/demo-project` → Add Project → open
it → New Task → describe an objective → Run.

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

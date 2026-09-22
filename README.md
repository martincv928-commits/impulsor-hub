# Impulsor Hub — Milestone 1

Local-first orchestration layer that lets a user add an existing local
project, run a direct task through the Claude Code CLI, independently
inspect the real Git changes, and safely KEEP or ROLLBACK the result.

See `docs/IMPULSOR_HUB_SPEC_V0.1.md` (product/technical contract),
`docs/CLAUDE_M1.md` (execution brief) and `M1_REPORT.md` (what M1 actually
delivers, how it was tested, and known limitations).

## Prerequisites

- Python 3.11+
- Node.js 18+ (tested on Node 22) and npm
- `git` CLI
- `claude` CLI (Claude Code), authenticated (`claude auth status`)
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
  core/{orchestrator,router,permissions,events}/  pipeline, resource
                                                    selection, policy, events
  adapters/{ai,vcs,tools}/                         Claude Code + Git adapters
  projects/, tasks/                                persistence + services
  database/                                        SQLite schema + Pydantic models
  api/                                              FastAPI app + routers
ui/                                                 React + TypeScript + Tauri
tests/                                              pytest suite (56 tests)
docs/                                                spec, execution brief, E2E screenshots
```

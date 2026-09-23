from __future__ import annotations

import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

import os

from app.api.routers import agent, cloud_session, preview, projects, resources, tasks, testgame, webexport
from app.core.security import get_or_create_agent_token, require_agent_token
from app.database.db import init_db


@asynccontextmanager
async def _lifespan(app: FastAPI):
    init_db()
    yield
    # Only ever stops preview processes THIS Agent started and is tracking
    # (see app/api/routers/preview.py) -- never a Godot process the user
    # launched some other way (M2.6.1 SPEC section M).
    preview.stop_all()


app = FastAPI(title="Impulsor Hub", version="0.1.0", lifespan=_lifespan)

# CORS is a fixed local allowlist (never "*"): the desktop shell (Tauri
# webview) and the Vite dev server both run as a local origin distinct
# from the API port. CORS alone does not stop a page on some OTHER origin
# from firing a request here (it only stops that page's JS from reading
# the response) -- app.core.security's Bearer token is what actually
# authorizes a caller, see M2_6_REPORT.md "Security model".
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "tauri://localhost"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_AUTH = [Depends(require_agent_token)]
app.include_router(projects.router, dependencies=_AUTH)
app.include_router(resources.router, dependencies=_AUTH)
app.include_router(tasks.router, dependencies=_AUTH)
app.include_router(preview.router, dependencies=_AUTH)
app.include_router(testgame.router, dependencies=_AUTH)
app.include_router(agent.router)  # agent.py applies the dependency itself per-route (status is public)
app.include_router(cloud_session.router)  # no token dep: this IS how a cloud caller gets one
app.include_router(webexport.router)  # mixed: /webexport/start routes apply the dep themselves; preview serving is deliberately public (see module docstring)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


# When a production real-mode UI build exists (ui/dist, built WITHOUT
# VITE_DEMO_MODE), serve it directly so a non-technical user can open
# http://127.0.0.1:<port>/ in any browser and get the real app talking
# same-origin to this real Agent -- no separate frontend process, no
# terminal beyond starting the Agent itself.
#
# Token bootstrap (LOCAL mode only): the browser has no other way to
# learn the Agent's auth token (see app/core/security.py), so `GET /` --
# and only `/`, never the static JS/CSS bundle -- injects it as an inline
# script. Safe for a local Agent because anyone who can load this page at
# all already has whatever access the token grants (same machine / same
# local network path); it only ever stops a DIFFERENT origin's JS (some
# other open tab) from blindly calling the API as a confused deputy.
#
# This does NOT apply when IMPULSOR_HUB_CLOUD_ACCESS_CODE is set (Cloud
# mode, M2.7 SPEC section E): a Cloud Agent is reachable by anyone on the
# internet, so auto-injecting the token into every page load would hand
# it to any stranger who finds the URL, defeating the access-code gate
# entirely. Cloud callers get their token exclusively through
# POST /api/cloud/session (app/api/routers/cloud_session.py) and the
# frontend caches it itself (localStorage) -- `GET /` here just serves
# the same static page either way, token-free in Cloud mode.
#
# Read fresh per-request (not cached at import time) so it stays
# consistent with every other cloud-mode check in this codebase
# (agent.py's /status, cloud_session.py) and so tests can monkeypatch
# the env var per-case.
def _cloud_mode() -> bool:
    return bool(os.environ.get("IMPULSOR_HUB_CLOUD_ACCESS_CODE"))


# Same PyInstaller-frozen-bundle caveat as app/api/routers/testgame.py's
# _template_dir(): __file__ is meaningless inside a --onefile bundle, use
# sys._MEIPASS (where --add-data "ui/dist;ui/dist" places it) instead.
if getattr(sys, "frozen", False):
    _UI_DIST = Path(getattr(sys, "_MEIPASS")) / "ui" / "dist"
else:
    _UI_DIST = Path(__file__).resolve().parents[2] / "ui" / "dist"
if _UI_DIST.is_dir():
    _INDEX_HTML = (_UI_DIST / "index.html").read_text(encoding="utf-8")
    app.mount("/assets", StaticFiles(directory=str(_UI_DIST / "assets")), name="ui-assets")

    @app.get("/", response_class=HTMLResponse, include_in_schema=False)
    def serve_ui() -> str:
        if _cloud_mode():
            return _INDEX_HTML
        token = get_or_create_agent_token()
        injected = f'<script>window.__IMPULSOR_AGENT_TOKEN__={token!r};</script></head>'
        return _INDEX_HTML.replace("</head>", injected, 1)

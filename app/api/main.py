from __future__ import annotations

import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

import os

from app.api.routers import agent, cloud_session, preview, projects, resources, settings, tasks, testgame, webexport
from app.core.security import require_agent_token
from app.core.ui_bootstrap import bootstrap_html
from app.core.ui_build import build_info
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
app.include_router(settings.router, dependencies=_AUTH)
app.include_router(tasks.router, dependencies=_AUTH)
app.include_router(preview.router, dependencies=_AUTH)
app.include_router(testgame.router, dependencies=_AUTH)
app.include_router(agent.router)  # agent.py applies the dependency itself per-route (status is public)
app.include_router(cloud_session.router)  # no token dep: this IS how a cloud caller gets one
app.include_router(webexport.router)  # mixed: /webexport/start routes apply the dep themselves; preview serving is deliberately public (see module docstring)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "pid": os.getpid(),
            "code_revision": os.environ.get("IMPULSOR_HUB_CODE_REVISION", "unknown"),
            "ui_revision": _BUILD_INFO.get("revision", "unknown")}


# When a production real-mode UI build exists (ui/dist, built WITHOUT
# VITE_DEMO_MODE), serve it directly so a non-technical user can open
# http://127.0.0.1:<port>/ in any browser and get the real app talking
# same-origin to this real Agent -- no separate frontend process, no
# terminal beyond starting the Agent itself.
#
# Remote pages receive no server token. Owner launch links bootstrap the tab
# before Vite modules execute; see app/core/ui_bootstrap.py.
#
# Same PyInstaller-frozen-bundle caveat as app/api/routers/testgame.py's
# _template_dir(): __file__ is meaningless inside a --onefile bundle, use
# sys._MEIPASS (where --add-data "ui/dist;ui/dist" places it) instead.
if getattr(sys, "frozen", False):
    _UI_DIST = Path(getattr(sys, "_MEIPASS")) / "ui" / "dist"
else:
    _UI_DIST = Path(__file__).resolve().parents[2] / "ui" / "dist"
_BUILD_INFO = build_info(_UI_DIST.parent)


def mount_ui(application: FastAPI, dist: Path) -> None:
    if not dist.is_dir():
        return
    index_html = (dist / "index.html").read_text(encoding="utf-8")
    application.mount("/assets", StaticFiles(directory=str(dist / "assets")), name="ui-assets")

    @application.get("/", response_class=HTMLResponse, include_in_schema=False)
    def serve_ui(request: Request) -> HTMLResponse:
        return HTMLResponse(
            bootstrap_html(index_html, request),
            headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"},
        )


mount_ui(app, _UI_DIST)

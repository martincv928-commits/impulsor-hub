"""Agent connectivity + native folder picker (M2.6 SPEC sections C, D, F).

`GET /status` is deliberately public (no token) -- it's how the UI tells
"Agent not running" apart from "Agent running but I don't have a token
yet", and it reveals nothing sensitive. Everything else here requires the
token like every other router (see app/core/security.py).
"""
from __future__ import annotations

import asyncio
import os
from typing import Optional

from fastapi import APIRouter, Depends

from app.core.security import require_agent_token

router = APIRouter(prefix="/api/agent", tags=["agent"])


@router.get("/status")
def agent_status() -> dict:
    # A deployment is a Cloud Agent purely by virtue of having the cloud
    # access code configured (M2.7 SPEC section F) -- there is no separate
    # "cloud build," the exact same code serves both (section D principle:
    # don't fork the backend, don't duplicate the pipeline).
    mode = "cloud" if os.environ.get("IMPULSOR_HUB_CLOUD_ACCESS_CODE") else "local"
    return {"agent": "impulsor-agent", "version": "0.1.0", "connected": True, "mode": mode}


def _run_native_folder_dialog() -> Optional[str]:
    """Blocking; must be called off the event loop (see pick_folder).
    Isolated into its own function so tests can monkeypatch it instead of
    needing a real display."""
    import tkinter
    from tkinter import filedialog

    root = tkinter.Tk()
    root.withdraw()
    try:
        root.attributes("-topmost", True)
    except tkinter.TclError:
        pass
    try:
        selected = filedialog.askdirectory(title="Selecciona la carpeta del proyecto")
    finally:
        root.destroy()
    return selected or None


@router.post("/pick-folder")
async def pick_folder(_: None = Depends(require_agent_token)) -> dict:
    """Opens a native OS folder-choose dialog on the machine the Agent
    runs on (Windows/macOS/Linux via Tk, which ships with standard
    CPython) and returns the absolute path the user picked. No Electron/
    Tauri needed. If no display is available (e.g. a headless server),
    fails clearly rather than hanging -- the UI falls back to a manual
    path field in that case (see M2_6_REPORT.md limitations)."""
    try:
        path = await asyncio.to_thread(_run_native_folder_dialog)
    except Exception as exc:  # tkinter.TclError (no display) or anything else the dialog can raise
        return {"path": None, "cancelled": False, "error": f"No se pudo abrir el selector de carpetas: {exc}"}
    if path is None:
        return {"path": None, "cancelled": True, "error": None}
    return {"path": path, "cancelled": False, "error": None}

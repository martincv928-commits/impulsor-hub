"""Single entrypoint for a zero-terminal Impulsor Hub launch (M2.6.1 SPEC
section J): starts the Agent and opens the default browser to it. This is
what the packaged Windows artifact runs, and what
windows/ImpulsorHub-Start.bat invokes locally -- no separate frontend
process, no commands for the user to type.
"""
from __future__ import annotations

import threading
import time
import webbrowser

import uvicorn

from app.api.main import app

HOST = "127.0.0.1"
PORT = 8000


def _open_browser_when_ready() -> None:
    time.sleep(1.5)
    webbrowser.open(f"http://{HOST}:{PORT}/")


def main() -> None:
    threading.Thread(target=_open_browser_when_ready, daemon=True).start()
    uvicorn.run(app, host=HOST, port=PORT)


if __name__ == "__main__":
    main()

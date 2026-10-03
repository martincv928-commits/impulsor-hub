"""Single entrypoint for a zero-terminal Impulsor Hub launch (M2.6.1 SPEC
section J): starts the Agent and opens the default browser to it. This is
what the packaged Windows artifact runs, and what
windows/ImpulsorHub-Start.bat invokes locally -- no separate frontend
process, no commands for the user to type.
"""
from __future__ import annotations

import os
import socket
import threading
import time
import webbrowser

import uvicorn

from app.api.main import app

HOST = "127.0.0.1"
PORT = 8000


def _pid_listening_on_port(port: int) -> int | None:
    """Best-effort Linux/Codespaces lookup for the process owning *port*."""
    if os.name != "posix" or not os.path.isdir("/proc"):
        return None
    wanted_inode: str | None = None
    port_hex = f"{port:04X}"
    for table in ("/proc/net/tcp", "/proc/net/tcp6"):
        try:
            for line in open(table, encoding="utf-8").read().splitlines()[1:]:
                parts = line.split()
                if len(parts) > 9 and parts[1].split(":")[-1].upper() == port_hex and parts[3] == "0A":
                    wanted_inode = parts[9]
                    break
        except OSError:
            continue
        if wanted_inode:
            break
    if not wanted_inode:
        return None
    needle = f"socket:[{wanted_inode}]"
    for pid in os.listdir("/proc"):
        if not pid.isdigit() or int(pid) == os.getpid():
            continue
        fd_dir = f"/proc/{pid}/fd"
        try:
            for fd in os.listdir(fd_dir):
                try:
                    if os.readlink(f"{fd_dir}/{fd}") == needle:
                        return int(pid)
                except OSError:
                    pass
        except OSError:
            pass
    return None


def _stop_stale_hub() -> None:
    """Replace an older Hub Agent left on port 8000 after a git pull."""
    pid = _pid_listening_on_port(PORT)
    if pid is None:
        return
    try:
        cmdline = open(f"/proc/{pid}/cmdline", "rb").read().replace(b"\\x00", b" ").decode("utf-8", "replace")
    except OSError:
        return
    # Never kill an unrelated service that happens to use the port.
    if "app.launcher" not in cmdline and "uvicorn" not in cmdline:
        return
    try:
        os.kill(pid, 15)
    except OSError:
        return
    deadline = time.time() + 5
    while time.time() < deadline:
        with socket.socket() as sock:
            if sock.connect_ex((HOST, PORT)) != 0:
                return
        time.sleep(0.1)



def _open_browser_when_ready() -> None:
    time.sleep(1.5)
    webbrowser.open(f"http://{HOST}:{PORT}/")


def main() -> None:
    _stop_stale_hub()
    threading.Thread(target=_open_browser_when_ready, daemon=True).start()
    uvicorn.run(app, host=HOST, port=PORT)


if __name__ == "__main__":
    main()

"""SQLite connection management and schema initialization.

Kept intentionally minimal for M1: a single schema.sql applied idempotently
(CREATE TABLE IF NOT EXISTS), no ORM. Each request gets its own connection
via `get_connection`; callers are responsible for commit/rollback via the
context manager.
"""
from __future__ import annotations

import os
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path

_SCHEMA_PATH = Path(__file__).parent / "schema.sql"

# Default data directory lives under the Hub's own app data, never inside a
# managed project's workspace.
DEFAULT_DB_PATH = Path(
    os.environ.get("IMPULSOR_HUB_DB_PATH", str(Path.home() / ".impulsor-hub" / "hub.db"))
)

_lock = threading.Lock()


def init_db(db_path: Path | str = DEFAULT_DB_PATH) -> None:
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    try:
        with _lock:
            conn.executescript(_SCHEMA_PATH.read_text())
            conn.commit()
    finally:
        conn.close()


@contextmanager
def get_connection(db_path: Path | str = DEFAULT_DB_PATH):
    db_path = Path(db_path)
    if not db_path.exists():
        init_db(db_path)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

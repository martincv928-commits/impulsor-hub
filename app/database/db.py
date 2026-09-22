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
# managed project's workspace. Resolved at call time (not import time) so
# IMPULSOR_HUB_DB_PATH can be overridden per-process (e.g. in tests) without
# reloading this module.
def _default_db_path() -> Path:
    return Path(os.environ.get("IMPULSOR_HUB_DB_PATH", str(Path.home() / ".impulsor-hub" / "hub.db")))


_lock = threading.Lock()

# Additive column migrations for databases created before this column
# existed. CREATE TABLE IF NOT EXISTS (schema.sql) only helps fresh
# databases; existing M1 databases need an explicit ALTER TABLE. Deliberately
# minimal (one column, no new tables) per M2 SPEC section 8.
_COLUMN_MIGRATIONS: list[tuple[str, str, str]] = [
    ("task_run", "validation_status", "ALTER TABLE task_run ADD COLUMN validation_status TEXT"),
]


def _apply_column_migrations(conn: sqlite3.Connection) -> None:
    for table, column, ddl in _COLUMN_MIGRATIONS:
        existing_columns = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
        if column not in existing_columns:
            conn.execute(ddl)


def init_db(db_path: Path | str | None = None) -> None:
    db_path = Path(db_path) if db_path is not None else _default_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    try:
        with _lock:
            conn.executescript(_SCHEMA_PATH.read_text())
            _apply_column_migrations(conn)
            conn.commit()
    finally:
        conn.close()


@contextmanager
def get_connection(db_path: Path | str | None = None):
    db_path = Path(db_path) if db_path is not None else _default_db_path()
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

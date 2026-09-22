"""Resource discovery + health checks (SPEC section 7, CLAUDE_M1 Checkpoint B).

Resources are upserted (fixed ids per adapter_key) so history/health can be
refreshed without accumulating duplicate rows. Never fabricates quota
figures — cost_type/health fields are `unknown` unless the adapter itself
reports a real value.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone

from app.core.router.router import ResourceRouter
from app.database.models import CostType, Resource, ResourceType

_RESOURCE_IDS = {"git": "resource-git", "claude_code": "resource-claude-code", "godot": "resource-godot"}
_RESOURCE_TYPES = {"git": ResourceType.VCS, "claude_code": ResourceType.AI_EXECUTOR, "godot": ResourceType.TOOL}
_RESOURCE_DISPLAY = {"git": "Git", "claude_code": "Claude Code CLI", "godot": "Godot"}
_RESOURCE_COST = {"git": CostType.FREE, "claude_code": CostType.SUBSCRIPTION, "godot": CostType.FREE}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_resource(row: sqlite3.Row) -> Resource:
    return Resource(
        id=row["id"],
        adapter_key=row["adapter_key"],
        type=row["type"],
        display_name=row["display_name"],
        version=row["version"],
        availability=row["availability"],
        auth_state=row["auth_state"],
        cost_type=row["cost_type"],
        capabilities=json.loads(row["capabilities_json"]),
        health=json.loads(row["health_json"]),
        checked_at=row["checked_at"],
    )


def refresh_resources(conn: sqlite3.Connection, router: ResourceRouter) -> list[Resource]:
    results: list[Resource] = []
    for key, adapter in router.all_adapters().items():
        health = adapter.health_check()
        capabilities = adapter.capabilities() if hasattr(adapter, "capabilities") else []
        availability = "available" if health.get("available") else "unavailable"
        auth_state = health.get("authenticated") if key == "claude_code" else None
        now = _now()
        resource_id = _RESOURCE_IDS[key]
        conn.execute(
            """
            INSERT INTO resource (id, adapter_key, type, display_name, version, availability,
                                   auth_state, cost_type, capabilities_json, health_json, checked_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                version=excluded.version,
                availability=excluded.availability,
                auth_state=excluded.auth_state,
                capabilities_json=excluded.capabilities_json,
                health_json=excluded.health_json,
                checked_at=excluded.checked_at
            """,
            (
                resource_id,
                key,
                _RESOURCE_TYPES[key].value,
                _RESOURCE_DISPLAY[key],
                health.get("version"),
                availability,
                auth_state,
                _RESOURCE_COST[key].value,
                json.dumps(capabilities),
                json.dumps(health),
                now,
            ),
        )
        row = conn.execute("SELECT * FROM resource WHERE id = ?", (resource_id,)).fetchone()
        results.append(_row_to_resource(row))
    return results


def list_resources(conn: sqlite3.Connection) -> list[Resource]:
    rows = conn.execute("SELECT * FROM resource ORDER BY display_name").fetchall()
    return [_row_to_resource(r) for r in rows]

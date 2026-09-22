"""Local Agent authentication (M2.6 SPEC section E).

A page in some other browser tab can still fire cross-origin POSTs at
http://127.0.0.1:<port>/api/... even with a restrictive CORS allowlist --
CORS only stops that page's JS from *reading* the response, not the
request from executing server-side. The token below is what actually
authorizes a caller: only something that already holds the token (the
Agent's own served UI, or a developer reading the token file on the same
machine) can act. No OAuth, no credential capture -- this authorizes
*local callers of the Agent*, and is unrelated to how Claude Code itself
authenticates (see adapters/ai/claude_code/adapter.py's own `claude auth
status` detection).
"""
from __future__ import annotations

import os
import secrets
from pathlib import Path
from typing import Optional

from fastapi import Header, HTTPException


def _token_path() -> Path:
    return Path(
        os.environ.get("IMPULSOR_HUB_TOKEN_PATH", str(Path.home() / ".impulsor-hub" / "agent_token"))
    )


def get_or_create_agent_token() -> str:
    """IMPULSOR_HUB_AGENT_TOKEN overrides (tests, or an operator who wants
    to pin the token) without touching disk. Otherwise a token is
    generated once and persisted with owner-only permissions."""
    override = os.environ.get("IMPULSOR_HUB_AGENT_TOKEN")
    if override:
        return override
    path = _token_path()
    if path.exists():
        existing = path.read_text().strip()
        if existing:
            return existing
    path.parent.mkdir(parents=True, exist_ok=True)
    token = secrets.token_urlsafe(32)
    path.write_text(token)
    try:
        path.chmod(0o600)
    except OSError:
        pass  # best-effort on platforms without POSIX permissions (e.g. some Windows filesystems)
    return token


async def require_agent_token(authorization: Optional[str] = Header(default=None)) -> None:
    """FastAPI dependency: raises 401 unless a valid `Bearer <token>` is
    presented. Applied to every project/task/resource route; deliberately
    NOT applied to /api/health or /api/agent/status, which reveal nothing
    sensitive and exist specifically so the UI can detect connectivity
    before it has a token to send."""
    expected = get_or_create_agent_token()
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header")
    provided = authorization[len("Bearer ") :]
    if not secrets.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="Invalid agent token")

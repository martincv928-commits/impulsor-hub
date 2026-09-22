from __future__ import annotations

from fastapi import APIRouter

from app.core.resources import refresh_resources
from app.core.router.router import get_router
from app.database.db import get_connection
from app.database.models import Resource

router = APIRouter(prefix="/api/resources", tags=["resources"])


@router.get("", response_model=list[Resource])
def get_resources() -> list[Resource]:
    """Runs cheap, no-API-call health checks (git --version / claude
    --version + `claude auth status`) and persists the refreshed rows."""
    with get_connection() as conn:
        return refresh_resources(conn, get_router())

"""Runtime settings for M2.8's provider independence: which AI provider
the orchestrator uses, selectable at runtime (not just via a deploy-time
env var) so the user can switch from the mobile UI once more than one
provider is functional."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.router.router import AI_PROVIDER_REGISTRY, SelectionError, get_router

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("/ai-provider")
def get_ai_provider() -> dict:
    return {"active": get_router().active_ai_provider(), "available": sorted(AI_PROVIDER_REGISTRY.keys())}


class SetAiProviderRequest(BaseModel):
    provider: str


@router.post("/ai-provider")
def set_ai_provider(payload: SetAiProviderRequest) -> dict:
    try:
        get_router().set_active_ai_provider(payload.provider)
    except SelectionError as exc:
        raise HTTPException(status_code=400, detail=exc.reason) from exc
    return {"active": payload.provider}

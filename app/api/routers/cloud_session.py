"""Cloud session bootstrap (M2.7 SPEC sections E, F).

A local Agent can safely auto-inject its token into `GET /` (see
app/api/main.py) because reaching that page at all already implies
same-machine trust. A Cloud Agent, reachable from the open internet, has
no such property -- an open "give me a token" endpoint would let any
stranger who finds the URL spend the deployer's compute (and Claude
budget). So Cloud mode gates the *first* token issuance behind a single
access code the deployer sets as an environment variable at deploy time
(IMPULSOR_HUB_CLOUD_ACCESS_CODE) -- never committed to the repo, never
sent to the frontend build, never logged. No OAuth: this is exactly the
"minimal controlled access mechanism" the spec calls for. Once
exchanged, every subsequent request uses the exact same Bearer-token
mechanism as Local mode (app/core/security.py) -- this endpoint's only
job is producing that one token.
"""
from __future__ import annotations

import os
import secrets

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.security import get_or_create_agent_token

router = APIRouter(prefix="/api/cloud", tags=["cloud"])


class CloudSessionRequest(BaseModel):
    access_code: str


@router.post("/session")
def create_cloud_session(payload: CloudSessionRequest) -> dict:
    expected = os.environ.get("IMPULSOR_HUB_CLOUD_ACCESS_CODE")
    if not expected:
        raise HTTPException(status_code=503, detail="Este despliegue no tiene Cloud Mode configurado")
    if not secrets.compare_digest(payload.access_code, expected):
        raise HTTPException(status_code=401, detail="Código de acceso incorrecto")
    return {"token": get_or_create_agent_token()}

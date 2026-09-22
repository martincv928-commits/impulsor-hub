from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routers import projects, resources, tasks
from app.database.db import init_db


@asynccontextmanager
async def _lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Impulsor Hub", version="0.1.0", lifespan=_lifespan)

# The desktop shell (Tauri webview) and the Vite dev server both run as a
# local origin distinct from the API port; this is a local-only tool, so a
# permissive local CORS policy is acceptable for M1.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "tauri://localhost"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects.router)
app.include_router(resources.router)
app.include_router(tasks.router)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}

"""FastAPI application — chat demo entrypoint.

CORS + three endpoint groups:
  /auth/demo          — mint a demo doctor session (frontend auto-login)
  /analyze + sessions — chat pipeline (routers/chat.py)
  /analytics/*        — patient list + dashboard fallback for the chart card

Run:  conda activate <env> && python start.py   (or: uvicorn app:app --port 8000)
"""

from __future__ import annotations

import os

from dotenv import load_dotenv

# Must run before any module that captures os.getenv at import time (llm.py).
load_dotenv()

from fastapi import APIRouter, Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import get_db_yield
from demo_auth import (
    DEMO_DOCTOR_ID,
    DEMO_PASSWORD,
    DEMO_USERNAME,
    ActorContext,
    get_actor_context,
    mint_jwt,
)
from crud import SQLmanager
from routers.chat import router as chat_router

app = FastAPI(
    title="Chat-Agent Demo API",
    description="多智能体会诊聊天演示 — LangGraph 双Agent + SSE 流式",
    version="1.0.0",
)

DEFAULT_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000"
allow_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", DEFAULT_ORIGINS).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(chat_router)


# ---------------------------------------------------------------------------
# demo auth — the frontend's auto-login bootstrap
# ---------------------------------------------------------------------------

auth_router = APIRouter(tags=["auth"])


@auth_router.post("/auth/demo")
def demo_login():
    """Mint a token for the built-in demo doctor — no password round-trip."""
    token = mint_jwt(
        DEMO_DOCTOR_ID,
        DEMO_USERNAME,
        "doctor",
        real_name="李医生",
    )
    return {
        "code": 200,
        "data": {
            "token": token,
            "user": {
                "doctor_id": DEMO_DOCTOR_ID,
                "user_role": "doctor",
                "name": "李医生",
                "username": DEMO_USERNAME,
                "avatar": "",
                "demo_password": DEMO_PASSWORD,
            },
        },
    }


@auth_router.get("/auth/me")
def whoami(actor: ActorContext = Depends(get_actor_context)):
    return {
        "code": 200,
        "data": {
            "doctor_id": actor.doctor_id,
            "user_role": actor.role,
            "name": actor.real_name or actor.username,
        },
    }


app.include_router(auth_router)


# ---------------------------------------------------------------------------
# analytics — minimal projections for the patient selector and chart fallback
# ---------------------------------------------------------------------------

analytics_router = APIRouter(tags=["analytics"])


@analytics_router.get("/analytics/patients")
def analytics_patients(
    db=Depends(get_db_yield),
    actor: ActorContext = Depends(get_actor_context),
):
    return {"code": 200, "data": SQLmanager(db).get_patients_by_doctor(actor.doctor_id)}


@analytics_router.get("/analytics/dashboard/{patient_id}")
def analytics_dashboard(
    patient_id: int,
    time_range: str = "1m",
    action_type: str = "",
    db=Depends(get_db_yield),
    actor: ActorContext = Depends(get_actor_context),
):
    data = SQLmanager(db).get_dashboard_data(
        actor.doctor_id, patient_id, action_type or None, time_range
    )
    return {"code": 200, "data": data}


app.include_router(analytics_router)


@app.get("/")
def root():
    return {"name": "Chat-Agent Demo", "docs": "/docs"}

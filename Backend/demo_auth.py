"""Demo authentication — minimal stand-in for the parent's auth stack.

The parent system runs a full JWT + consent + account-state pipeline
(services/auth_context.py, 695 lines). The demo keeps the same contract
surface that the chat router depends on:

    mint_jwt() / decode_jwt()     — HS256 tokens (services/auth_tokens.py)
    ActorContext                  — frozen identity snapshot
    get_actor_context             — FastAPI dependency on Authorization header

but resolves every caller to the built-in demo doctor, so the frontend's
`getAuthHeaders()` flow works unchanged without a login page.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, replace

import jwt
from fastapi import Header, HTTPException, status

JWT_ALGORITHM = "HS256"


def get_jwt_secret() -> str:
    return os.getenv("JWT_SECRET") or os.getenv("API_KEY") or ""


def mint_jwt(
    doctor_id: int,
    username: str,
    role: str,
    *,
    patient_id: int | None = None,
    real_name: str | None = None,
    ttl_seconds: int | None = None,
) -> str:
    """Issue a STANDARD JWT with the parent's claim contract."""
    secret = get_jwt_secret()
    if not secret:
        raise RuntimeError("JWT_SECRET/API_KEY is not configured")
    now = int(time.time())
    ttl = ttl_seconds or int(os.getenv("JWT_TTL_SECONDS", "43200"))
    payload = {
        "sub": str(patient_id if role == "patient" else doctor_id),
        "role": role,
        "username": username,
        "doctor_id": doctor_id,
        "iat": now,
        "exp": now + ttl,
    }
    if patient_id is not None:
        payload["patient_id"] = patient_id
    if real_name:
        payload["real_name"] = real_name
    return jwt.encode(payload, secret, algorithm=JWT_ALGORITHM)


def decode_jwt(token: str) -> dict:
    secret = get_jwt_secret()
    if not secret:
        raise RuntimeError("JWT_SECRET/API_KEY is not configured")
    return jwt.decode(token, secret, algorithms=[JWT_ALGORITHM])


@dataclass(frozen=True)
class ActorContext:
    """The authenticated principal, mirroring the parent's shape."""

    role: str
    actor_id: int
    doctor_id: int
    patient_id: int | None = None
    username: str = ""
    real_name: str = ""

    def is_service(self) -> bool:
        return False

    def is_clinician(self) -> bool:
        return self.role == "doctor"

    def is_patient(self) -> bool:
        return self.role == "patient"


async def get_actor_context(
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> ActorContext:
    """Resolve the caller identity from the Bearer token.

    Demo mode: any valid token resolves to a doctor actor. Patient-role tokens
    minted by /auth/demo keep their own identity so scoping rules still apply.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED", "message": "缺少认证凭据"},
        )
    try:
        claims = decode_jwt(authorization.removeprefix("Bearer ").strip())
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED", "message": "认证凭据无效或已过期"},
        ) from exc

    role = str(claims.get("role") or "doctor")
    doctor_id = int(claims.get("doctor_id") or DEMO_DOCTOR_ID)
    patient_id = claims.get("patient_id")

    if role == "patient":
        return ActorContext(
            role="patient",
            actor_id=int(claims.get("sub") or patient_id or 0),
            doctor_id=doctor_id,
            patient_id=int(patient_id) if patient_id is not None else None,
            username=str(claims.get("username") or ""),
            real_name=str(claims.get("real_name") or ""),
        )
    return ActorContext(
        role="doctor",
        actor_id=doctor_id,
        doctor_id=doctor_id,
        username=str(claims.get("username") or ""),
        real_name=str(claims.get("real_name") or ""),
    )


# The demo doctor is always doctor_id=1 (seed.py guarantees the row).
DEMO_DOCTOR_ID = 1
DEMO_USERNAME = "demo"
DEMO_PASSWORD = "demo1234"

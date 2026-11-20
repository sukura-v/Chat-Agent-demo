"""Role-scoped DeepSeek clients — faithful copy of the parent system's contract.

Every chat role runs on one OpenAI-compatible DeepSeek endpoint configured via
environment variables (Backend/.env of the demo project):

    API_KEY            — DeepSeek API key (required)
    DEEPSEEK_MODEL     — default: deepseek-chat
    DEEPSEEK_BASE_URL  — default: https://api.deepseek.com

Role profiles (temperature / max_tokens) mirror the parent's _ROLE_PROFILES
for the four chat roles; the consultation-worker profiles are not needed here.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from threading import Lock
from typing import Any

from langchain.chat_models import init_chat_model

_API_KEY = os.getenv("API_KEY")
CHAT_MODEL_NAME = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")


@dataclass(frozen=True)
class _RoleProfile:
    temperature: float
    max_tokens: int


_ROLE_PROFILES = {
    "thinking": _RoleProfile(0.2, 2048),
    "output": _RoleProfile(0.2, 2048),
    "rewrite": _RoleProfile(0.1, 512),
    "summary": _RoleProfile(0.1, 512),
}
_role_models: dict[str, Any] = {}
_model_lock = Lock()


def _check_api_key() -> None:
    if not _API_KEY:
        raise RuntimeError(
            "API_KEY environment variable is not set. "
            "Create Backend/.env with API_KEY=<your deepseek key> or set it "
            "in the environment before starting the server."
        )


def _new_role_model(*, temperature: float, max_tokens: int):
    _check_api_key()
    return init_chat_model(
        CHAT_MODEL_NAME,
        model_provider="openai",
        api_key=_API_KEY,
        base_url=_BASE_URL,
        temperature=temperature,
        max_tokens=max_tokens,
        # Tool-choice routing (Agent C, tool_choice="required") requires the
        # model's interleaved thinking mode to be switched off — same contract
        # as the parent system's llm.py.
        extra_body={"thinking": {"type": "disabled"}},
    )


def get_role_model(role: str):
    """Lazily construct and cache one client per role profile."""
    profile = _ROLE_PROFILES.get(role)
    if profile is None:
        raise KeyError(f"unknown LLM role: {role}")
    with _model_lock:
        cached = _role_models.get(role)
        if cached is None:
            cached = _new_role_model(
                temperature=profile.temperature, max_tokens=profile.max_tokens
            )
            _role_models[role] = cached
        return cached


# Backwards-compatible accessors matching the parent project's llm.py names.
def get_chat_llm():
    return get_role_model("thinking")


def get_chat_llm_for_out():
    return get_role_model("output")


def get_chat_llm_rewrite():
    return get_role_model("rewrite")


def get_chat_llm_summary():
    return get_role_model("summary")

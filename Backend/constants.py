"""Centralised constants — trimmed from the parent system to what the chat
pipeline actually references."""

from __future__ import annotations

from enum import Enum


class SystemSignal(str, Enum):
    """Tokens passed between Agent C → Agent B via state fields."""

    NEED_INFO = "[NEED_INFO]"
    DATA_READY = "[DATA_READY]"
    KNOWLEDGE_MISSING = "[KNOWLEDGE_MISSING]"
    NONE = "NONE"

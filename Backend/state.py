"""ChatState TypedDict — trimmed to the fields the demo pipeline mutates.

Mirrors Backend/state.py of the parent project; vision/training/episodic
fields were dropped together with their nodes and tools.
"""

from __future__ import annotations

from typing import Annotated, TypedDict

from langgraph.graph.message import add_messages


class State(TypedDict):
    summary: str
    patient_info: dict | None
    messages: Annotated[list, add_messages]
    injected_time: str
    final_response: str
    global_status: str
    history: str
    diagnosis: str
    train_plan: str
    current_plan: str
    active_action: str
    supervisor_intent: str
    exercise_knowledge: str

"""LangGraph StateGraph definition — main multi-agent pipeline.

Node flow (vision/training nodes of the parent project are pruned):

    __start__ → initialize_state → rewrite_node → thinking_node
        →(conditional: tools | data_pre_node)
        tools → thinking_node (loop)  |  data_pre_node → agent_b → summarize_node → END

Lazy compilation via get_main_graph() so no LLM client is built at import time.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph
from langgraph.prebuilt import ToolNode

from nodes import (
    agent_b_node,
    data_pre_node,
    initialize_state,
    rewrite_node,
    summarize_node,
    thinking_node,
    tools_condition_node,
)
from state import State
from tools import tools_for_main

logger = logging.getLogger(__name__)

_main_graph: Optional[Any] = None


def _build_main_workflow():
    """Construct and compile the main StateGraph (called once, lazily)."""
    toolsnode_for_main = ToolNode(tools_for_main)

    main_workflow = StateGraph(State)
    main_workflow.add_node("initialize_state", initialize_state)
    main_workflow.add_node("rewrite_node", rewrite_node)
    main_workflow.add_node("thinking_node", thinking_node)
    main_workflow.add_node("tools", toolsnode_for_main)
    main_workflow.add_node("data_pre_node", data_pre_node)
    main_workflow.add_node("agent_b", agent_b_node)
    main_workflow.add_node("summarize_node", summarize_node)

    main_workflow.add_edge("__start__", "initialize_state")
    main_workflow.add_edge("initialize_state", "rewrite_node")
    main_workflow.add_edge("rewrite_node", "thinking_node")
    main_workflow.add_conditional_edges(
        "thinking_node",
        tools_condition_node,
        {"tools": "tools", "data_pre_node": "data_pre_node"},
    )
    main_workflow.add_edge("tools", "thinking_node")
    main_workflow.add_edge("data_pre_node", "agent_b")
    main_workflow.add_edge("agent_b", "summarize_node")
    main_workflow.add_edge("summarize_node", END)

    checkpointer = MemorySaver()
    return main_workflow.compile(checkpointer=checkpointer)


def get_main_graph():
    """Lazy accessor for the compiled main StateGraph."""
    global _main_graph
    if _main_graph is None:
        _main_graph = _build_main_workflow()
        logger.info("Main graph compiled (lazy init).")
    return _main_graph


def __getattr__(name: str):
    """Module-level __getattr__ — resolve Main_graph lazily."""
    if name == "Main_graph":
        return get_main_graph()
    raise AttributeError(f"module 'graph' has no attribute {name!r}")

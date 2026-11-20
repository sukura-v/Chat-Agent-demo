"""Chat router — /analyze SSE streaming + session CRUD.

Faithful trim of routers/chat_router.py: the consent-based local-rule fallback,
the provenance service and the durable consultation plumbing are removed;
the streaming protocol (status / chat / action channels, thinking-tag
filtering, history hydration window) is preserved exactly so the original
frontend chat experience works unchanged.
"""

from __future__ import annotations

import json
import logging
from contextlib import aclosing

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessage, HumanMessage, RemoveMessage
from langgraph.graph.message import REMOVE_ALL_MESSAGES
from pydantic import BaseModel
from sqlalchemy.orm import Session

from chat_repository import ChatRepository
from database import get_db, get_db_yield
from demo_auth import ActorContext, get_actor_context
from graph import get_main_graph
from llm import CHAT_MODEL_NAME
from models import ChatSession, Patient
from tools import get_beijing_time

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])

THINK_OPEN = "<think>"
THINK_CLOSE = "</think>"


class _VisibleResponse:
    """Filter reasoning delimiters even when they span model chunks."""

    def __init__(self):
        self._pending = ""
        self._hidden = False

    def feed(self, chunk: str, *, final: bool = False) -> str:
        self._pending += chunk
        visible = []
        while self._pending:
            delimiter = THINK_CLOSE if self._hidden else THINK_OPEN
            position = self._pending.find(delimiter)
            if position >= 0:
                if not self._hidden:
                    visible.append(self._pending[:position])
                self._pending = self._pending[position + len(delimiter):]
                self._hidden = not self._hidden
                continue
            retained = 0 if final else max(
                (length for length in range(1, len(delimiter))
                 if self._pending.endswith(delimiter[:length])), default=0,
            )
            if not self._hidden:
                visible.append(self._pending[:-retained] if retained else self._pending)
            self._pending = self._pending[-retained:] if retained else ""
            break
        return "".join(visible)


def _authorise_chat_patient(
    db: Session,
    actor: ActorContext,
    patient_id: int,
) -> Patient:
    if actor.role == "patient" and actor.patient_id != patient_id:
        raise HTTPException(status_code=403, detail="患者只能访问自己的会诊")
    patient = db.query(Patient).filter(
        Patient.id == patient_id,
        Patient.doctor_id == actor.doctor_id,
    ).one_or_none()
    if patient is None:
        raise HTTPException(status_code=404, detail="患儿不存在或不属于当前医生")
    return patient


def _authorise_thread(
    db: Session, actor: ActorContext, thread_id: str, *, patient_id: int | None = None,
) -> ChatSession | None:
    thread = db.query(ChatSession).filter(ChatSession.thread_id == thread_id).one_or_none()
    if thread is None:
        return None
    if thread.doctor_id != actor.doctor_id:
        raise HTTPException(status_code=403, detail="会诊不属于当前医生")
    if actor.role == "patient" and thread.patient_id != actor.patient_id:
        raise HTTPException(status_code=403, detail="患者只能访问自己的会诊")
    if patient_id is not None and thread.patient_id != patient_id:
        raise HTTPException(status_code=403, detail="会诊与请求患儿不匹配")
    return thread


# ---------------------------------------------------------------------------
# request model
# ---------------------------------------------------------------------------

class AnalysisRequest(BaseModel):
    patient_id: int
    doctor_id: int
    user_role: str
    text: str
    thread_id: str = "default_thread"
    mode: str = "consult"


# ---------------------------------------------------------------------------
# SSE streaming — main LangGraph pipeline
# ---------------------------------------------------------------------------

@router.post("/analyze")
async def handle_request(
    request: AnalysisRequest,
    db: Session = Depends(get_db_yield),
    actor: ActorContext = Depends(get_actor_context),
):
    # Identity from the signed token is authoritative; reject body impersonation.
    if request.doctor_id != actor.doctor_id:
        raise HTTPException(
            status_code=403,
            detail="doctor_id in request body does not match the authenticated token",
        )
    patient = _authorise_chat_patient(db, actor, request.patient_id)
    p_id = request.patient_id
    d_id = actor.doctor_id
    t_id = request.thread_id
    _authorise_thread(db, actor, t_id, patient_id=p_id)
    current_time = get_beijing_time()

    config = {
        "configurable": {
            "patient_id": p_id,
            "doctor_id": d_id,
            "user_role": actor.role,
            "thread_id": t_id,
            "mode": request.mode,
            "injected_time": current_time,
        }
    }

    # MySQL supplies the same bounded history projection in both modes.
    chat_repository = ChatRepository(db)
    try:
        recent_history = chat_repository.get_owned_history_snapshot(t_id, d_id, p_id, limit=6)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail="会诊与请求患儿不匹配") from exc
    if not chat_repository.create_or_update_chat_session(t_id, p_id, d_id, f"会诊会话 {current_time[:10]}"):
        raise HTTPException(status_code=500, detail="会话保存失败")
    user_provenance = {
        "source_type": "USER_MESSAGE",
        "user_role": actor.role,
        "created_at": current_time,
    }
    if not chat_repository.write_chat_log(
        t_id, "user", request.text, message_provenance=user_provenance
    ):
        raise HTTPException(status_code=500, detail="会诊请求保存失败")

    hydrated_messages = []
    for h in recent_history:
        if h["role"] == "user":
            hydrated_messages.append(HumanMessage(content=h["content"]))
        else:
            ai_text = h["content"]
            if h.get("ui_type"):
                ai_text += (
                    f"\n[系统底表注记：系统在此时已向用户成功下发了"
                    f"图卡组件 {h['ui_type']}]"
                )
            hydrated_messages.append(AIMessage(content=ai_text))

    hydrated_messages.append(HumanMessage(content=request.text))

    initial_state = {
        # Replace the hydrated window in the per-thread graph cache. The cache
        # still owns its rolling summary, not another copy of DB history.
        "messages": [RemoveMessage(id=REMOVE_ALL_MESSAGES), *hydrated_messages],
        "patient_info": None,
        "global_status": None,
        "final_response": "",
        "injected_time": current_time,
        "mode": request.mode,
    }

    async def stream_generator():
        visible_response = _VisibleResponse()
        full_ai_response = ""

        def make_sse(type_name: str, content: str = "", extra: dict = None):
            payload = {"type": type_name, "content": content}
            if extra:
                payload.update(extra)
            return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

        main_graph = get_main_graph()
        try:
            async with aclosing(main_graph.astream_events(
                initial_state, config=config, version="v2"
            )) as graph_events:
                async for event in graph_events:
                    event_type = event["event"]
                    node_name = event["metadata"].get("langgraph_node", "")

                    # ── Channel A: Status ──
                    if event_type == "on_tool_start":
                        if event["name"] == "load_exercise_knowledge":
                            yield make_sse("status", "📚 正在加载训练动作临床知识...")
                        if event["name"] == "get_history_records":
                            yield make_sse("status", "⏳ 正在查询历史表现记录...")
                        if event["name"] == "get_train_plan":
                            yield make_sse("status", "⏳ 正在查询今日训练计划...")
                        if event["name"] == "search_and_bind_patient":
                            yield make_sse("status", "🔎 正在核对患者档案...")
                        if event["name"] == "get_global_patients_status":
                            yield make_sse("status", "🌐 正在汇总全景考勤状态...")
                    elif event_type == "on_chain_start":
                        if event["name"] == "agent_b":
                            yield make_sse("status", "✅ 诊断分析完成")

                    # ── Channel A: Text streaming ──
                    elif event_type == "on_chat_model_stream":
                        if node_name in ["agent_b"]:
                            chunk = (
                                event["data"]["chunk"].content
                                if hasattr(event["data"]["chunk"], "content")
                                else ""
                            )
                            if not chunk:
                                continue

                            chunk = visible_response.feed(chunk)
                            if chunk:
                                full_ai_response += chunk
                                yield make_sse("chat", chunk)

                    # ── Channel C: Implicit commands ──
                    elif event_type == "on_tool_end":
                        if event["name"] == "search_and_bind_patient":
                            try:
                                raw_output = event["data"].get("output", "{}")
                                # LangGraph v2 returns ToolMessage objects — unwrap .content
                                if hasattr(raw_output, "content"):
                                    raw_output = raw_output.content
                                tool_data = json.loads(raw_output)
                                pid = tool_data.get("patient_info", {}).get("id")
                                if pid:
                                    yield make_sse(
                                        "action",
                                        "",
                                        {
                                            "action_type": "SELECT_PATIENT",
                                            "id": pid,
                                        },
                                    )
                            except Exception:
                                logger.warning(
                                    "[search_and_bind_patient SSE 下发失败]",
                                    exc_info=True,
                                )
        except Exception:
            logger.exception("SSE stream 致命错误")
            yield make_sse("status", "系统内部错误，请重试")
            return

        tail = visible_response.feed("", final=True)
        if tail:
            full_ai_response += tail
            yield make_sse("chat", tail)

        # ── Data provenance piggyback ──
        # The live stream carries the same provenance snapshot that is persisted
        # to chat_logs, so the last bubble can render model/policy pills.
        ai_provenance = {
            "source_type": "AI_RESPONSE",
            "model_version": CHAT_MODEL_NAME,
            "prompt_policy_version": "v2026.1-clinical-guidance",
            "retrieval_source_ids": [],
            "retrieval_trace_status": "NOT_CAPTURED",
            "disclaimer": (
                "免责声明：本回复由多智能体临床专家系统辅助生成，"
                "仅供家庭康复指导参考，不具正式医嘱法律效力。"
            ),
        }
        yield make_sse("chat", "", {"provenance": ai_provenance})

        # ── End-of-stream dual-write ──
        if full_ai_response:
            try:
                with get_db() as background_db:
                    final_repository = ChatRepository(background_db)
                    final_repository.write_chat_log(
                        config["configurable"]["thread_id"],
                        "ai",
                        full_ai_response.strip(),
                        message_provenance=ai_provenance,
                    )
            except Exception:
                logger.warning(
                    "Failed to background save AI response to ChatLog",
                    exc_info=True,
                )

    return StreamingResponse(
        stream_generator(), media_type="text/event-stream"
    )


# ---------------------------------------------------------------------------
# Session CRUD
# ---------------------------------------------------------------------------

@router.get("/api/chat/sessions")
def api_get_chat_sessions(
    patient_id: int,
    doctor_id: int,
    db: Session = Depends(get_db_yield),
    actor: ActorContext = Depends(get_actor_context),
):
    if doctor_id != actor.doctor_id:
        raise HTTPException(
            status_code=403,
            detail="doctor_id does not match the authenticated token",
        )
    _authorise_chat_patient(db, actor, patient_id)
    chat_repository = ChatRepository(db)
    return {
        "code": 200,
        "data": chat_repository.get_chat_sessions(patient_id, doctor_id),
    }


@router.post("/api/chat/sessions")
def api_create_chat_session(
    req: dict,
    db: Session = Depends(get_db_yield),
    actor: ActorContext = Depends(get_actor_context),
):
    doctor_id = req.get("doctor_id")
    if doctor_id is None:
        doctor_id = actor.doctor_id
    else:
        try:
            if int(doctor_id) != actor.doctor_id:
                raise HTTPException(
                    status_code=403,
                    detail="doctor_id does not match the authenticated token",
                )
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="doctor_id must be an integer")
    thread_id = req.get("thread_id")
    if not thread_id:
        raise HTTPException(status_code=400, detail="thread_id is required")
    patient_id = req.get("patient_id")
    if patient_id is None:
        raise HTTPException(status_code=400, detail="patient_id is required")
    try:
        patient_id = int(patient_id)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="patient_id must be an integer") from exc
    _authorise_chat_patient(db, actor, patient_id)
    title = req.get("title", "会诊聊天")
    _authorise_thread(db, actor, thread_id, patient_id=patient_id)
    chat_repository = ChatRepository(db)
    success = chat_repository.create_or_update_chat_session(
        thread_id, patient_id, actor.doctor_id, title
    )
    return {"code": 200 if success else 500}


@router.get("/api/chat/history/{thread_id}")
def api_get_chat_history(
    thread_id: str,
    db: Session = Depends(get_db_yield),
    actor: ActorContext = Depends(get_actor_context),
):
    # Scope by doctor: reject threads owned by another doctor (IDOR fix).
    _authorise_thread(db, actor, thread_id)
    chat_repository = ChatRepository(db)
    history = chat_repository.get_chat_history(thread_id)
    return {"code": 200, "data": history}


@router.delete("/api/chat/sessions/{thread_id}")
def api_delete_chat_session(
    thread_id: str,
    db: Session = Depends(get_db_yield),
    actor: ActorContext = Depends(get_actor_context),
):
    _authorise_thread(db, actor, thread_id)
    chat_repository = ChatRepository(db)
    success = chat_repository.delete_chat_session(thread_id)
    if success:
        return {"code": 200, "message": "删除成功"}
    return {"code": 500, "message": "删除失败"}

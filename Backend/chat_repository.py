"""Chat repository — session CRUD + dual-track log persistence.

Faithful trim of repositories/chat_repo.py: the durable-consultation outbox,
AnswerSections projection filtering and Chroma episodic cleanup are dropped
together with their subsystems; every remaining method keeps its signature.
"""

from __future__ import annotations

import logging

from sqlalchemy import func
from sqlalchemy.orm import Session

from models import ChatLog, ChatSession

logger = logging.getLogger(__name__)


class ChatRepository:
    """Chat session and message log data access."""

    def __init__(self, db: Session):
        self.db = db

    # ------------------------------------------------------------------
    # session CRUD
    # ------------------------------------------------------------------

    def get_owned_session(
        self, thread_id: str, doctor_id: int, patient_id: int
    ) -> ChatSession | None:
        """A thread's subject is immutable across creation and reads."""
        session = (
            self.db.query(ChatSession)
            .filter(ChatSession.thread_id == thread_id)
            .one_or_none()
        )
        if session is not None and (
            session.doctor_id != doctor_id or session.patient_id != patient_id
        ):
            raise PermissionError("chat session is outside the requested scope")
        return session

    def create_or_update_chat_session(
        self, thread_id: str, patient_id: int, doctor_id: int, title: str
    ) -> bool:
        """Upsert a chat session — create if new, bump updated_at if exists."""
        session = self.get_owned_session(thread_id, doctor_id, patient_id)
        try:
            if not session:
                new_session = ChatSession(
                    thread_id=thread_id,
                    patient_id=patient_id,
                    doctor_id=doctor_id,
                    title=title,
                )
                self.db.add(new_session)
            else:
                session.updated_at = func.now()
            self.db.commit()
            return True
        except Exception:
            self.db.rollback()
            logger.exception("Error touching chat session")
            return False

    def get_chat_sessions(self, patient_id: int, doctor_id: int) -> list[dict]:
        """List chat sessions for a patient (newest first)."""
        sessions = (
            self.db.query(ChatSession)
            .filter(
                ChatSession.patient_id == patient_id,
                ChatSession.doctor_id == doctor_id,
            )
            .order_by(ChatSession.updated_at.desc())
            .all()
        )
        return [
            {
                "id": s.id,
                "thread_id": s.thread_id,
                "title": s.title,
                "updated_at": (
                    s.updated_at.strftime("%Y-%m-%d %H:%M:%S") if s.updated_at else ""
                ),
            }
            for s in sessions
        ]

    def delete_chat_session(self, thread_id: str) -> bool:
        """Cascade-delete a chat session and all child rows."""
        try:
            self.db.query(ChatLog).filter(ChatLog.thread_id == thread_id).delete()
            self.db.query(ChatSession).filter(
                ChatSession.thread_id == thread_id
            ).delete()
            self.db.commit()
            return True
        except Exception:
            self.db.rollback()
            logger.exception("Error deleting chat session %s", thread_id)
            return False

    # ------------------------------------------------------------------
    # chat log
    # ------------------------------------------------------------------

    def get_chat_history(self, thread_id: str) -> list[dict]:
        """Ordered chat log."""
        logs = (
            self.db.query(ChatLog)
            .filter(ChatLog.thread_id == thread_id)
            .order_by(ChatLog.created_at.asc(), ChatLog.id.asc())
            .all()
        )
        return [
            {
                "id": l.id,
                "role": l.role,
                "content": l.content,
                "ui_type": l.ui_type,
                "ui_payload": l.ui_payload,
                "message_provenance": l.message_provenance or {},
                "created_at": (
                    l.created_at.strftime("%Y-%m-%d %H:%M:%S") if l.created_at else None
                ),
            }
            for l in logs
        ]

    def get_owned_history_snapshot(
        self,
        thread_id: str,
        doctor_id: int,
        patient_id: int,
        *,
        limit: int = 20,
    ) -> tuple[dict, ...]:
        """Load one bounded, ownership-checked history snapshot for a turn."""
        if limit < 1 or limit > 100:
            raise ValueError("history snapshot limit must be between 1 and 100")
        if self.get_owned_session(thread_id, doctor_id, patient_id) is None:
            return ()
        logs = (
            self.db.query(ChatLog)
            .filter(ChatLog.thread_id == thread_id)
            .order_by(ChatLog.created_at.desc(), ChatLog.id.desc())
            .limit(limit)
            .all()
        )
        return tuple(
            {"role": log.role, "content": log.content, "ui_type": log.ui_type}
            for log in reversed(logs)
        )

    def write_chat_log(
        self,
        thread_id: str,
        role: str,
        content: str,
        ui_type: str | None = None,
        ui_payload: dict | None = None,
        message_provenance: dict | None = None,
    ) -> bool:
        """Persist a single chat message with data provenance."""
        new_log = ChatLog(
            thread_id=thread_id,
            role=role,
            content=content,
            ui_type=ui_type,
            ui_payload=ui_payload,
            message_provenance=message_provenance or {},
        )
        try:
            self.db.add(new_log)
            self.db.commit()
            return True
        except Exception:
            self.db.rollback()
            logger.exception("Error saving chat log")
            return False

"""SQLite database engine — standalone replacement for the Docker MySQL stack.

The original system ran on MySQL 8.0 behind docker-compose. For the portable
demo the same SQLAlchemy session contract is kept, but the engine points at a
local SQLite file so `pip install` + `python start.py` is all it takes.

Session helpers mirror Backend/database.py of the parent project:
    get_db()        — context manager for short-lived reads/writes
    get_db_yield()  — FastAPI Depends-style generator
"""

from __future__ import annotations

import os
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH = os.environ.get("DEMO_DB_PATH") or os.path.join(DATA_DIR, "chat_agent_demo.db")

engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    """Declarative base shared by every demo table."""


@contextmanager
def get_db():
    """Context-managed session (mirrors the parent project's helper)."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def get_db_yield():
    """FastAPI dependency with an explicit commit boundary for streaming reads."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

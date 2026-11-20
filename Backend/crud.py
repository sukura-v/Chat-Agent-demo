"""SQLmanager — SQLite demo facade with the parent system's method contracts.

Every method keeps the parent's name, signature and return shape
(repositories/patient_repo.py, repositories/training_repo.py), minus the
CareTeam assignment scope (demo doctors own their patients directly).
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from models import Doctor, Patient, TrainingPlan, TrainingRecord

logger = logging.getLogger(__name__)


def _ensure_doctor_scope(db: Session, doctor_id: int, patient_id: int) -> Patient | None:
    return (
        db.query(Patient)
        .filter(Patient.id == patient_id, Patient.doctor_id == doctor_id)
        .one_or_none()
    )


def calculate_patient_age(birth_date) -> int | None:
    if not birth_date:
        return None
    today = datetime.now().date()
    return today.year - birth_date.year - (
        (today.month, today.day) < (birth_date.month, birth_date.day)
    )


class SQLmanager:
    """Database access facade used by nodes.py and tools.py."""

    def __init__(self, db_session: Session) -> None:
        self.db = db_session

    # ------------------------------------------------------------------
    # Patient
    # ------------------------------------------------------------------

    def get_basic_patient_info(self, doctor_id: int, patient_id: int) -> dict | None:
        patient = _ensure_doctor_scope(self.db, doctor_id, patient_id)
        if patient is None:
            return None
        age = calculate_patient_age(patient.birth_date) if patient.birth_date else patient.age
        return {
            "real_name": patient.real_name,
            "age": age,
            "medical_notes": patient.medical_notes or "",
        }

    def get_patients_by_doctor(self, doctor_id: int) -> list[dict]:
        patients = (
            self.db.query(Patient)
            .filter(Patient.doctor_id == doctor_id)
            .order_by(Patient.created_at.desc(), Patient.id.desc())
            .all()
        )
        return [
            {
                "id": p.id,
                "name": p.real_name,
                "age": calculate_patient_age(p.birth_date) if p.birth_date else p.age,
                "status": p.status,
                "diagnosis": p.medical_notes,
                "firstVisit": p.created_at.strftime("%Y-%m-%d") if p.created_at else "",
                "doctorName": "",
            }
            for p in patients
        ]

    def get_patient_by_name(self, doctor_id: int, patient_name: str) -> dict | None:
        patient = (
            self.db.query(Patient)
            .filter(
                Patient.doctor_id == doctor_id,
                Patient.real_name.like(f"%{patient_name}%"),
            )
            .first()
        )
        if not patient:
            return None
        return {
            "id": patient.id,
            "real_name": patient.real_name,
            "age": patient.age,
            "medical_notes": patient.medical_notes,
        }

    def get_macro_patients_overview(self, doctor_id: int) -> str:
        patients = self.db.query(Patient).filter(Patient.doctor_id == doctor_id).all()
        if not patients:
            return "您名下目前未绑定任何患者。"

        today = datetime.now().date()
        result_lines = ["【本医生辖下全景动态播报】"]
        for p in patients:
            today_records = (
                self.db.query(TrainingRecord)
                .filter(
                    TrainingRecord.patient_id == p.id,
                    TrainingRecord.training_time >= f"{today} 00:00:00",
                )
                .count()
            )
            status = "🟢 今日已达标" if today_records > 0 else "🔴 待训练排查"
            result_lines.append(
                f"- 患者 {p.real_name} (ID:{p.id}) | "
                f"诊断:{p.medical_notes} | 状态: {status}"
            )
        return "\n".join(result_lines)

    # ------------------------------------------------------------------
    # Training
    # ------------------------------------------------------------------

    def _history_base_query(
        self,
        doctor_id: int,
        patient_id: int,
        start_date: str | None = None,
        end_date: str | None = None,
        action_type: str | None = None,
    ):
        query = (
            self.db.query(TrainingRecord)
            .join(Patient)
            .filter(
                TrainingRecord.patient_id == patient_id,
                Patient.doctor_id == doctor_id,
            )
        )
        if start_date:
            start_value = (
                start_date
                if isinstance(start_date, datetime)
                else f"{start_date} 00:00:00"
            )
            query = query.filter(TrainingRecord.training_time >= start_value)
        if end_date:
            end_value = (
                end_date if isinstance(end_date, datetime) else f"{end_date} 23:59:59"
            )
            query = query.filter(TrainingRecord.training_time <= end_value)
        if action_type:
            query = query.filter(
                TrainingRecord.action_type.like(f"%{action_type}%")
            )
        return query

    def get_patient_distinct_actions(self, doctor_id: int, patient_id: int) -> list[str]:
        rows = (
            self._history_base_query(doctor_id, patient_id)
            .with_entities(TrainingRecord.action_type)
            .distinct()
            .all()
        )
        return [row[0] for row in rows]

    def get_dynamic_history_records(
        self,
        doctor_id: int,
        patient_id: int,
        start_date: str | None = None,
        end_date: str | None = None,
        limit: int = 10,
        action_type: str | None = None,
        sort_order: str = "DESC",
    ) -> list[TrainingRecord]:
        query = self._history_base_query(
            doctor_id, patient_id, start_date, end_date, action_type
        )
        if str(sort_order).upper() == "ASC":
            query = query.order_by(TrainingRecord.training_time.asc())
        else:
            query = query.order_by(TrainingRecord.training_time.desc())
        return query.limit(limit).all()

    def write_history(
        self,
        doctor_id: int,
        patient_id: int,
        action_type: str,
        vision_metrics: dict,
        overall_score: int,
        agent_feedback: str = "",
    ) -> TrainingRecord:
        if _ensure_doctor_scope(self.db, doctor_id, patient_id) is None:
            raise ValueError("权限错误或患者不存在：该医生无权为该患者写入记录。")
        new_record = TrainingRecord(
            patient_id=patient_id,
            training_time=datetime.now(),
            action_type=action_type,
            vision_metrics=vision_metrics,
            overall_score=overall_score,
            agent_feedback=agent_feedback,
        )
        self.db.add(new_record)
        self.db.commit()
        self.db.refresh(new_record)
        return new_record

    def get_today_active_plan(
        self, doctor_id: int, patient_id: int, today_date: str
    ) -> list[str]:
        """Active plans whose trigger time is today or earlier."""
        end_of_today = f"{today_date} 23:59:59"
        plans = (
            self.db.query(TrainingPlan)
            .join(Patient)
            .filter(
                TrainingPlan.patient_id == patient_id,
                Patient.doctor_id == doctor_id,
                TrainingPlan.is_active == True,  # noqa: E712
                TrainingPlan.next_trigger_time <= end_of_today,
            )
            .all()
        )
        return [plan.action_type for plan in plans]

    # ------------------------------------------------------------------
    # Analytics (dashboard fallback for the chart card)
    # ------------------------------------------------------------------

    def get_dashboard_data(
        self,
        doctor_id: int,
        patient_id: int,
        action_type: str | None = None,
        time_range: str = "all",
    ) -> dict | None:
        if _ensure_doctor_scope(self.db, doctor_id, patient_id) is None:
            return None
        weeks = {"1w": 1, "1m": 4, "3m": 12}.get(time_range, 12)
        since = (datetime.now() - timedelta(weeks=weeks)).strftime("%Y-%m-%d 00:00:00")

        query = self._history_base_query(doctor_id, patient_id, start_date=since)
        if action_type:
            query = query.filter(TrainingRecord.action_type.like(f"%{action_type}%"))
        records = query.order_by(TrainingRecord.training_time.asc()).all()

        buckets: dict[str, list[int]] = {}
        for record in records:
            if record.overall_score is None:
                continue
            week_key = record.training_time.strftime("%Y-%m-%d")
            buckets.setdefault(week_key, []).append(record.overall_score)

        categories = sorted(buckets.keys())[-8:]
        success_rate = [round(sum(v) / len(v), 1) for k, v in sorted(buckets.items()) if k in categories]
        return {
            "trendData": {
                "categories": categories,
                "successRate": success_rate,
            },
            "summary": {
                "total_count": len(records),
                "average_score": (
                    round(
                        sum(r.overall_score for r in records if r.overall_score is not None)
                        / max(1, len([r for r in records if r.overall_score is not None])),
                        1,
                    )
                    if any(r.overall_score is not None for r in records)
                    else 0
                ),
            },
        }

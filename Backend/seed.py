"""Demo data seeding — one doctor, two patients, 4 weeks of training records.

Run automatically by start.py (idempotent: skips when the demo doctor exists).
The synthetic history gives every tool real data to query so the multi-agent
tool-calling loop is observable end to end.
"""

from __future__ import annotations

import random
from datetime import datetime, timedelta

from crud import SQLmanager
from database import SessionLocal
from demo_auth import DEMO_PASSWORD, DEMO_USERNAME
from models import ChatSession, ChatLog, Doctor, Patient, TrainingPlan, TrainingRecord
from auth_repo import get_password_hash

ACTIONS = ["弹舌训练", "吞咽训练", "鼓腮训练", "唇肌闭合训练"]

KNOWLEDGE_HINTS = {
    "弹舌训练": "舌尖抵上颚弹击，保持下颌静止",
    "吞咽训练": "小口饮水，感受舌根咽部收缩",
    "鼓腮训练": "双腮鼓起保持 5 秒，防止漏气",
    "唇肌闭合训练": "双唇紧闭对抗阻力，保持对称",
}

FEEDBACK_POOL = [
    "今天完成得很棒，继续保持哦！",
    "比上次更稳了，小勇士加油！",
    "动作有一点点代偿，明天我们慢慢来。",
    "节奏很好，坚持就是胜利！",
]


def seed_if_empty() -> None:
    db = SessionLocal()
    try:
        if db.query(Doctor).filter(Doctor.username == DEMO_USERNAME).one_or_none():
            return

        doctor = Doctor(
            username=DEMO_USERNAME,
            password_hash=get_password_hash(DEMO_PASSWORD),
            real_name="李医生",
            department="儿童口腔康复科",
        )
        db.add(doctor)
        db.flush()

        patients_data = [
            ("xiaoxiao", "晓晓", 7, "F", "吞咽肌力弱，右侧咬合偏浅，弹舌诱发延迟。"),
            ("xuanxuan", "轩轩", 6, "M", "唇肌力量不足，鼓腮漏气，下颌运动代偿明显。"),
        ]
        patients = []
        for username, name, age, gender, notes in patients_data:
            patient = Patient(
                doctor_id=doctor.id,
                username=username,
                password_hash=get_password_hash(f"{username}-demo"),
                real_name=name,
                age=age,
                gender=gender,
                medical_notes=notes,
                birth_date=datetime.now().date() - timedelta(days=365 * age + 40),
                consent_status="granted",
            )
            db.add(patient)
            patients.append(patient)
        db.flush()

        rng = random.Random(42)
        now = datetime.now()
        for patient in patients:
            base_score = {"晓晓": 52, "轩轩": 47}[patient.real_name]
            for day in range(28, -1, -1):  # last 29 days
                train_date = now - timedelta(days=day)
                daily_actions = rng.sample(ACTIONS, k=rng.randint(2, 3))
                for slot, action in enumerate(daily_actions):
                    progressed = base_score + (29 - day) * 0.9 + rng.uniform(-7, 7)
                    score = max(20, min(97, round(progressed)))
                    record_time = train_date.replace(
                        hour=9 + slot * 3, minute=rng.randint(0, 50), second=0, microsecond=0
                    )
                    db.add(
                        TrainingRecord(
                            patient_id=patient.id,
                            action_type=action,
                            training_time=record_time,
                            vision_metrics={
                                "mouth_openness_ratio": round(rng.uniform(0.2, 0.9), 2),
                                "jaw_vertical_variance": round(rng.uniform(0, 4.5), 2),
                                "lip_seal_score": round(rng.uniform(0.4, 1.0), 2),
                                "hint": KNOWLEDGE_HINTS.get(action, ""),
                            },
                            overall_score=score,
                            agent_feedback=rng.choice(FEEDBACK_POOL),
                            training_origin="self_directed",
                        )
                    )
            # today's active plans (next_trigger_time = today morning)
            for slot, action in enumerate(ACTIONS[:3]):
                db.add(
                    TrainingPlan(
                        patient_id=patient.id,
                        action_type=action,
                        cron_expression="0 9,12,16 * * *",
                        next_trigger_time=now.replace(hour=8, minute=0, second=0, microsecond=0),
                        is_active=True,
                        daily_target_sessions=2,
                    )
                )

        db.commit()
        print(
            "[seed] demo data ready: 1 doctor (%s/%s), %d patients, 29 days of records"
            % (DEMO_USERNAME, DEMO_PASSWORD, len(patients))
        )
    finally:
        db.close()

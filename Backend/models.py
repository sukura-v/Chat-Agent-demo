"""ORM models — trimmed projection of the parent system's tables.

Column definitions follow Backend/models.py of the full project (the
`BigInteger().with_variant(Integer, "sqlite")` pattern was already used there,
so SQLite works natively). Only the tables the chat pipeline touches are kept:

    doctors / patients / training_records / training_plans
    chat_sessions / chat_logs

Relationships pointing at dropped tables are pruned; join semantics used by
the tools (TrainingRecord⨝Patient, TrainingPlan⨝Patient) are preserved.
"""

from __future__ import annotations

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    Column,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from database import Base

# SQLite-safe big-integer primary keys (same trick as the parent project).
BigIntegerVariant = BigInteger().with_variant(Integer, "sqlite")


class Doctor(Base):
    """医生信息表模型"""

    __tablename__ = "doctors"

    id = Column(
        BigIntegerVariant,
        primary_key=True,
        autoincrement=True,
        comment="医生唯一ID",
    )
    username = Column(String(50), nullable=False, unique=True, comment="登录账号")
    password_hash = Column(String(255), nullable=False, comment="加密后的密码")
    real_name = Column(String(50), nullable=False, comment="医生真实姓名")
    department = Column(String(100), default="康复科", comment="所属科室")
    is_active = Column(Boolean, nullable=False, default=True, comment="账号是否允许登录")
    created_at = Column(DateTime, default=func.now(), comment="注册时间")

    patients = relationship("Patient", back_populates="doctor")


class Patient(Base):
    """患者信息表模型"""

    __tablename__ = "patients"

    id = Column(
        BigIntegerVariant,
        primary_key=True,
        autoincrement=True,
        comment="患者唯一ID",
    )
    doctor_id = Column(
        BigIntegerVariant,
        ForeignKey("doctors.id", ondelete="RESTRICT"),
        nullable=False,
        comment="主治医生ID (数据隔离关键)",
    )
    username = Column(String(50), nullable=False, unique=True, comment="患者端登录账号")
    password_hash = Column(String(255), nullable=False, default="", comment="加密后的密码")
    real_name = Column(String(50), nullable=False, comment="患者姓名")
    age = Column(Integer, nullable=False, comment="患者年龄")
    gender = Column(Enum("M", "F", "O"), comment="性别")
    medical_notes = Column(Text, comment="医生填写的初始诊断/病历备注")
    birth_date = Column(Date, nullable=True, comment="出生日期")
    guardian_name = Column(String(50), nullable=True, comment="监护人姓名")
    guardian_phone = Column(String(30), nullable=True, comment="监护人联系电话")
    consent_status = Column(String(20), nullable=False, default="granted", comment="监护人授权状态")
    status = Column(String(20), nullable=False, default="active", comment="档案状态")
    check_in_streak = Column(Integer, nullable=False, default=0, comment="当前连续签到天数")
    total_stars = Column(Integer, nullable=False, default=0, comment="累计成长星总数")
    created_at = Column(DateTime, default=func.now(), comment="建档时间")

    doctor = relationship("Doctor", back_populates="patients")
    training_records = relationship(
        "TrainingRecord", back_populates="patient", cascade="all, delete-orphan"
    )
    training_plans = relationship(
        "TrainingPlan", back_populates="patient", cascade="all, delete-orphan"
    )


class TrainingRecord(Base):
    """历史训练记录表模型"""

    __tablename__ = "training_records"

    id = Column(
        BigIntegerVariant,
        primary_key=True,
        autoincrement=True,
        comment="记录唯一ID",
    )
    patient_id = Column(
        BigIntegerVariant,
        ForeignKey("patients.id", ondelete="CASCADE"),
        nullable=False,
        comment="所属患者ID",
    )
    action_type = Column(String(50), nullable=False, comment="动作类型(如: 吹纸, 弹舌, 吞咽)")
    training_time = Column(DateTime, default=func.now(), comment="训练发生时间")
    vision_metrics = Column(JSON, nullable=False, default=dict, comment="视觉模型传来的结构化评分")
    overall_score = Column(
        Integer, nullable=True, default=None, comment="本次训练综合分；未评估为 NULL"
    )
    agent_feedback = Column(Text, comment="魔法教练Agent当时给患者生成的文字反馈")
    data_provenance = Column(
        String(20), nullable=False, default="real", comment="数据来源：real 或 synthetic"
    )
    training_origin = Column(String(20), nullable=False, default="self_directed")

    patient = relationship("Patient", back_populates="training_records")

    __table_args__ = (
        Index("idx_patient_time", "patient_id", text("training_time DESC")),
    )


class TrainingPlan(Base):
    """训练计划与提醒表模型"""

    __tablename__ = "training_plans"

    id = Column(
        BigIntegerVariant,
        primary_key=True,
        autoincrement=True,
        comment="计划唯一ID",
    )
    patient_id = Column(
        BigIntegerVariant,
        ForeignKey("patients.id", ondelete="CASCADE"),
        nullable=False,
        comment="所属患者ID",
    )
    action_type = Column(String(50), nullable=False, comment="需提醒的动作类型")
    cron_expression = Column(String(100), nullable=False, comment="定时规律表达式")
    next_trigger_time = Column(DateTime, nullable=False, comment="下一次需要提醒的确切时间")
    is_active = Column(Boolean, default=True, comment="计划是否激活")
    status = Column(String(20), nullable=False, default="active")
    weekdays = Column(JSON, nullable=True, default=list)
    daily_target_sessions = Column(Integer, nullable=False, default=1)
    suggested_time_start = Column(String(5), nullable=True)
    suggested_time_end = Column(String(5), nullable=True)

    patient = relationship("Patient", back_populates="training_plans")


class ChatSession(Base):
    """会话池表：承接 State Hydration 机制，保存快照与元信息"""

    __tablename__ = "chat_sessions"

    id = Column(BigIntegerVariant, primary_key=True, autoincrement=True)
    thread_id = Column(String(50), unique=True, nullable=False, comment="全局穿透的会话ID")
    patient_id = Column(
        BigIntegerVariant, ForeignKey("patients.id", ondelete="CASCADE"), nullable=False
    )
    doctor_id = Column(
        BigIntegerVariant, ForeignKey("doctors.id", ondelete="CASCADE"), nullable=False
    )
    title = Column(String(100), default="新的会诊会话", comment="系统分配的通用标题")
    summary_snapshot = Column(Text, nullable=True, comment="该会话剥离时的全局摘要备份")
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class ChatLog(Base):
    """聊天记录表(包含双轨分离存储：纯文本与UI渲染参数)"""

    __tablename__ = "chat_logs"

    id = Column(BigIntegerVariant, primary_key=True, autoincrement=True)
    thread_id = Column(
        String(50), ForeignKey("chat_sessions.thread_id", ondelete="CASCADE"), nullable=False
    )
    role = Column(String(20), nullable=False, comment="角色: user/ai/system")
    content = Column(Text, nullable=False, comment="纯文本对白内容")
    ui_type = Column(String(50), nullable=True, comment="前端卡片类型(如: RenderStepsCard)")
    ui_payload = Column(JSON, nullable=True, comment="前端渲染所需的JSON载荷")
    message_provenance = Column(
        JSON,
        nullable=True,
        default=dict,
        comment="数据血缘元数据快照: source_type, model_version, prompt_policy_version...",
    )
    created_at = Column(DateTime, default=func.now())

    __table_args__ = (
        Index("idx_thread_created", "thread_id", "created_at"),
    )

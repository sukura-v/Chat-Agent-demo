"""Pydantic schemas — the exact tool-argument contracts of the parent system.

Only the schemas the chat pipeline consumes are kept; signatures match
Backend/schemas/__init__.py so prompts and tool bindings stay faithful.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, AliasChoices, ConfigDict, Field


class SearchAndBindPatientArgs(BaseModel):
    patient_name: str = Field(description="你想查询名录及资料记录的目标患者具体姓名（模糊匹配）。注意：当医生提及某人但上下文中未选中患者时，必须且首选调用此工具进行上下文绑定！")


class GetGlobalPatientsStatusArgs(BaseModel):
    pass  # 纯触发器


class PatientInfoSchema(BaseModel):
    """用于系统前置预加载的患者基础上下文"""

    model_config = ConfigDict(from_attributes=True)
    real_name: str = Field(description="患者真实姓名")
    age: int = Field(description="患者年龄")
    medical_notes: str = Field(description="医生填写的初始诊断/病历备注")


class TrainingRecordInfoSchema(BaseModel):
    """用户历史训练记录返回的标准格式"""

    model_config = ConfigDict(from_attributes=True)
    record_id: int = Field(
        validation_alias=AliasChoices("record_id", "id"),
        description="病历记录的唯一ID",
    )
    action_type: str = Field(description="动作类型(如: 吹纸, 弹舌, 吞咽)")
    training_time: Any = Field(description="训练发生时间，格式为 YYYY-MM-DD HH:MM:SS")
    overall_score: Optional[int] = Field(default=None, description="综合评分（0-100）；未评估为 null")
    vision_metrics: Dict[str, Any] = Field(description="视觉模型传来的结构化评分")
    agent_feedback: Optional[str] = Field(default=None, description="历史训练时智能体情感教练的反馈意见")


class Get_history_records_schema(BaseModel):
    """提取查询历史记录所需的参数"""

    start_date: Optional[str] = Field(default=None, description="查询的开始日期，格式 YYYY-MM-DD；无明确日期范围时保持 null。赋值 start_date 就必须同时赋值 end_date。")
    end_date: Optional[str] = Field(default=None, description="查询的结束日期，格式 YYYY-MM-DD；单日查询与 start_date 保持一致。")
    limit: int = Field(
        default=10,
        description="查询的最大条数。绝对禁止把时间跨度（如'4周'）当成次数填入此字段；时间跨度查询必须换算日期并将本字段设为 1000。",
    )
    action_type: Optional[str] = Field(None, description="具体的康复动作名称，如'弹舌'。上下文特指某动作时必须传入。")
    sort_order: Literal["DESC", "ASC"] = Field(
        "DESC",
        description="排序方向。'最近的'用 DESC，'最开始的'必须用 ASC。",
    )


class TransferSchema(BaseModel):
    summary: str = Field(description="先简要总结你干了什么事，再简要分析用户意图，不超过50字")
    unresolved_info: str = Field(
        default="",
        description="【部分数据缺失说明】：工具返回的数据缺失了用户询问的细节时，将缺失内容简要写在这里。没有缺失则留空。",
    )
    system_signal: str = Field(
        default="NONE",
        description="【系统级控制信号】：正常交接填 'NONE'。用户使用指代不明的代词导致无法调工具时，必须填 'NEED_INFO'。",
    )


class LoadExerciseKnowledgeArgs(BaseModel):
    """load_exercise_knowledge 工具的参数约束"""

    exercise_id: str = Field(
        description="目标 Skill ID，例如 'tongue_click_01'、'cheek_puff_01'、'lip_pucker_01'。传入 '_shared' 可加载跨动作共享病理知识。"
    )
    knowledge_type: List[Literal["standard", "metrics", "pathology", "all"]] = Field(
        default=["all"],
        description="知识维度选择：'standard' 标准要领 / 'metrics' 量化指标 / 'pathology' 病理机制 / 'all' 全部。",
    )


class TransferToAnalyzerPayload(BaseModel):
    """Agent C 的强制交接载荷（与 transfer_to_analyzer 工具 args 同构）。"""

    summary: str = Field(description="Agent C 的中枢交接意图摘要。")
    unresolved_info: str = Field(default="", description="数据缺失说明；无缺失时留空。")
    system_signal: Literal["NONE", "NEED_INFO"] = Field(
        default="NONE",
        description="系统级控制信号：'NONE'（正常交接）或 'NEED_INFO'（需反问）。",
    )

"""Agent C tool belt — faithful subset of the parent system's tools.py.

Kept (5): transfer_to_analyzer / get_history_records / get_train_plan /
          search_and_bind_patient / get_global_patients_status /
          load_exercise_knowledge
Dropped:  search_past_conversations (ChromaDB + Ollama episodic memory),
          start_video_session (unified training-session service)

Method bodies follow the parent's implementations; the MySQL SQLmanager calls
are swapped for the demo SQLite facade in crud.py with identical semantics
(doctor scoping, difflib entity correction, date-range filters).
"""

from __future__ import annotations

import difflib
import json
import logging
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

from langchain_core.runnables.config import RunnableConfig
from langchain_core.tools import tool

from crud import SQLmanager
from database import get_db
from schemas import (
    GetGlobalPatientsStatusArgs,
    Get_history_records_schema,
    LoadExerciseKnowledgeArgs,
    SearchAndBindPatientArgs,
    TrainingRecordInfoSchema,
    TransferSchema,
)

logger = logging.getLogger(__name__)


def get_beijing_time():
    beijing_time = datetime.now(ZoneInfo("Asia/Shanghai"))
    return beijing_time.strftime("%Y-%m-%d %H:%M:%S (%A)")


@tool("transfer_to_analyzer", args_schema=TransferSchema)
def transfer_to_analyzer(summary: str, unresolved_info: str = "", system_signal: str = "NONE"):
    """
    【强制交接出口】：1.当你不需要再调用任何底层查询工具时（包括数据收集完毕、或者用户仅仅是在打招呼/闲聊），
    2.因为指代不明需要反问用户时：必须且只能调用此工具来结束你的回合，将控制权移交给下游系统。
    在 summary 中简述获取到的数据，如果是闲聊则直接填入闲聊意图。
    """
    return "[INTERNAL_SIGNAL: TRANSFER_INITIATED]"


@tool("get_history_records", args_schema=Get_history_records_schema)
def get_history_records(
    config: RunnableConfig,
    start_date: Optional[str] = None,
    end_date: str = None,
    limit: int = 10,
    action_type: Optional[str] = None,
    sort_order: str = "DESC",
) -> str:
    """
    当用户询问历史成绩、过去一段时间的表现、是否进步时，必须调用此工具。
    结合当前的系统物理时间，推断出准确的start_date,end_date
    """
    configurable = config.get("configurable", {})
    doctor_id = configurable.get("doctor_id")
    patient_id = configurable.get("patient_id")
    injected_time = configurable.get("injected_time")
    if not doctor_id or not patient_id:
        return json.dumps(
            {"status": "ERROR", "reason": "缺少必要的医生ID或患者ID，无法查询历史记录。"},
            ensure_ascii=False,
        )
    with get_db() as db:
        try:
            sql_manager = SQLmanager(db)

            corrected_action = action_type
            if action_type:
                # 1. 动态查出该患者专属的"标准词典"（他实际做过的所有动作）
                valid_actions = sql_manager.get_patient_distinct_actions(doctor_id, patient_id)

                if not valid_actions:
                    return json.dumps(
                        {
                            "status": "GLOBAL_EMPTY",
                            "reason": "该患者没有任何历史训练记录，属于纯新用户",
                            "query_action": action_type,
                            "suggestion": "请引导患者进行第一次训练",
                        },
                        ensure_ascii=False,
                    )

                # 2. 计算相似度
                closest_matches = difflib.get_close_matches(
                    action_type, valid_actions, n=1, cutoff=0.4
                )

                if closest_matches:
                    corrected_action = closest_matches[0]
                    logger.info(
                        f"[实体纠偏] 大模型输入 '{action_type}' -> 成功纠正为 '{corrected_action}'"
                    )
                else:
                    # 兜底：把做过的动作列表告诉大模型，打破它的信息茧房
                    return json.dumps(
                        {
                            "status": "ACTION_NOT_FOUND",
                            "reason": f"数据库中没有找到与「{action_type}」相关的记录",
                            "available_actions": valid_actions,
                            "suggestion": "请基于可用的动作列表向用户澄清",
                        },
                        ensure_ascii=False,
                    )

            action_desc = f"关于【{corrected_action}】的" if corrected_action else "总体的"

            if start_date and not end_date:
                end_date = injected_time
            elif end_date and not start_date:
                start_date = "2000-01-01"
            if start_date or end_date:
                time_range_desc = f"[{start_date} 至 {end_date}]"
                limit = 1000
            else:
                order_desc = "最近" if sort_order.upper() == "DESC" else "最开始"
                time_range_desc = f"[{order_desc}的 {limit} 次]"

            orm_records = sql_manager.get_dynamic_history_records(
                doctor_id,
                patient_id,
                start_date,
                end_date,
                limit,
                corrected_action,
                sort_order,
            )
            if not orm_records:
                return json.dumps(
                    {
                        "status": "RANGE_EMPTY",
                        "reason": "在指定的查询条件下，未找到任何训练记录",
                        "query_params": {
                            "time_range": time_range_desc,
                            "action_type": corrected_action or "总体",
                        },
                    },
                    ensure_ascii=False,
                )

            count_records = len(orm_records)
            scored_records = [
                record for record in orm_records if record.overall_score is not None
            ]

            if scored_records:
                avg_score = sum(record.overall_score for record in scored_records) / len(
                    scored_records
                )
                score_summary = (
                    f"其中 {len(scored_records)} 次有有效评分，平均得分是 {avg_score:.2f} 分。"
                )
            else:
                score_summary = "这些记录尚无可比较的有效评分。"

            text = (
                f"在 {time_range_desc} 的查询范围内，{action_desc}"
                f"共获取到 {count_records} 次有效训练记录，{score_summary}"
            )
            final_records = [
                TrainingRecordInfoSchema.model_validate(record).model_dump(
                    mode="json", exclude_none=True
                )
                for record in orm_records
            ]
            response = {
                "阶段总结": text,
                "抽样明细": final_records,
            }
            return json.dumps(response, ensure_ascii=False)
        except Exception as e:
            logger.error(f"历史查询工具内部崩溃: {str(e)}")
            return json.dumps(
                {"status": "ERROR", "reason": "数据库查询发生异常，未获取到历史记录"},
                ensure_ascii=False,
            )


@tool
def get_train_plan(config: RunnableConfig) -> str:
    """
    当用户询问患者今天的训练计划、接下来需要做什么时，必须调用此工具获取。
    """
    configurable = config.get("configurable", {})
    doctor_id = configurable.get("doctor_id")
    patient_id = configurable.get("patient_id")

    if not doctor_id or not patient_id:
        return "缺少必要的医生ID或患者ID，无法查询训练计划。"

    try:
        # 从图的最早期入口同步提取时间，防止跨零点延迟
        injected_time = configurable.get("injected_time", "")
        current_date = injected_time[:10] if injected_time else get_beijing_time()[:10]

        with get_db() as db:
            sql_manager = SQLmanager(db)
            plans = sql_manager.get_today_active_plan(doctor_id, patient_id, current_date)
            if not plans:
                return "[NO_PLAN_FOUND]今天没有安排任何康复训练计划，或者计划已全部完成。"

            return json.dumps({"今日计划": plans}, ensure_ascii=False)
    except Exception as e:
        logger.error(f"计划查询工具内部崩溃: {str(e)}")
        return "数据库查询发生异常，未获取到训练计划。"


@tool("search_and_bind_patient", args_schema=SearchAndBindPatientArgs)
def search_and_bind_patient(config: RunnableConfig, patient_name: str) -> str:
    """
    当医生在谈话中提及寻找某个人，但上下文中没有明确指派对象时，必须首选调用该工具！
    根据模糊姓名查出该患者的精准档案资料，并将结果状态注入回系统中。
    """
    configurable = config.get("configurable", {})
    doctor_id = configurable.get("doctor_id")
    if not doctor_id:
        return "异常：缺少医生凭证！"

    with get_db() as db:
        sql_manager = SQLmanager(db)
        patient = sql_manager.get_patient_by_name(doctor_id, patient_name)
        if not patient:
            return f"未能找到名为「{patient_name}」且属于您的患者，请确认名字是否无误。"

        # 将成功对象序列化
        return json.dumps({"patient_info": patient}, ensure_ascii=False)


@tool("get_global_patients_status", args_schema=GetGlobalPatientsStatusArgs)
def get_global_patients_status(config: RunnableConfig) -> str:
    """
    当医生询问"谁没有做训练"、"今天大家表现如何"这种宏观视角的全局状态时使用。
    一次性拉取本医生辖下所有的患者考勤状况。
    """
    configurable = config.get("configurable", {})
    doctor_id = configurable.get("doctor_id")
    if not doctor_id:
        return "缺少医生维度信息，无法展示全景图。"

    with get_db() as db:
        sql_manager = SQLmanager(db)
        overview = sql_manager.get_macro_patients_overview(doctor_id)
        return json.dumps({"global_status": overview}, ensure_ascii=False)


# ── Skill 知识文件系统（单一共享服务）─────────────────────────────────────
from knowledge_service import load_exercise_knowledge as _load_exercise_knowledge  # noqa: E402


@tool("load_exercise_knowledge", args_schema=LoadExerciseKnowledgeArgs)
def load_exercise_knowledge(
    exercise_id: str,
    knowledge_type: list = None,
    mode: str = "conversation",
) -> str:
    """
    【发力要领/评估标准/异常诊断知识加载器】：当询问动作怎么做、标准是什么、
    视觉模型指出的异常是什么原因时调用。按需加载指定训练 Skill 的临床知识。
    """
    return _load_exercise_knowledge(exercise_id, knowledge_type or ["all"], mode)


tools_for_main = [
    get_history_records,
    transfer_to_analyzer,
    get_train_plan,
    search_and_bind_patient,
    get_global_patients_status,
    load_exercise_knowledge,
]

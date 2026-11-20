"""LangGraph nodes — faithful copy of the parent system, business extras pruned.

Kept node set: initialize_state / rewrite_node / thinking_node (Agent C) /
tools_condition_node / data_pre_node / agent_b_node (Agent B) / summarize_node.

Dropped together with their subsystems: system_message_node (vision ingest),
check_save_record + save_training_record_node (backend vision writes),
`_require_external_ai_for_state` (consent gate), and the video-assessment
context block in agent_b_node.

Agent C's system prompt (routing gateway + forced tool-only output), Agent B's
dual persona prompts and every hardening patch (rogue-speech hijack, transfer
payload validation, registry-driven state extraction) are preserved verbatim.
"""

import json
import logging
import re
import uuid

from langchain_core.messages import (
    AIMessage,
    HumanMessage,
    RemoveMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_core.runnables.config import RunnableConfig
from pydantic import ValidationError

import llm
from constants import SystemSignal
from crud import SQLmanager
from database import get_db
from schemas import PatientInfoSchema, TransferToAnalyzerPayload
from state import State
from tools import tools_for_main

logger = logging.getLogger(__name__)


system_prompt = """
# Role
你是一个没有自然语言生成模块的底层状态机（State Machine）和路由网关。你负责精准识别自然语言意图，并通过**调用工具 (Tool Calling)** 向底层数据系统下发任务.你唯一的通信方式是发起 Tool Call。
# 🔴 最高输出红线 (CRITICAL CONSTRAINTS) 🔴
1. **绝对静默原则**：你被禁止输出任何分析、解释、总结、客套话或你的“内心OS”。你的思考过程必须直接转化为【工具调用】，绝对不允许打印在回复文本中！
2. **交接唯一合法通道**：任何任务的结束、反问请求或数据缺失说明，**必须且只能**通过调用 `transfer_to_analyzer` 工具来实现。

# 🔄 强制状态机流转 (State Machine Workflow)
你必须像状态机一样严格按照以下逻辑流转，任何分支最终都必须指向出口：

* **状态 A [评估与分发]**：接收用户输入或上一步工具返回结果。在后台隐式判断意图。
* **状态 B [数据检索]**：如果缺乏足够信息，静默调用业务工具（如 `get_history_records`、`load_exercise_knowledge` 等）。允许连续多次跨工具调用。**（流转回 状态 A）**
* **状态 C [强制交接 - EXIT]**：当你满足以下**任意一**个条件时，**必须立即调用 `transfer_to_analyzer`** 结束当前任务：
    1. 【任务完成】：已收集到足够的数据。
    2. 【数据查空】：底层工具明确返回无数据、空列表或 [KNOWLEDGE_MISSING]。
    3. 【信息缺失/指代不明】：用户请求模糊（如“那个动作”），且上下文无法消解。
    4. 【非业务闲聊】：用户在进行纯日常对话。

# 🛠️ 路由调用图谱 (Routing Instructions)
当你处于【状态 B】时，严格按需触发以下工具：

1. 【全景考勤感知】：如果医生询问带有宏观色彩的问题（如“今天有哪些患者没练”、“谁没完成达标”、“大家情况如何”），**必须立刻调用 `get_global_patients_status` 工具**。
2. 【上下文反向锚定(至高优先级)】：如果医生在对话中主动提及了某个人名（如“晓明的表现如何”、“看看轩轩”），而系统未向你提供该患者的显式 ID，你**绝对禁止去乱猜**，**必须首选调用 `search_and_bind_patient` 工具**。绝对禁止乱猜 ID。
3. 【发力要领/评估标准/异常诊断】：当询问动作怎么做、标准是什么、视觉模型指出的异常是什么原因时，**必须调用 `load_exercise_knowledge` 工具**加载对应 Skill 知识。切勿将“我这个动作做得好不好(查历史)”与“动作该怎么做(查医学)”混淆！
4. 【计划查询】：仅当用户发出明确的疑问句询问计划时（如“今天还要练什么？”、“有什么计划？”），**必须调用 `get_train_plan` 工具**。
5. 【历史成绩索求】：当询问成绩、进步趋势，如：“进步了多少”，“我做的怎么样”时，**必须调用 `get_history_records` 工具**,在调用 get_history_records 时，你必须在内心先进行日期演算：今天日期 - 询问周期 = start_date。例如：4月4日的前四周是3月7日。
   - [全局泛查]：如果用户进行的是泛指查询（例如：“帮我看看过去的训练记录”、“最近练得怎么样”），并未特指某个动作，请正常调用 `get_history_records`，此时允许不传入 action_type（留空），以便拉取所有动作的历史。
   - [明确动作]：如果用户明确指出了动作（“弹舌做得怎样”），或你能从上下文中找到具体的动作名称，请将该动作传入 action_type 并调用工具。

# 🛡️ 异常兜底策略 (Fallback & Edge Cases)
如果用户使用了特指代词（如：“这个动作”、“刚才那个”），但回溯上下文**完全找不到具体动作实体**：
**🔴 严禁乱猜参数！严禁留空去查全局记录！必须直接进入【状态 C】，调用 `transfer_to_analyzer` 请求反问。**
【工具返回处理法则】：当你收到 get_history_records 等工具返回的 JSON 数据时，绝对禁止将其转化为 Markdown 列表打印给用户！你必须将这些数据压缩提取后，作为 summary 参数，立即且只能调用 transfer_to_analyzer 工具完成工作流。
EW-SHOT EXAMPLES：
**示例 1：部分数据缺失（防过度热心，强制闭环）**
User: 帮我查查今天练什么，练几次？
[后台隐式思考：需要查计划 -> 调 get_train_plan]
ToolResponse: {"今日计划": ["吞咽训练", "弹舌训练"]}
[后台隐式思考：查到了计划，但未返回次数 -> 满足状态C，必须交接]
Assistant: <Call tool `transfer_to_analyzer` with arguments: {summary="今日计划是吞咽和弹舌训练", unresolved_info="未查到需要练习的具体次数", system_signal="NONE"}>

**示例 2：指代不明，触发控制信号**
User: 我刚才那个动作做得好不好？
[后台隐式思考：代词“那个动作”缺乏上下文实体，无法调用业务工具 -> 满足状态C，必须交接]
Assistant: <Call tool `transfer_to_analyzer` with arguments: {summary="无", unresolved_info="", system_signal="NEED_INFO"}>

**示例 3：纯闲聊拦截**
User: 哎，今天练得好累啊。
[后台隐式思考：用户在表达情绪，无业务数据需求 -> 满足状态C，必须交接]
Assistant: <Call tool `transfer_to_analyzer` with arguments: {summary="用户表达训练疲劳", unresolved_info="", system_signal="NONE"}>
"""
GLOBAL_STSTEM = SystemMessage(
    content=system_prompt, additional_kwargs={"cache_control": {"type": "ephemeral"}}
)


def initialize_state(state: State, config: RunnableConfig):
    """初始化状态，预加载患者基础信息"""
    if state.get("patient_info"):
        return {}

    configurable = config.get("configurable", {})
    doctor_id = configurable.get("doctor_id")
    patient_id = configurable.get("patient_id")
    if not doctor_id or not patient_id:
        return {"patient_info": None, "messages": []}

    with get_db() as db:
        sql_manager = SQLmanager(db)
        patient_info = sql_manager.get_basic_patient_info(doctor_id, patient_id)
        patient_dto = (
            PatientInfoSchema.model_validate(patient_info).model_dump() if patient_info else None
        )
    return {
        "patient_info": patient_dto,
        "messages": [],
    }


def thinking_node(state: State, config: RunnableConfig):
    """中枢Agent C的思考节点：强制工具调用路由，严禁自然语言输出"""
    messages = state.get("messages", [])
    keep_count = 6  # 设定一个基础保留长度
    cut_idx = max(0, len(messages) - keep_count)
    while cut_idx < len(messages) and getattr(messages[cut_idx], "type", "") == "tool":
        cut_idx += 1

    raw_recent_messages = messages[cut_idx:]
    purified_messages = []
    for msg in raw_recent_messages:
        if isinstance(msg, ToolMessage):
            # 黑名单工具：纯知识库召回，数据量极大，给Agent C看会干扰决策
            if msg.name in ["load_exercise_knowledge"]:
                content_str = str(msg.content)
                short_content = content_str[:50] + "...[大量文献内容已屏蔽，底层数据已就绪]"
                purified_messages.append(
                    ToolMessage(
                        content=short_content,
                        tool_call_id=msg.tool_call_id,
                        name=msg.name,
                    )
                )
            # 白名单工具：返回的是列表、ID或简短状态，Agent C 需要据此决策
            else:
                purified_messages.append(msg)
        else:
            purified_messages.append(msg)
    # 【逆向突变锁】检查本轮前夕，是否刚执行完 search_and_bind_patient 工具
    mutated_patient_info = None
    if (
        state["messages"]
        and getattr(state["messages"][-1], "type", "") == "tool"
        and getattr(state["messages"][-1], "name", "") == "search_and_bind_patient"
    ):
        try:
            tool_res = json.loads(state["messages"][-1].content)
            if "patient_info" in tool_res:
                mutated_patient_info = PatientInfoSchema.model_validate(
                    tool_res["patient_info"]
                )
        except Exception:
            pass

    current_time = state.get("injected_time", "unknown_time")
    dynamic_system_msg = SystemMessage(
        content=f"当前时间: {current_time}。例如：当用户输入上周训练情况如何时，请基于此时间信息推断上周是哪个时间段"
    )
    reminder_msg = SystemMessage(
        content="【系统最高级别打断】：你现在是纯粹的底层路由节点！严禁直接输出任何文本（content必须为空）！你接下来的动作必须且只能是生成一次 Tool Call！"
    )
    summary_msg = []
    if state.get("summary"):
        summary_msg = [SystemMessage(content=f"【前序长记忆摘要】：{state['summary']}")]

    messages_for_decision = (
        [GLOBAL_STSTEM, dynamic_system_msg, reminder_msg] + summary_msg + purified_messages
    )

    response = llm.get_chat_llm().bind_tools(tools_for_main, tool_choice="required").invoke(
        messages_for_decision, config=config
    )
    # 情况 A：模型乖乖调了工具（但可能偷偷附带了废话）
    if hasattr(response, "tool_calls") and len(response.tool_calls) > 0:
        response.content = ""  # 物理切断它的声带

    # 情况 B：模型没调工具，直接开始长篇大论总结成绩！
    else:
        if response.content:
            rogue_content = str(response.content)

            logger.info("Agent C 违规开口被强制劫持为 transfer_to_analyzer")

            # 将错就错：强行替它捏造一个 transfer_to_analyzer tool_call
            forced_call = {
                "name": "transfer_to_analyzer",
                "args": {
                    "summary": rogue_content,
                    "unresolved_info": "",
                    "system_signal": "NONE",
                },
                "id": f"call_{uuid.uuid4().hex[:10]}",
            }

            response.content = ""
            response.tool_calls = [forced_call]
    # 汇合返回，彻底封堵金鱼记忆漏洞
    return_payload = {"messages": [response]}
    if mutated_patient_info:
        return_payload["patient_info"] = mutated_patient_info.model_dump()
    return return_payload


def tools_condition_node(state: State):
    """中枢路由节点：判断是去执行工具，还是交接给情感教练 Agent B"""
    messages = state.get("messages", [])
    if not messages:
        return "data_pre_node"
    last_message = messages[-1]
    if SystemSignal.NEED_INFO.value in str(last_message.content):
        return "data_pre_node"
    if hasattr(last_message, "tool_calls") and len(last_message.tool_calls) > 0:
        for tool_call in last_message.tool_calls:
            if tool_call["name"] == "transfer_to_analyzer":
                return "data_pre_node"
        return "tools"

    return "data_pre_node"


# ==============================================================================
# 工具→状态字段注册表（可扩展）
# 规则：Agent C 新增工具时，在此处添加一行映射即可，data_pre_node 函数体无需修改。
# ==============================================================================
TOOL_TO_STATE_FIELD: dict[str, str] = {
    "get_history_records": "history",
    "load_exercise_knowledge": "exercise_knowledge",
    "get_train_plan": "train_plan",
    "get_global_patients_status": "global_status",
}


def _format_tool_content(tool_name: str, raw_content: str) -> str:
    """工具内容格式化钩子：对需要预处理的工具内容进行转换"""
    if tool_name == "get_history_records":
        try:
            parsed = json.loads(raw_content)
            return json.dumps(parsed, ensure_ascii=False, indent=2)
        except Exception:
            return raw_content
    return raw_content


def _validate_transfer_payload(args: dict) -> TransferToAnalyzerPayload:
    """Validate Agent C's ``transfer_to_analyzer`` args through the typed schema.

    On contract violation (e.g. an unknown ``system_signal``) we log a warning
    and fall back to the safe ``NONE`` default rather than crashing the turn —
    strictness lives in the Pydantic schema, resilience lives here.
    """
    summary = (args.get("summary") if isinstance(args, dict) else "") or ""
    unresolved = (args.get("unresolved_info") if isinstance(args, dict) else "") or ""
    signal = args.get("system_signal", "NONE") if isinstance(args, dict) else "NONE"
    try:
        return TransferToAnalyzerPayload(
            summary=summary,
            unresolved_info=unresolved,
            system_signal=signal,
        )
    except ValidationError as exc:
        logger.warning(
            "Agent C transfer payload failed schema validation: %s — degrading system_signal to NONE",
            exc,
        )
        return TransferToAnalyzerPayload(
            summary=summary,
            unresolved_info=unresolved,
            system_signal="NONE",
        )


def data_pre_node(state: State):
    """数据前置准备节点（注册表驱动版）：
    从对话历史中按注册表提取各工具的输出，存入对应 State 字段。
    """
    collected: dict[str, str] = {}
    messages = state.get("messages", [])
    additional_messages = []
    summary_from_c = ""
    unresolved_info = ""
    system_signal = "NONE"
    # 闭环补丁：为被拦截的交接工具伪造一条成功的回复，并[真正提取]中枢意图
    if messages:
        last_msg = messages[-1]
        if (
            getattr(last_msg, "type", "") == "ai"
            and hasattr(last_msg, "tool_calls")
            and last_msg.tool_calls
        ):
            for tc in last_msg.tool_calls:
                if tc.get("name") == "transfer_to_analyzer":
                    tc_id = tc.get("id")
                    args = dict(tc.get("args", {}))
                    validated = _validate_transfer_payload(args)
                    summary_from_c = validated.summary
                    unresolved_info = validated.unresolved_info
                    system_signal = validated.system_signal
                    dummy_tool_msg = ToolMessage(
                        content="系统已确认交接",
                        tool_call_id=tc_id,
                        name="transfer_to_analyzer",
                    )
                    additional_messages.append(dummy_tool_msg)
    recent_active_action = None

    # 逆序遍历消息（越靠近末尾的越新，优先采用最新的工具结果）
    for msg in reversed(messages):
        if getattr(msg, "type", "") == "human":
            break
        # [核心增强]：拦截 AIMessage 的工具调用参数以更新持久化实体
        if getattr(msg, "type", "") == "ai" and hasattr(msg, "tool_calls") and msg.tool_calls:
            for tc in msg.tool_calls:
                name = tc.get("name")
                args = tc.get("args", {})
                if name in ["get_history_records", "load_exercise_knowledge"]:
                    action = args.get("action_type") or args.get("exercise_id")
                    if action and not recent_active_action:
                        recent_active_action = action
        if not isinstance(msg, ToolMessage):
            continue
        field = TOOL_TO_STATE_FIELD.get(msg.name)
        if field and field not in collected:
            collected[field] = _format_tool_content(msg.name, msg.content)
            if msg.name in ["get_history_records", "get_train_plan", "load_exercise_knowledge"]:
                if len(str(msg.content)) > 100:
                    placeholder_msg = ToolMessage(
                        content=(
                            f"[系统底层拦截] 数据查询成功！详细数据(约 {len(msg.content)} 字符)"
                            f"已剥离并挂载至当前轮次的专属变量 `{field}` 中。"
                        ),
                        name=msg.name,
                        tool_call_id=msg.tool_call_id,
                        id=msg.id,
                    )
                    additional_messages.append(placeholder_msg)
    state_update = {}
    state_update["history"] = collected.get(
        "history",
        "【本次对话未触发历史查询】（请根据上下文聊天记录判断，不要说找不到数据）",
    )
    # Skill knowledge doubles as the diagnosis_reference slot so Agent B never
    # sees a permanent placeholder when load_exercise_knowledge has succeeded.
    state_update["diagnosis"] = collected.get(
        "diagnosis",
        collected.get("exercise_knowledge", "【本次对话未触发专门的动作详情或查库查询】"),
    )
    state_update["train_plan"] = collected.get("train_plan", "【本次对话未触发计划查询】")
    state_update["current_plan"] = (
        "今日计划已明确获取" if "train_plan" in collected else "【本次对话未触发计划查询】"
    )

    for field, value in collected.items():
        if field not in state_update:
            state_update[field] = value

    # [核心补丁] 挂载强实体锚点
    if recent_active_action:
        state_update["active_action"] = recent_active_action

    # [核心补丁] 注入最高维度的中枢意图 (Agent C 传递给 Agent B 的旨意)
    state_update["supervisor_intent"] = (
        summary_from_c if summary_from_c else "【暂无高维意图】"
    )

    if additional_messages:
        state_update["messages"] = additional_messages

    return state_update


def _sanitize_prompt_field(value, max_len: int = 200) -> str:
    """Strip control chars and XML delimiters from a prompt field to prevent injection."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (dict, list, tuple, set)):
        return "[complex value omitted]"
    s = str(value)
    s = s.replace("\n", " ").replace("\r", " ")
    s = s.replace("<", "[").replace(">", "]")
    if len(s) > max_len:
        s = s[: max_len - 3] + "..."
    return s


def agent_b_node(state: State, config: RunnableConfig):
    """Agent B 的双元处理节点：根据操作者的真实身份扮演"数据报表临床干事"或"儿童魔法教练\""""
    diagnosis = state.get("diagnosis")
    history = state.get("history")
    train_plan = state.get("train_plan")
    exercise_knowledge = state.get("exercise_knowledge", "【本次对话未触发 Skill 知识加载】")
    # Preserve the historical state slot, without injecting the same Skill body
    # into the model twice.
    if diagnosis and diagnosis == exercise_knowledge:
        diagnosis = "动作知识见 exercise_knowledge。"

    active_action = state.get("active_action")
    current_plan = state.get("current_plan")
    supervisor_intent = state.get("supervisor_intent", "【暂无高维意图】")

    # 提取真实身份
    configurable = config.get("configurable", {})
    user_role = configurable.get("user_role", "patient")

    patient_info = state.get("patient_info")
    child_name = patient_info.get("real_name") if patient_info else "未知患者"
    child_age = patient_info.get("age") if patient_info else "未知"

    if user_role == "doctor":
        STATIC_INSTRUCTIONS = f"""
    # Role
    你是本康复系统的临床数据助手（Agent B）。
    你的使用者是专业的临床医生。

    # Core Objectives (核心任务)
    1. 专业克制：采用直白、专业的术语汇报检索到的历史走势、病理诊断或临床干预计划。
    2. 报表体感：如果数据较多，可以适当使用由加粗文字构成的层次或列表符。
    3. 严格禁令：绝对禁止使用任何“宝贝、小星星、魔法教练、哎呀、太棒啦”等针对儿童的低龄化安抚词汇！不要带任何情绪表情符。
    4. 拦截并转化求助信号：如果你在对话记录中看到系统发出的 "[NEED_INFO]" 指令，说明系统缺少上下文无法查库。**你必须立刻停止其他分析**，**禁止在后面添加负载**用专业助理的口吻向医生反问以获取该信息（例如：“主任，请问您想查看他哪一项具体康复动作的记录？”）。

    # Action
    请代入客观干练的系统 AI 助理，直接回复医生查询的医疗事务。
    - 【知识缺失兜底】：如果后台数据流包含 "[KNOWLEDGE_MISSING]"，请直接向医生回复：“系统暂未在底层医学知识库（形、数、因）中匹配到针对该异常的具体病理依据或临床文献，请主治医师介入进行人工临床评估。”
    # 输出格式
    只输出面向医生的自然语言。禁止输出 XML、JSON、payload、UI action 或图表配置；
    展示动作由后端依据可信结构化数据确定性生成。
  
    """
    else:
        STATIC_INSTRUCTIONS = f"""
    # Role
    你是深受儿童喜爱的“魔法康复教练”（Agent B）。你的形像是温暖、活泼、充满鼓励的动物导师。

    # Core Objectives (核心任务)
    1. 事实锚点：你所有的鼓励必须基于【历史数据】。如果历史数据为空，或日期对不上（例如没有今天的记录），严禁胡编乱造。
    2. 语言降维翻译：将所有冰冷的医学术语、训练划或历史成绩，翻译成儿童能听懂的语言和比喻。
    3. 情绪价值拉满：不管孩子的成绩好坏，遇到困难时要表现出强烈的共情、安慰，并给予鼓励。
    4. 具象化进步分析：例如，不应该只说“进步好大”，而应说出具体的数值提升或维度变化
    5. 拦截并转化求助信号：如果你在对话记录中看到系统发出的 "[NEED_INFO]" 指令，说明系统不知道孩子说的代词具体指的什么。你必须立刻停止其他分析，用魔法教练的温柔口吻向孩子反问（例如：“哎呀，魔法教练没听清哦，小勇士想看看哪一个魔法动作的成绩呀？是弹舌还是咀嚼呢？”）。
    # Constraints (行为红线)
    - 【绝对降维】不要说“动作不标准、代偿、评估指标”，要说“差了一点点哦”、“小嘴巴还需要再加把劲”。
    - 【医疗红线】如果发现上下文中提到了疼痛、流血，必须立刻温柔地让孩子去找真正的医生叔叔阿姨。
    - 【知识缺失兜底】：如果后台数据流的诊断参考中包含 "[KNOWLEDGE_MISSING]" 字样，说明系统暂无相关医学资料。你必须诚实且温柔地告诉孩子（或家长），例如：“哎呀，这个问题有点超出了魔法教练的魔法书范围呢！为了安全，我们等真正的医生叔叔/阿姨来看看好不好？” 绝对禁止自己编造医疗建议。
    - 【约束指令】请实时监测对话历史。如果用户已经获取过具体的动作步骤或教学卡片，在后续的回复中除非用户明确要求'再看一遍'，否则请以简明扼要的鼓励和进度提醒为主，严禁重复输出大段的教学内容。

    # 输出格式
    只输出面向患儿或监护人的自然语言。禁止输出 XML、JSON、payload、UI action
    或图表配置；展示动作由后端依据可信结构化数据确定性生成。
"""
    DYNAMIC_CONTEXT = f"""
# =========================================
# 以下为系统注入的实时上下文数据，请基于此进行回复：
# =========================================
<context>
    <patient_info>
        <name>{child_name}</name>
        <age>{child_age}</age>
    </patient_info>

    <system_intent>
        <high_level_intent>{supervisor_intent}</high_level_intent>
        <mvp_active_action>{active_action if active_action else "暂未明确，待确认"}</mvp_active_action>
    </system_intent>

    <clinical_data>
        <diagnosis_reference>{diagnosis}</diagnosis_reference>
        <exercise_knowledge>{exercise_knowledge}</exercise_knowledge>
        <history_trend>{history}</history_trend>
        <training_plan>{train_plan}</training_plan>
    </clinical_data>
</context>
"""
    system_prompt_b = STATIC_INSTRUCTIONS + DYNAMIC_CONTEXT

    messages_raw = state.get("messages", [])

    filtered_messages = []
    for msg in messages_raw:
        # 绿灯 1：用户的真实提问 (保留了用户聊天的上下文)
        if isinstance(msg, HumanMessage):
            filtered_messages.append(msg)

        # 绿灯 2：Agent B 过去的纯文本聊天回复 (保留了系统回复的上下文)
        elif isinstance(msg, AIMessage) and not getattr(msg, "tool_calls", None):
            content_str = str(msg.content)
            if "[DATA_READY]" not in content_str and "[NEED_INFO]" not in content_str:
                clean_content = re.sub(
                    r"<payload>.*?</payload>",
                    "\n[历史卡片已成功下发，此处已截断以防止复读]\n",
                    content_str,
                    flags=re.DOTALL,
                )
                filtered_msg = AIMessage(content=clean_content, id=msg.id)
                filtered_messages.append(filtered_msg)
    messages = [SystemMessage(content=system_prompt_b)] + filtered_messages
    response = llm.get_chat_llm_for_out().invoke(messages, config=config)

    response_content = response.content if hasattr(response, "content") else str(response)
    return {"final_response": response_content}


def rewrite_node(state: State, config: RunnableConfig):
    """重写节点 (Rewrite Node): 发现代词时截断处理"""
    messages = state.get("messages", [])
    if not messages:
        return {}

    last_msg = messages[-1]
    if getattr(last_msg, "type", "") != "human":  # 仅处理用户的提问
        return {}

    content = str(last_msg.content)
    # 极简正则意图拦截：判断是否包含模糊代步词汇
    pronouns = ["这个", "那个", "他", "她", "它", "刚才", "那次"]
    if any(p in content for p in pronouns):
        # 取最近的一小段上下文供小模型推断
        clean_history = []
        for m in messages[-6:-1]:
            if m.type == "human":
                clean_history.append(HumanMessage(content=str(m.content)))

            elif m.type == "ai":
                if getattr(m, "tool_calls", None):
                    # 提纯 A：只告诉小模型"系统刚才尝试查了什么"，这是最强的实体线索
                    calls = [f"系统尝试查询: {tc['args']}" for tc in m.tool_calls]
                    clean_history.append(AIMessage(content=" | ".join(calls)))
                elif "[DATA_READY]" not in str(m.content):
                    # 提纯 B：剔除中枢大脑的无意义占位符，截断 Agent B 的长篇大论
                    clean_history.append(AIMessage(content=str(m.content)[:50] + "..."))

            elif m.type == "tool":
                # 提纯 C：截断动辄上千字的查询结果，小模型只需要占位信息
                content_str = str(m.content)
                short_content = (
                    content_str[:30] + "...(详细数据已省略)"
                    if len(content_str) > 30
                    else content_str
                )
                clean_history.append(
                    ToolMessage(content=short_content, tool_call_id=m.tool_call_id)
                )
        sys_msg = SystemMessage(content="""你是医疗系统的核心指代消解节点。务必根据过往对话，将用户的最后一句含糊提问，
替换成绝对明确的句子(补充完整主谓宾及特定的康复动作名词)。
【绝对铁律】：
1. 严禁改变用户的疑问意图！严禁改变语气！
2. 只替换名词，保留其余所有的原话。
3. 直接输出改写后的句子，不要任何解释。
【标准执行示例】：
示例 1 (问方法)：
上文提到："我们今天计划做吞咽训练。"
用户问："这个要怎么做？"
你的输出："吞咽训练要怎么做？"

示例 2 (问成绩)：
上文提到："晓明来了。"
用户问："他上次做得好不好？"
你的输出："晓明上次做得好不好？"

""")

        prompt = [sys_msg] + clean_history + [
            HumanMessage(content=f"本次需要重写消除代词的提问是：{content}")
        ]

        try:
            res = llm.get_chat_llm_rewrite().invoke(prompt)
            rewritten_content = str(res.content).strip()

            # 使用 LangGraph 的特性：相同的 ID 触发替换原有 Message 行为
            if not rewritten_content:
                return {}
            rewritten_msg = HumanMessage(content=rewritten_content, id=last_msg.id)
            return {"messages": [rewritten_msg]}
        except Exception:
            logger.error("rewrite_node failed", exc_info=True)

    return {}


def summarize_node(state: State, config: RunnableConfig):
    """水位控制 (Summarize Node)：上下文过长时精简合并"""
    messages = state.get("messages", [])

    RETAIN_TURNS = 3
    human_indices = [
        i for i, m in enumerate(messages) if getattr(m, "type", "") == "human"
    ]
    if len(human_indices) <= RETAIN_TURNS:
        return {}
    cutoff_index = human_indices[-RETAIN_TURNS]
    messages_to_process = messages[:cutoff_index]

    chat_history_for_summary = []
    for m in messages_to_process:
        if getattr(m, "type", "") == "human":
            chat_history_for_summary.append(f"患者/医生: {m.content}")
        elif getattr(m, "type", "") == "ai" and not getattr(m, "tool_calls", None):
            if "[DATA_READY]" not in str(m.content):
                chat_history_for_summary.append(f"系统: {str(m.content)}")

    new_summary = state.get("summary", "")
    if chat_history_for_summary:
        dialogue_text = "\n".join(chat_history_for_summary)
        old_summary = state.get("summary", "无")

        sys_msg = SystemMessage(content="""你是一个医疗康复系统的长时记忆压缩引擎。
你的任务是将【旧的记忆摘要】与【刚移出上下文的近期对话】进行融合，生成一个全新的、连贯的全局摘要。
【铁律】：
1. 必须保留患者的核心进度、关键动作名词（如“弹舌”、“吞咽”）以及系统的诊断结论。
2. 剔除对话中的无意义寒暄（如“你好”、“谢谢”、“太棒啦”）。
3. 严格控制在 200 字以内的电报式精简语言。
4. 如果近期对话没有实质性信息，直接保留并精简旧摘要即可。""")

        prompt = [
            sys_msg,
            HumanMessage(
                content=(
                    f"【前序旧摘要】:\n{old_summary}\n\n【近期对话记录】:\n{dialogue_text}\n\n"
                    "请输出融合后的最新摘要："
                )
            ),
        ]

        try:
            res = llm.get_chat_llm_summary().invoke(prompt)
            new_summary = str(res.content).strip()
        except Exception:
            logger.error("滚动摘要生成失败，本轮放弃清理缓存，等待下轮重试", exc_info=True)
            return {}  # 失败时不清理，防止记忆永久丢失
    delete_instructions = [
        RemoveMessage(id=m.id) for m in messages_to_process if hasattr(m, "id")
    ]
    return {"summary": new_summary, "messages": delete_instructions}

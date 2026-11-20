# Chat-Agent-demo · 多智能体会诊聊天页

从「儿童口面肌康复训练 AI 多智能体辅助系统」中**单独提取对话链路**而成的独立小项目：
一个聊天 Web 页面（Vue 3 + SSE 流式）+ 一个后端 Agent（FastAPI + LangGraph 双智能体），
开箱即聊，无需 Docker / MySQL / ChromaDB / Ollama。

## 它展示了什么

| 能力 | 说明 |
| --- | --- |
| **双智能体 LangGraph 流水线** | Agent C（路由网关，`tool_choice=required` 强制工具调用，违规开口被劫持为交接信号）→ 工具层 → Agent B（按角色双人格输出：医生版专业克制 / 患儿版魔法教练）→ 滚动摘要压缩 |
| **SSE 三通道流式协议** | `status`（工具调用时间线）/ `chat`（token 级打字机，含 think 标签推理段过滤）/ `action`（隐式指令，如 SELECT_PATIENT） |
| **工具调用可视化** | 历史记录查询（含 difflib 实体纠偏）、今日计划、患者模糊绑定、全景考勤、Skill 临床知识加载 |
| **会诊会话管理** | 线程 CRUD、历史注水（bounded hydration window）、多会话切换 |
| **数据血缘微标** | 每条 AI 回复携带模型版本 / Prompt 策略版本 / 免责声明（Issue 10 血缘卡片） |
| **实验室级 UI** | RhineLab 设计语言完整还原：WebGL 纳米粒子头部场景、WebP 帧序列入场动效、IBM Plex 双字体、12 栏网格系统 |

> 原系统（三大 Agent + RAG + 挑战引擎 + 视频训练 + TTS + MySQL/Chroma）在此：
> [aaa-01 仓库](https://github.com/sukura-v/aaa-01)。本项目是其**对话体验的独立切片**。

## 项目结构

```
Chat-Agent-demo/
├── Backend/                  # FastAPI + LangGraph（SQLite 单文件库）
│   ├── app.py                # 应用入口：CORS + 路由挂载
│   ├── start.py              # 建表 → 种子数据 → uvicorn
│   ├── graph.py / nodes.py   # 双智能体状态图（C→tools→B→summarize）
│   ├── tools.py              # Agent C 的 5 个工具
│   ├── llm.py                # DeepSeek 角色级客户端（thinking/output/rewrite/summary）
│   ├── routers/chat.py       # /analyze SSE + 会话 CRUD
│   ├── demo_auth.py          # 免登录演示身份（HS256 JWT）
│   ├── seed.py               # 演示医生 + 2 名患儿 + 29 天训练记录
│   ├── knowledge_service.py  # Skill 临床知识加载（resources/training_skills）
│   └── resources/            # 训练 Skill 知识文件（标准/指标/病理）
└── Frontend/                 # Vue 3 + Vite 聊天页
    ├── src/views/ChatView.vue          # 三栏会诊工作台
    ├── src/components/chat/            # 布局/消息/输入器/会话轨道/命令面板
    ├── src/components/shell/NanoSceneBackdrop.vue  # three.js 粒子背景
    ├── src/head-scene/                 # WebGPU/WebGL 头部场景运行时
    ├── src/stores/chatMessages.js      # SSE 流调度核心
    ├── src/utils/agentAPI.js           # fetch ReadableStream SSE 消费器
    └── public/head-scene-v1/           # 入场 WebP 序列 + 深度贴图
```

## 快速开始

### 1. 后端

```bash
cd Backend
pip install -r requirements.txt
cp .env.example .env          # 填入你的 DeepSeek API_KEY
python start.py               # http://127.0.0.1:8000 （文档 /docs）
```

首次启动自动建表并注入演示数据（1 名医生 / 2 名患儿 / 29 天训练记录 / 今日计划）。

### 2. 前端

```bash
cd Frontend
npm install
npm run dev                   # http://localhost:5173
```

打开即聊——前端自动调用 `POST /auth/demo` 获取演示医生身份，无需登录。
试试这几句：

- `请汇总晓晓最近四周弹舌训练的走势` → 触发患者绑定 + 历史查询工具
- `今天轩轩还要练什么？` → 触发计划查询工具
- `弹舌训练的发力要领是什么？` → 触发 Skill 临床知识加载
- `帮我看一下大家今天练得怎么样` → 触发全景考勤工具

## 环境变量（Backend/.env）

| 变量 | 说明 |
| --- | --- |
| `API_KEY` | DeepSeek API Key（必需，[获取](https://platform.deepseek.com)） |
| `DEEPSEEK_MODEL` | 默认 `deepseek-v4-flash`（需支持 tool calling 且可关闭 thinking） |
| `DEEPSEEK_BASE_URL` | 默认 `https://api.deepseek.com`（兼容 OpenAI 协议的自建端点亦可） |
| `JWT_SECRET` | 会话签名密钥（缺省回退 API_KEY） |

## 与原系统的主要差异

- **存储**：MySQL/Docker → SQLite 单文件；模型列已做 SQLite 变体适配。
- **鉴权**：695 行的 JWT+授权+账号状态管线 → 迷你 demo 鉴权（同一 `ActorContext` 契约）。
- **剥离子系统**：RAG 检索子图、挑战/教练引擎、浏览器视频训练、TTS、会诊持久化轮次（durable consultation）、临床安全熔断。
- **保留内核**：Agent C 状态机提示词、违规开口劫持、transfer 载荷 Pydantic 校验、注册表驱动的工具→状态剥离、think 标签推理段过滤、会话注水窗口等全部工程细节。

## License

仅供学习与作品展示使用。

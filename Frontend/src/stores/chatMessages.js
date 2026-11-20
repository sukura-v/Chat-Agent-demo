/**
 * useChatMessagesStore — 对话消息 & SSE 流式通信 Store
 *
 * 管理消息列表、思考状态、会话线程、SSE 流调度。
 * 身份与患儿来自各自权威 Store；消息由本 Store 持有。
 *
 * 与原系统的差异：durable 会诊轮次（后台任务队列）与 TTS 音频子系统未纳入
 * 本 demo，相关分支已删除；SSE 消费协议（status/diagnosis/chat/action 四类
 * 事件）与历史注水逻辑保持一致。
 */
import { defineStore } from 'pinia'
import { onScopeDispose, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { localAgentAPI, getAuthHeaders } from '@/utils/agentAPI'
import { getAuthContext } from '@/utils/authContext'
import { sleep } from '@/utils/sleep'
import { useAuthStore } from './auth'
import { useConsultationContextStore } from './consultationContext'

function normalizeDurableAction(action) {
  if (!action || typeof action !== 'object') return null
  if (action.action_type === 'ProgressChart') {
    const points = Array.isArray(action.points) ? action.points : []
    return {
      richType: 'progress',
      richData: {
        title: action.title,
        show_chart: true,
        chartData: {
          xAxis: points.map(point => point.training_time || ''),
          seriesList: [{
            name: '总体得分',
            isMain: true,
            data: points.map(point => point.overall_score),
          }],
        },
      },
    }
  }
  if (action.action_type === 'StepsCard') {
    return {
      richType: 'steps',
      richData: {
        title: action.title,
        steps: (action.steps || []).map(step => ({
          title: step.title,
          desc: step.instruction_text || step.desc || '',
        })),
        knowledge_source: action.source,
      },
    }
  }
  if (action.action_type === 'HistorySummaryCard') {
    return { richType: 'history_summary', richData: action }
  }
  if (action.action_type === 'HistoryListCard') {
    return { richType: 'history_list', richData: action }
  }
  return null
}

export const useChatMessagesStore = defineStore('chatMessages', () => {
  const auth = useAuthStore()
  const consultationContext = useConsultationContextStore()
  // ── 响应式状态 ──────────────────────────────────────────────────────────
  const messages = ref([])
  const isThinking = ref(false)
  const thinkingText = ref('')
  const activeAgents = ref(['C', 'A', 'B'])
  const useRealAI = ref(true)
  const currentThreadId = ref('')
  const isLoadingHistory = ref(false)
  const turnInFlight = ref(false)
  let historyRequestId = 0
  let activeTurnController = null
  let activeTurnContext = null
  let accountGeneration = 0
  let disposed = false

  const ownsAccount = generation => !disposed && generation === accountGeneration

  function beginTurn(context = null) {
    if (turnInFlight.value) return null
    const controller = new AbortController()
    turnInFlight.value = true
    activeTurnController = controller
    activeTurnContext = context
    return controller
  }

  function finishTurn(controller) {
    if (controller !== activeTurnController) return false
    activeTurnController = null
    activeTurnContext = null
    turnInFlight.value = false
    isThinking.value = false
    return true
  }

  function ownsTurn(controller, sessionId) {
    return activeTurnController === controller
      && !controller.signal.aborted
      && currentThreadId.value === sessionId
  }

  function abortActiveTurn() {
    if (!turnInFlight.value || !activeTurnController || activeTurnController.signal.aborted) {
      return false
    }
    const targetMsg = activeTurnContext?.targetMsg
    if (targetMsg) {
      targetMsg.streamState = 'aborted'
      targetMsg.retryPrompt = activeTurnContext.triggerText || targetMsg.retryPrompt || ''
    }
    activeTurnController.abort()
    return true
  }

  function disconnectActiveTurn() {
    if (!turnInFlight.value || !activeTurnController || activeTurnController.signal.aborted) {
      return false
    }
    const controller = activeTurnController
    controller.abort()
    finishTurn(controller)
    return true
  }

  // ── 消息管理 ────────────────────────────────────────────────────────────

  function addMessage(msg) {
    messages.value.push({
      id: Date.now() + Math.random(),
      timestamp: new Date(),
      ...msg
    })
  }

  function clearMessages() {
    messages.value = []
  }

  function setThinking(status, text = '') {
    isThinking.value = status
    thinkingText.value = text
  }

  /**
   * 重置当前会话（仅消息和线程 ID，不做跨 Store 清理）。
   */
  function resetSession(threadId = 'SESS-' + Date.now().toString(36).toUpperCase()) {
    historyRequestId++
    isLoadingHistory.value = false
    disconnectActiveTurn()
    currentThreadId.value = threadId
    messages.value = []
  }

  function resetAccount() {
    accountGeneration++
    // Identity changes release local transports only.
    activeTurnController?.abort()
    resetSession('')
    activeTurnController = null
    activeTurnContext = null
    turnInFlight.value = false
    isThinking.value = false
    thinkingText.value = ''
  }

  watch(() => auth.sessionKey, resetAccount, { flush: 'sync' })
  watch(() => consultationContext.patientId, () => {
    if (consultationContext.selectionSource === 'user') resetSession()
  }, { flush: 'sync' })

  // ── 会话线程管理 ────────────────────────────────────────────────────────

  async function loadHistorySession(threadId) {
    disconnectActiveTurn()
    const requestId = ++historyRequestId
    isLoadingHistory.value = true
    try {
      const res = await fetch(`/api/chat/history/${threadId}`, { headers: getAuthHeaders() })
      if (!res.ok) throw new Error(`读取会诊历史失败: ${res.status}`)
      const json = await res.json()
      const hydrated = (json?.data || []).map((msg, index) => {
        const durableAction = normalizeDurableAction(
          msg.ui_payload && msg.ui_type
            ? { ...msg.ui_payload, action_type: msg.ui_payload.action_type || msg.ui_type }
            : null,
        )
        return {
          id: msg.id ?? `${threadId}-${index}`,
          messageAnchor: msg.turn_id || msg.id || `${threadId}-${index}`,
          role: msg.role === 'user' ? 'user' : 'agent',
          agent: msg.role === 'ai' ? 'B' : null,
          content: msg.content,
          type: 'text',
          richType: durableAction?.richType || null,
          richData: durableAction?.richData || null,
          messageProvenance: msg.message_provenance || {},
          timestamp: msg.created_at || new Date(),
          statusList: [],
          diagnosisText: '',
        }
      })
      if (requestId !== historyRequestId) return false

      currentThreadId.value = threadId
      messages.value = hydrated
      return true
    } catch (e) {
      if (requestId !== historyRequestId) return false
      console.error('拉取历史失败:', e)
      ElMessage.error('加载历史会话失败，请确认后端服务已启动')
      return false
    } finally {
      if (requestId === historyRequestId) isLoadingHistory.value = false
    }
  }

  async function deleteSession(threadId) {
    const generation = accountGeneration
    try {
      const res = await fetch(`/api/chat/sessions/${threadId}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      })
      const json = await res.json()
      if (!ownsAccount(generation)) return false
      return json.code === 200
    } catch (e) {
      console.error('删除会话失败:', e)
      return false
    }
  }

  // ── SSE 流式调度核心 ────────────────────────────────────────────────────

  async function _sendStreamToTarget(triggerText, targetMsg, opts = {}) {
    const { thinkingLabel = '本系统AI大脑正在推理...', handleActions = true } = opts

    const controller = beginTurn({ targetMsg, triggerText })
    if (!controller) return false

    isThinking.value = true
    thinkingText.value = thinkingLabel
    targetMsg.streamState = 'streaming'
    targetMsg.retryPrompt = triggerText

    targetMsg.statusList = targetMsg.statusList || []
    targetMsg.diagnosisText = targetMsg.diagnosisText || ''

    try {
      const ctx = getAuthContext()
      if (!ctx) {
        ElMessage.error('登录态已过期，请重新登录')
        return false
      }

      if (!currentThreadId.value) {
        currentThreadId.value = 'SESS-' + Date.now().toString(36).toUpperCase()
      }
      const thread_id = currentThreadId.value

      await localAgentAPI.sendStream(triggerText, ctx.patientId, ctx.doctorId, ctx.userRole, thread_id, (parsedEvent) => {
        if (!ownsTurn(controller, thread_id)) return
        if (isThinking.value) isThinking.value = false
        if (!parsedEvent || !parsedEvent.type) return

        switch (parsedEvent.type) {
          case 'status':
            targetMsg.statusList.push(parsedEvent.content)
            break

          case 'diagnosis':
            targetMsg.diagnosisText += parsedEvent.content
            break

          case 'chat':
            if (parsedEvent.provenance) targetMsg.messageProvenance = parsedEvent.provenance
            targetMsg.content += parsedEvent.content || ''
            break

          case 'action':
            if (!handleActions) break
            if (parsedEvent.action_type === 'SELECT_PATIENT' && parsedEvent.id) {
              consultationContext.selectPatient(parsedEvent.id, 'agent')
            } else if (parsedEvent.action_type === 'START_VIDEO_SESSION' && parsedEvent.exercise_id) {
              // Video training is out of the demo scope; log the command only.
              console.log('[Chat Store] 收到 START_VIDEO_SESSION 指令（demo 未启用训练）:', parsedEvent.exercise_id)
            } else if (parsedEvent.data) {
              targetMsg.richType = parsedEvent.action_type
              targetMsg.richData = parsedEvent.data
              console.log('[Action 收达] 富媒体指令渲染准备完毕:', parsedEvent.action_type)
            }
            break

          default:
            console.warn('未知的 SSE 类型:', parsedEvent.type)
            break
        }
      }, { signal: controller.signal })

      if (!ownsTurn(controller, thread_id)) return false
      targetMsg.streamState = 'complete'
      useRealAI.value = true
      return true
    } catch (error) {
      if (error?.name !== 'AbortError' && !controller.signal.aborted) {
        console.error('FastAPI 本地大模型调用走失:', error)
        targetMsg.content = '⚠️ 本地服务器无法响应，请确保后端 uvicorn 在 8000 端口启动。'
      }
      return false
    } finally {
      finishTurn(controller)
    }
  }

  /**
   * 向 LangGraph 后端发送用户消息（SSE 流式）。
   * 调用方负责在调用前通过 addMessage 添加用户气泡。
   */
  async function sendToBackend(userMessage) {
    if (turnInFlight.value) return false

    // 插入空的 AI 回复气泡
    addMessage({
      role: 'agent', agent: 'B',
      agentName: '后端调度大脑 Agent',
      content: '',
      type: 'text',
      richType: null,
      richData: null
    })

    const targetMsg = messages.value[messages.value.length - 1]
    return await _sendStreamToTarget(userMessage, targetMsg, {
      thinkingLabel: '本系统AI大脑（DeepSeek）正在推理...',
      handleActions: true
    })
  }

  // ── 模拟智能体响应（Mock 降级）──────────────────────────────────────────

  function getThinkingSteps(scenario) {
    const steps = {
      diagnosis: [
        { text: '🔵 Agent C 正在分析视频数据...', duration: 1200 },
        { text: '🟢 Agent A 正在检索康复知识库...', duration: 1500 },
        { text: '🟠 Agent B 正在转化为儿童友好话术...', duration: 1000 },
      ],
      progress: [
        { text: '🔵 Agent C 收到进度查询请求，调用历史记录工具...', duration: 1000 },
        { text: '🟢 Agent A 正在生成专业进度分析报告...', duration: 1200 },
        { text: '🟠 Agent B 正在整理鼓励话术...', duration: 800 },
      ],
      knowledge: [
        { text: '🔵 Agent C 识别为知识检索请求，路由至 Agent A...', duration: 800 },
        { text: '🟢 Agent A 正在检索康复动作训练知识库...', duration: 1500 },
        { text: '🟠 Agent B 正在优化表达方式，让小朋友更容易理解...', duration: 1000 },
      ]
    }
    return steps[scenario] || steps.diagnosis
  }

  function getScenarioResponses(scenario) {
    if (scenario === 'diagnosis') {
      return [
        {
          role: 'agent', agent: 'B', agentName: '情感教练 Agent B',
          content: '太棒啦！小朋友今天配合得非常好！🎉 我帮你看了刚才的训练视频，你的吞咽动作有进步哦！不过有几个小地方我们一起来优化一下，你愿意吗？😊',
          type: 'text'
        },
        {
          role: 'agent', agent: 'A', agentName: '专业RAG机器人 Agent A',
          content: null, type: 'card',
          card: {
            title: '专业诊断报告',
            sessionId: 'SES-' + Date.now(),
            date: new Date().toLocaleDateString('zh-CN'),
            scores: [
              { label: '吞咽协调性', score: 72, status: '良好', color: '#5BAD8F' },
              { label: '舌肌力量', score: 58, status: '待提升', color: '#F5A55B' },
              { label: '口腔耐力', score: 65, status: '一般', color: '#4A9EDA' },
              { label: '动作灵活性', score: 80, status: '优秀', color: '#9B82D4' }
            ],
            suggestions: [
              '建议每日进行舌肌强化训练，每次 3 组，每组 10 次',
              '吞咽练习前可先进行热敷，改善肌肉状态',
              '训练频次建议保持每周 5 次以上'
            ],
            knowledgeSource: '基于《儿童吞咽功能障碍康复治疗指南(2023版)》'
          }
        },
        {
          role: 'agent', agent: 'B', agentName: '情感教练 Agent B',
          content: '加油哦！每天坚持训练，就像练功夫一样，只要不放弃，小朋友一定会越来越厉害的！💪 有什么不懂的可以随时问我呀~',
          type: 'text'
        }
      ]
    } else if (scenario === 'progress') {
      return [
        {
          role: 'agent', agent: 'C', agentName: '中枢大脑 Agent C',
          content: '已调用历史训练记录工具，获取近4周数据，正在整合分析结果...',
          type: 'text'
        },
        {
          role: 'agent', agent: 'B', agentName: '情感教练 Agent B',
          content: '哇！小朋友你真的很棒！📈 看看这个进步图，从上个月到现在，你的训练成功率提升了好多好多！就像爬楼梯一样，一步一步，越来越高！继续加油，再坚持几周，老师相信你能达到80%以上！🌟',
          type: 'progress', showChart: true,
          richType: 'progress',
          richData: {
            show_chart: true,
            chartData: {
              xAxis: ['第1周', '第2周', '第3周', '第4周'],
              seriesList: [
                { name: '总体得分', isMain: true, data: [62, 68, 74, 78] },
                { name: '目标线', data: [70, 70, 70, 70] }
              ]
            }
          }
        }
      ]
    } else if (scenario === 'knowledge') {
      return [
        {
          role: 'agent', agent: 'A', agentName: '专业RAG机器人 Agent A',
          content: null, type: 'steps',
          richType: 'steps',
          richData: {
            title: '训练要领',
            steps: [
              { title: '第一步：热身准备', desc: '做 5 次轻松的面部按摩，从耳根到嘴角轻抚，放松面部肌肉。时间约 1 分钟。' },
              { title: '第二步：舌尖上抬练习', desc: '将舌尖抵住上颚前部（门牙后方），保持 5 秒，重复 10 次。注意保持匀速呼吸。' },
              { title: '第三步：舌左右摆动', desc: '舌头向左右嘴角方向用力推压，各保持 3 秒，交替进行，共 10 个来回。' },
              { title: '第四步：吸吮强化训练', desc: '用吸管喝水，尝试用舌头控制水流速度，每次训练 2-3 分钟。' },
              { title: '第五步：整合吞咽练习', desc: '小口喝水，有意识地感受吞咽时舌根和咽部肌肉的收缩，重复 15 次。' }
            ],
            knowledge_source: '来源：《儿童口腔运动功能训练标准动作库 v2.1》'
          }
        },
        {
          role: 'agent', agent: 'B', agentName: '情感教练 Agent B',
          content: '看到了吗？就这 5 个小步骤！🎯 其实一点都不难，就像做游戏一样。每天练完这些，我们就可以在进步表上贴一颗星星⭐，集满 7 颗星星就能换一个小奖励哦！你觉得怎么样？',
          type: 'text'
        }
      ]
    }
    return []
  }

  async function simulateAgentResponse(scenario) {
    const controller = beginTurn()
    if (!controller) return false

    isThinking.value = true

    try {
      const thinkingSteps = getThinkingSteps(scenario)
      for (const step of thinkingSteps) {
        thinkingText.value = step.text
        await sleep(step.duration)
        if (controller.signal.aborted) return false
      }

      isThinking.value = false

      const responses = getScenarioResponses(scenario)
      for (const resp of responses) {
        await sleep(300)
        if (controller.signal.aborted) return false
        addMessage(resp)
      }
      return true
    } finally {
      finishTurn(controller)
    }
  }

  onScopeDispose(() => {
    disposed = true
    resetAccount()
  })

  return {
    messages,
    isThinking,
    thinkingText,
    activeAgents,
    useRealAI,
    currentThreadId,
    isLoadingHistory,
    turnInFlight,
    addMessage,
    clearMessages,
    setThinking,
    resetSession,
    loadHistorySession,
    deleteSession,
    sendToBackend,
    abortActiveTurn,
    disconnectActiveTurn,
    _sendStreamToTarget,
    simulateAgentResponse,
    getThinkingSteps,
    getScenarioResponses,
  }
})

/**
 * Chat Store — 薄编排层 & 向后兼容门面
 *
 * 与原系统的差异：会诊训练编排（launchUnifiedTraining / audioTTS）未纳入
 * demo；本文件仅保留跨 Store 编排 + 平铺导出，消费者无需改动即可使用。
 */
import { defineStore, storeToRefs } from 'pinia'
import { ref } from 'vue'
import { useAuthStore } from './auth'
import { useChatMessagesStore } from './chatMessages'

export const useChatStore = defineStore('chat', () => {
  // ── 子 Store 引用 ──────────────────────────────────────────────────────
  const chatMessages = useChatMessagesStore()
  const auth = useAuthStore()

  const {
    messages, isThinking, thinkingText, activeAgents,
    useRealAI, currentThreadId, isLoadingHistory, turnInFlight,
  } = storeToRefs(chatMessages)

  // Demo 中没有 durable 会诊任务；保留常量形状供状态栏与历史会话读取。
  const currentTurnProgress = ref({ completed: 0, total: 0 })
  const currentSessionHasUnfinishedTurn = ref(false)
  const trainingNavigationPending = ref(false)
  const durableStateRevision = ref(0)

  // ══════════════════════════════════════════════════════════════════════════
  // 跨 Store 编排方法
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * 创建新会话 — 清空消息。
   */
  function createNewSession() {
    chatMessages.disconnectActiveTurn()
    chatMessages.resetSession()
  }

  function disconnectActiveTurn(...args) {
    return chatMessages.disconnectActiveTurn(...args)
  }

  function loadHistorySession(...args) {
    return chatMessages.loadHistorySession(...args)
  }

  /**
   * 发送消息到后端。
   */
  async function sendToBackend(userMessage) {
    if (chatMessages.turnInFlight) return false
    return chatMessages.sendToBackend(userMessage)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 向后兼容 — 平铺导出所有子 Store 的状态和方法
  // ══════════════════════════════════════════════════════════════════════════

  return {
    trainingNavigationPending,

    // ── chatMessages 状态 ──
    messages,
    isThinking,
    thinkingText,
    activeAgents,
    useRealAI,
    currentThreadId,
    isLoadingHistory,
    turnInFlight,
    currentSessionHasUnfinishedTurn,
    currentTurnProgress,
    durableStateRevision,

    // ── chatMessages 方法（直接透传）──
    addMessage: chatMessages.addMessage,
    clearMessages: chatMessages.clearMessages,
    setThinking: chatMessages.setThinking,
    loadHistorySession,
    deleteSession: chatMessages.deleteSession,
    simulateAgentResponse: chatMessages.simulateAgentResponse,

    // ── 编排方法 ──
    createNewSession,
    sendToBackend,
    abortActiveTurn: chatMessages.abortActiveTurn,
    disconnectActiveTurn,
  }
})

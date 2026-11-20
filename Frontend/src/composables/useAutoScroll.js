/**
 * useAutoScroll — 聊天区域自动滚动到最新消息
 *
 * 从 ChatView.vue 中提取 scrollToBottom 逻辑，并增加智能跟随策略：
 * 仅当用户已接近底部时才自动滚动（避免在阅读历史消息时被打断）。
 *
 * @example
 *   const messagesArea = ref(null)
 *   const { scrollToBottom, onScroll } = useAutoScroll(messagesArea)
 *
 *   // 绑定监听源 — 新消息到达 / 思考态切换时自动滚到底部
 *   watch(() => chatStore.messages.length, () => scrollToBottom())
 *   watch(() => chatStore.isThinking, () => scrollToBottom())
 *
 * @see views/ChatView.vue:530  (原 scrollToBottom 函数)
 * @see views/ChatView.vue:537  (原 watch → scrollToBottom 注册)
 */

import { ref, nextTick } from 'vue'

export function useAutoScroll(containerRef) {
  /** 用户是否在底部附近（用于智能跟随判断） */
  const isNearBottom = ref(true)

  /**
   * 滚动容器到底部。
   * @param {{ force?: boolean }} [opts]
   */
  async function scrollToBottom(opts = {}) {
    await nextTick()
    const el = containerRef.value
    if (!el) return

    const { force = false } = opts
    if (force || isNearBottom.value) {
      el.scrollTop = el.scrollHeight
    }
  }

  /**
   * 滚动事件处理 — 跟踪用户是否手动滚离底部。
   * 绑定到容器的 @scroll 事件。
   */
  function onScroll() {
    const el = containerRef.value
    if (!el) return
    const threshold = 80 // px，距离底部阈值
    isNearBottom.value =
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold
  }

  return { scrollToBottom, onScroll, isNearBottom }
}

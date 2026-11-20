/**
 * useDebounce — 前端防抖 / 延迟调度工具
 *
 * 替代 ChatView.vue 中手动 setTimeout 实现的「按钮冷却」「会话刷新延迟」
 * 等场景。提供三个核心能力：
 *
 *  - debounce(fn)   — 经典防抖：连续调用仅保留最后一次，等待停止后才执行
 *  - delay(fn)      — 单次延迟：在指定毫秒后执行
 *  - cooldown(ref)  — 按钮冷却：执行 fn 并置灰 ref，delayMs 后自动恢复
 *
 * @example
 *   const { delay, cooldown } = useDebounce(800)
 *   delay(() => fetchSessions())           // 替代 setTimeout(() => fetchSessions(), 800)
 *   cooldown(() => pushWindow(), isPushing) // 按钮点击后置灰 800ms
 *
 * @see views/ChatView.vue:561  (原手动 setTimeout → fetchSessions)
 * @see views/ChatView.vue:629  (原手动 setTimeout → isPushingBtn 冷却)
 */

import { onUnmounted } from 'vue'

export function useDebounce(delayMs = 300) {
  let debounceTimer = null
  let delayTimer = null

  /**
   * 经典防抖：在连续调用停止 delayMs 后执行 fn。
   * 新调用会取消前一个等待中的调用。
   * @param {Function} fn
   */
  function debounce(fn) {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      fn()
    }, delayMs)
  }

  /**
   * 单次延迟执行 fn（独立定时器，不会与 debounce 互相干扰）。
   * @param {Function} fn
   */
  function delay(fn) {
    if (delayTimer) clearTimeout(delayTimer)
    delayTimer = setTimeout(() => {
      delayTimer = null
      fn()
    }, delayMs)
  }

  /**
   * 按钮冷却：立即执行 fn 并将其关联的 ref 设为 true，
   * delayMs 后自动恢复为 false。
   * @param {Function} fn        - 要执行的操作
   * @param {import('vue').Ref<boolean>} busyRef - 冷却标志 ref
   * @returns {Promise<void>}
   */
  async function cooldown(fn, busyRef) {
    if (busyRef.value) return
    busyRef.value = true
    try {
      await fn()
    } finally {
      setTimeout(() => {
        busyRef.value = false
      }, delayMs)
    }
  }

  /** 取消所有等待中的定时器 */
  function cancel() {
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null }
    if (delayTimer) { clearTimeout(delayTimer); delayTimer = null }
  }

  onUnmounted(cancel)

  return { debounce, delay, cooldown, cancel }
}

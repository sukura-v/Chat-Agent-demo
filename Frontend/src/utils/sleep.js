/**
 * 异步延迟工具函数。
 *
 * @param {number} ms - 延迟毫秒数
 * @returns {Promise<void>}
 *
 * @example
 *   import { sleep } from '@/utils/sleep'
 *   await sleep(800)  // 暂停 800ms
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

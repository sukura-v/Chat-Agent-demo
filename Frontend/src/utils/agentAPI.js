/**
 * agentAPI.js
 * 连接本地大模型 (LangGraph / FastAPI) 的网络接口模块。
 * 使用原生 fetch 以实现极速 Server-Sent Events (SSE) 流式打字机效果。
 *
 * 与原系统的差异：会诊持久化轮次、TTS WebSocket、临床目标/复诊预约等业务
 * API 未纳入 demo；SSE 消费器与 sendStream 契约保持一致。
 */
import { getAuthHeaders } from './authHeaders'
export { getAuthHeaders } from './authHeaders'

// ── SSE 消费（带错误传播）─────────────────────────────────────────────────────
const MAX_CONSECUTIVE_PARSE_ERRORS = 5

function createAbortError(signal) {
  if (signal?.reason?.name === 'AbortError') return signal.reason
  return new DOMException('The operation was aborted', 'AbortError')
}

async function consumeSSE(response, onChunk, options = {}) {
  const { signal, onParseError } = options

  if (!response.ok) {
    throw new Error(`请求失败: ${response.status}`)
  }

  if (!response.body) {
    throw new Error('ReadableStream 暂不支持或为空')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let parseErrors = 0
  let reachedEOF = false
  let cancelPromise = null

  const cancelReaderOnce = (reason) => {
    if (cancelPromise) return cancelPromise
    try {
      cancelPromise = Promise.resolve(reader.cancel(reason)).catch((error) => {
        console.warn('[SSE] 取消读取器失败:', error)
      })
    } catch (error) {
      console.warn('[SSE] 取消读取器失败:', error)
      cancelPromise = Promise.resolve()
    }
    return cancelPromise
  }

  const handleAbort = () => {
    void cancelReaderOnce(signal?.reason)
  }

  if (signal?.aborted) handleAbort()
  signal?.addEventListener('abort', handleAbort, { once: true })

  try {
    if (signal?.aborted) throw createAbortError(signal)

    while (!reachedEOF) {
      const { value, done } = await reader.read()
      if (signal?.aborted) throw createAbortError(signal)

      reachedEOF = done
      if (!value) continue

      buffer += decoder.decode(value, { stream: !done })
      const chunks = buffer.split(/\r?\n\r?\n/)
      buffer = chunks.pop()

      for (const line of chunks) {
        if (!line.startsWith('data: ')) continue
        try {
          const payload = JSON.parse(line.substring(6))
          parseErrors = 0
          if (onChunk) onChunk(payload)
        } catch (error) {
          parseErrors++
          const detail = {
            message: error.message,
            raw: line.substring(0, 120),
            count: parseErrors
          }
          console.warn('[SSE] 损坏的 JSON 块:', detail)
          if (onParseError) onParseError(detail)
          if (parseErrors >= MAX_CONSECUTIVE_PARSE_ERRORS) {
            throw new Error(`SSE 流 JSON 解析连续失败 ${parseErrors} 次，已中止`)
          }
        }
      }
    }
  } finally {
    signal?.removeEventListener('abort', handleAbort)
    if (!reachedEOF) await cancelReaderOnce(signal?.reason)
    try {
      reader.releaseLock()
    } catch (error) {
      console.warn('[SSE] 释放读取器失败:', error)
    }
  }
}

async function requestJSON(url, options, fallbackMessage) {
  const response = await fetch(url, options)
  if (!response.ok) throw await parseResponseError(response, fallbackMessage)
  return response.json()
}

async function parseResponseError(response, fallbackMessage) {
  let detail = null
  try {
    const payload = await response.json()
    detail = payload?.detail ?? null
  } catch (_) {
    detail = null
  }

  const detailText = typeof detail === 'string'
    ? detail
    : (detail && typeof detail === 'object' ? (detail.message || JSON.stringify(detail)) : '')

  const suffix = detailText ? ` (${detailText})` : ''
  const err = new Error(`${fallbackMessage}: ${response.status}${suffix}`)
  err.status = response.status
  err.detail = detail
  err.errorCode = (detail && typeof detail === 'object') ? (detail.code || null) : null
  return err
}

export const localAgentAPI = {
  /**
   * 向 FastAPI 后端发送流式请求
   */
  sendStream: async (
    userMessage,
    patientId,
    doctorId,
    userRole,
    threadId,
    onChunk,
    options = {}
  ) => {
    const { signal, onParseError, onComplete } = options
    let terminal = { reason: 'error', error: null }
    let completed = false

    const completeOnce = () => {
      if (completed) return
      completed = true
      try {
        if (onComplete) onComplete(terminal)
      } catch (error) {
        console.warn('[SSE] 完成回调失败:', error)
      }
    }

    try {
      const response = await fetch('/analyze', {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Accept': 'text/event-stream'
        },
        body: JSON.stringify({
          patient_id: patientId,
          doctor_id: doctorId,
          user_role: userRole,
          text: userMessage,
          thread_id: threadId
        }),
        signal
      })

      await consumeSSE(response, onChunk, { signal, onParseError })
      if (signal?.aborted) throw createAbortError(signal)
      terminal = { reason: 'eof', error: null }
    } catch (error) {
      const terminalError = signal?.aborted && error?.name !== 'AbortError'
        ? createAbortError(signal)
        : error
      terminal = {
        reason: terminalError?.name === 'AbortError' ? 'aborted' : 'error',
        error: terminalError
      }
      throw terminalError
    } finally {
      completeOnce()
    }
  },

}

export const agentAPI = localAgentAPI
export default localAgentAPI

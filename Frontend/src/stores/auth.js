import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

function readStoredJson(key, fallback = null) {
  const raw = localStorage.getItem(key)
  if (!raw) return fallback
  try {
    return JSON.parse(raw)
  } catch (_) {
    localStorage.removeItem(key)
    return fallback
  }
}

/**
 * Auth Store - 认证与多租户信息管理
 * 存储 patient_id, doctor_id, user_role 到 Pinia + LocalStorage
 *
 * Demo 模式：免登录。ensureDemoSession() 在首个路由守卫处调用 /auth/demo
 * 换取演示医生身份，保持与原系统一致的 token/header 契约。
 */
export const useAuthStore = defineStore('auth', () => {
  // 从 LocalStorage 恢复状态
  const storedUser = readStoredJson('oral_rehab_user')

  // Publish identity as one snapshot. Synchronous consumers must never see
  // the new account paired with the previous account's token or headers.
  const session = ref({ user: storedUser, token: localStorage.getItem('oral_rehab_token') || '' })
  const user = computed({
    get: () => session.value.user,
    set: value => { session.value = { ...session.value, user: value } },
  })
  const token = computed({
    get: () => session.value.token,
    set: value => { session.value = { ...session.value, token: value } },
  })

  const isLoggedIn = computed(() => !!user.value && !!token.value)
  const patientId = computed(() => user.value?.patient_id || '')
  const doctorId = computed(() => user.value?.doctor_id || '')
  const userRole = computed(() => user.value?.user_role || '')
  const userName = computed(() => user.value?.name || '')
  const userAvatar = computed(() => user.value?.avatar || '')
  const accountKey = computed(() => isLoggedIn.value ? JSON.stringify([
    userRole.value, user.value?.doctor_id ?? '', user.value?.patient_id ?? '',
  ]) : '')
  const sessionKey = computed(() => isLoggedIn.value ? JSON.stringify([accountKey.value, token.value]) : '')
  const homePath = computed(() => '/')

  let bootstrapPromise = null

  function setUser(userData, authToken) {
    // Persist before notifying reactive consumers, including fetch clients.
    localStorage.setItem('oral_rehab_user', JSON.stringify(userData))
    localStorage.setItem('oral_rehab_token', authToken)
    session.value = { user: userData, token: authToken }
  }

  /**
   * 免登录演示身份：调用后端 /auth/demo 换取演示医生 token。
   * 幂等——并发调用共享同一个 promise，已登录时直接返回。
   */
  function ensureDemoSession() {
    if (isLoggedIn.value) return Promise.resolve(true)
    if (bootstrapPromise) return bootstrapPromise
    bootstrapPromise = fetch('/auth/demo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`demo login failed: ${res.status}`)
        const payload = await res.json()
        const { token: authToken, user: userData } = payload?.data || {}
        if (!authToken || !userData) throw new Error('demo login payload invalid')
        setUser(userData, authToken)
        return true
      })
      .catch((error) => {
        console.error('[Auth] demo session bootstrap failed', error)
        bootstrapPromise = null
        return false
      })
    return bootstrapPromise
  }

  function logout() {
    localStorage.removeItem('oral_rehab_user')
    localStorage.removeItem('oral_rehab_token')
    session.value = { user: null, token: '' }
    // 广播登出事件，让其他 store 清理计时器等资源
    try { window.dispatchEvent(new CustomEvent('auth-logout')) } catch (_) { /* noop */ }
  }

  return {
    user,
    token,
    isLoggedIn,
    patientId,
    doctorId,
    userRole,
    userName,
    userAvatar,
    accountKey,
    sessionKey,
    homePath,
    setUser,
    logout,
    ensureDemoSession,
  }
})

/**
 * authContext — 认证上下文提取工具
 *
 * 从 useAuthStore() 获取登录身份；医生当前选择的患儿从会诊选择存储读取。
 * 在 Pinia 初始化后调用，不替代服务端授权。
 *
 * @returns {{ patientId: number, doctorId: number, userRole: string } | null}
 */
import { useAuthStore } from '@/stores/auth'
import { useConsultationContextStore } from '@/stores/consultationContext'

export function getAuthContext() {
  const authStore = useAuthStore()

  if (!authStore.isLoggedIn) {
    console.error('[authContext] 未找到有效登录态，请重新登录')
    return null
  }

  const doctorId = authStore.doctorId
  const userRole = authStore.userRole
  const patientId = useConsultationContextStore().patientId

  if (!patientId && userRole === 'doctor') {
    console.warn('[authContext] 医生未选择患者')
    return null
  }
  if (!patientId || !doctorId) {
    console.error('[authContext] patientId 或 doctorId 缺失', { patientId, doctorId })
    return null
  }

  return { patientId, doctorId, userRole }
}

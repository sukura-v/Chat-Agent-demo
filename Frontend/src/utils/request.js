import axios from 'axios'
import { ElMessage } from 'element-plus'
import router from '@/router'
import { useAuthStore } from '@/stores/auth'
import { getIdentityHeaders } from './authHeaders'

/**
 * 本地业务 API 实例，使用同源相对路径。
 */
const request = axios.create({
  baseURL: '',
  timeout: 60000
})

// 请求拦截器 - 注入多租户信息（仅本地业务请求）
request.interceptors.request.use(
  config => {
    Object.assign(config.headers, getIdentityHeaders())
    return config
  },
  error => Promise.reject(error)
)

// 响应拦截器 - 统一错误处理（仅本地业务请求）
request.interceptors.response.use(
  response => response.data,
  error => {
    // A response belongs to the identity that sent the request. An expired
    // request from the previous account must not log out or redirect this one.
    const authorization = error.config?.headers?.Authorization
    if (authorization && authorization !== `Bearer ${useAuthStore().token}`) {
      return Promise.reject(error)
    }
    // 若请求配置了 skipErrorToast 为 true，则不弹出全局错误 Toast（用于静默查询或优雅降级）
    if (!error.config?.skipErrorToast) {
      const detail = error.response?.data?.detail
      const msg = error.response?.data?.message || (typeof detail === 'string' ? detail : detail?.message) || error.message || '请求失败'
      ElMessage.error(msg)
    }
    const detail = error.response?.data?.detail
    if (error.response?.status === 403 && detail?.code === 'PASSWORD_CHANGE_REQUIRED') {
      router.push('/change-password')
    }
    if (error.response?.status === 401) {
      useAuthStore().logout()
      router.push('/login')
    }
    return Promise.reject(error)
  }
)

/** 认证体系 (通过 Vite 代理转发至 FastAPI) */
export const authAPI = {
  login: (data) => request.post('/auth/login', data),
  changePassword: (data) => request.post('/auth/change-password', data),
}

/** 康复数据 (通过 Vite 代理转发至 FastAPI) */
export const analyticsAPI = {
  getPatients: () => request.get('/analytics/patients'),
  getDashboardData: (patientId, timeRange, actionType) =>
    request.get(`/analytics/dashboard/${patientId}`,
      {
        params: {
          time_range: timeRange,
          action_type: actionType
        }
      })
}

export default request

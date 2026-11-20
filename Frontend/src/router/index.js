import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

/**
 * Single-page demo router — the whole app is the consultation chat page.
 * The demo auto-login (免登录演示模式) mints a demo-doctor JWT before the
 * first guarded navigation, so no login view is required.
 */
const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'ChatDemo',
      component: () => import('@/layouts/DemoLayout.vue'),
      meta: { requiresAuth: true },
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  const authStore = useAuthStore()
  if (to.meta?.requiresAuth && !authStore.isLoggedIn) {
    try {
      await authStore.ensureDemoSession()
    } catch (error) {
      console.error('[Router] demo session bootstrap failed', error)
    }
    if (!authStore.isLoggedIn) return { name: 'ChatDemo' }
  }
  return true
})

export default router

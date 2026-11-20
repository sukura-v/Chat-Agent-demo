<template>
  <router-view :key="auth.sessionKey" />
</template>

<script setup>
import { onMounted, onScopeDispose } from 'vue'
import { useAuthStore } from '@/stores/auth'

// Page-local forms and workspaces belong to a login session. Business stores
// keep ownership of durable work when its observing page is replaced.
const auth = useAuthStore()

function syncVisibility() {
  document.documentElement.classList.toggle('is-page-hidden', document.hidden)
}
onMounted(() => {
  syncVisibility()
  document.addEventListener('visibilitychange', syncVisibility)
})
onScopeDispose(() => document.removeEventListener('visibilitychange', syncVisibility))
</script>

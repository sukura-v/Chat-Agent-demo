<template>
  <div
    class="immersive-chat-layout"
    data-testid="immersive-chat-shell"
  >
    <ChatView :preview-state="previewState" />
  </div>
</template>

<script setup>
import { computed, onBeforeMount, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'

import ChatView from '@/views/ChatView.vue'
import { provideNanoSceneController } from '@/composables/useNanoSceneController'

const IMMERSIVE_BODY_CLASS = 'chat-immersive-active'
const route = useRoute()
const previewState = computed(() => {
  const preview = route.query?.preview
  return (preview === 'landing' || preview === 'chat') ? preview : ''
})

provideNanoSceneController()

let bodyClassAttached = false

function attachBodyClass() {
  if (typeof document === 'undefined' || bodyClassAttached) return
  document.body.classList.add(IMMERSIVE_BODY_CLASS)
  bodyClassAttached = true
}

function detachBodyClass() {
  if (typeof document === 'undefined' || !bodyClassAttached) return
  document.body.classList.remove(IMMERSIVE_BODY_CLASS)
  bodyClassAttached = false
}

onBeforeMount(attachBodyClass)
onBeforeUnmount(detachBodyClass)
</script>

<style scoped>
.immersive-chat-layout {
  position: fixed;
  inset: 0;
  isolation: isolate;
  width: 100%;
  height: 100dvh;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--app-canvas);
  color: var(--app-text);
}
</style>

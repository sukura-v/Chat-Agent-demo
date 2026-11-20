<template>
  <div class="demo-shell" data-testid="demo-shell">
    <NanoSceneBackdrop />
    <ChatView />
  </div>
</template>

<script setup>
// Demo shell: provides the nano-scene controller (landing 3D particle
// backdrop) and mounts the consultation chat page full-viewport.
import { onBeforeMount, onBeforeUnmount } from 'vue'
import ChatView from '@/views/ChatView.vue'
import NanoSceneBackdrop from '@/components/shell/NanoSceneBackdrop.vue'
import { provideNanoSceneController } from '@/composables/useNanoSceneController'

const IMMERSIVE_BODY_CLASS = 'chat-immersive-active'

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
.demo-shell {
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

<template>
  <Teleport to="body" :disabled="resolvedMode === 'dock'">
    <Transition name="workbench">
      <div
        v-if="open"
        ref="layerRef"
        class="workbench-layer"
        :class="[`mode-${resolvedMode}`, `kind-${resolvedKind}`]"
        @click.self="requestClose"
        @keydown.capture="handleEscape"
        @keydown="trapFocus"
      >
        <section
          ref="panelRef"
          class="workbench-panel"
          :role="isModal || resolvedMode === 'popover' ? 'dialog' : 'region'"
          :aria-modal="isModal ? 'true' : undefined"
          :aria-labelledby="titleId"
          :style="popoverStyle"
        >
          <header class="workbench-header">
            <div>
              <span class="workbench-kicker">{{ kindLabel }}</span>
              <h2 :id="titleId" tabindex="-1">{{ title }}</h2>
            </div>
            <button class="icon-command" type="button" aria-label="关闭工作台" @click="requestClose">
              <el-icon :size="18"><X /></el-icon>
            </button>
          </header>
          <div class="workbench-content"><slot /></div>
          <footer v-if="$slots.footer" class="workbench-footer"><slot name="footer" /></footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Close as X } from '@element-plus/icons-vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  kind: { type: String, default: 'context' },
  mode: { type: String, default: 'drawer' },
  title: { type: String, required: true },
  closeOnEscape: { type: Boolean, default: true },
  anchorRect: { type: Object, default: null },
  placement: { type: String, default: 'bottom-end' },
})

const emit = defineEmits(['update:open', 'request-close', 'after-open', 'after-close'])
const layerRef = ref(null)
const panelRef = ref(null)
const titleId = `workbench-${Math.random().toString(36).slice(2, 9)}`
const supportedModes = new Set(['drawer', 'sheet', 'dialog', 'dock', 'popover'])
const supportedKinds = new Set(['context', 'patient', 'protocols', 'filters', 'delete', 'permission'])
const resolvedMode = computed(() => supportedModes.has(props.mode) ? props.mode : 'drawer')
const resolvedKind = computed(() => supportedKinds.has(props.kind) ? props.kind : 'context')
const isModal = computed(() => !['dock', 'popover'].includes(resolvedMode.value))
const popoverStyle = computed(() => {
  if (resolvedMode.value !== 'popover' || !props.anchorRect) return undefined
  const rect = props.anchorRect
  const viewportWidth = typeof window === 'undefined' ? 1440 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight
  const right = Math.max(12, viewportWidth - Number(rect.right || 0))
  const left = Math.max(12, Number(rect.left || 0))
  const top = Math.max(12, Number(rect.bottom || 0) + 10)
  const bottom = Math.max(12, viewportHeight - Number(rect.top || 0) + 10)
  const opensUp = props.placement.startsWith('top')
  const alignsStart = props.placement.endsWith('start')
  return {
    '--workbench-anchor-right': `${right}px`,
    '--workbench-anchor-left': `${left}px`,
    '--workbench-anchor-top': `${top}px`,
    '--workbench-anchor-bottom': `${bottom}px`,
    top: opensUp ? 'auto' : 'var(--workbench-anchor-top)',
    bottom: opensUp ? 'var(--workbench-anchor-bottom)' : 'auto',
    right: alignsStart ? 'auto' : 'var(--workbench-anchor-right)',
    left: alignsStart ? 'var(--workbench-anchor-left)' : 'auto',
  }
})
let appRoot = null
let appWasInert = false
let ownsModalIsolation = false

const kindLabel = computed(() => ({
  patient: 'Patient context',
  protocols: 'Training protocol',
  filters: 'Analysis filters',
  delete: 'Destructive action',
  permission: 'Permission required',
}[resolvedKind.value] || 'Context'))

function requestClose() {
  setModalIsolation(false)
  emit('request-close')
  emit('update:open', false)
}

function handleEscape(event) {
  if (event.key !== 'Escape' || !props.closeOnEscape) return
  event.preventDefault()
  event.stopPropagation()
  requestClose()
}

function getFocusableElements() {
  if (!panelRef.value) return []
  return [...panelRef.value.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true')
}

function trapFocus(event) {
  if (!isModal.value || event.key !== 'Tab') return
  const focusable = getFocusableElements()
  if (!focusable.length) {
    event.preventDefault()
    panelRef.value?.querySelector('h2')?.focus()
    return
  }

  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const activeElement = document.activeElement
  if (event.shiftKey && (activeElement === first || !focusable.includes(activeElement))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function setModalIsolation(active) {
  if (typeof document === 'undefined') return
  appRoot = document.getElementById('app')
  if (!appRoot) return

  if (active) {
    if (ownsModalIsolation) return
    appWasInert = appRoot.hasAttribute('inert')
    appRoot.setAttribute('inert', '')
    document.body.classList.add('has-workbench')
    ownsModalIsolation = true
  } else {
    if (!ownsModalIsolation) return
    if (!appWasInert) appRoot.removeAttribute('inert')
    document.body.classList.remove('has-workbench')
    ownsModalIsolation = false
  }
}

watch(() => props.open, async (open) => {
  if (open) {
    if (isModal.value) setModalIsolation(true)
    await nextTick()
    panelRef.value?.querySelector('h2')?.focus()
    emit('after-open')
    return
  }

  setModalIsolation(false)
  emit('after-close')
}, { immediate: true })

watch(resolvedMode, async (mode, previousMode) => {
  if (!props.open || mode === previousMode) return
  setModalIsolation(!['dock', 'popover'].includes(mode))
  await nextTick()
  panelRef.value?.querySelector('h2')?.focus()
})

onBeforeUnmount(() => {
  setModalIsolation(false)
})
</script>

<style scoped>
.workbench-layer {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  justify-content: flex-end;
  background: rgb(0 0 0 / 46%);
}

.workbench-panel {
  --workbench-surface: var(--consult-surface, var(--cq-surface, #121613));
  --workbench-surface-subtle: var(--consult-surface-subtle, var(--cq-surface-strong, #181D1A));
  --workbench-text: var(--consult-text, var(--cq-text, #F1F4EE));
  --workbench-muted: var(--consult-text-muted, var(--cq-text-muted, #A7B0A7));
  --workbench-line: var(--consult-line, var(--cq-rule, rgb(241 244 238 / 12%)));
  --workbench-line-strong: var(--consult-line-strong, var(--cq-rule-strong, rgb(241 244 238 / 24%)));
  --workbench-primary: var(--consult-primary, var(--cq-signal, #C8F43D));
  --workbench-focus: var(--consult-focus, var(--cq-focus, #DDFB80));
  --workbench-shadow: var(--consult-shadow-float, 0 18px 48px rgb(0 0 0 / 32%));
  width: min(380px, 100%);
  height: 100%;
  border-left: 1px solid var(--workbench-line);
  background: var(--workbench-surface);
  color: var(--workbench-text);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  font-family: var(--font-chat, var(--font-family));
}

:global(html[data-theme='light']) .workbench-panel {
  --workbench-surface: var(--consult-surface, #FFFFFF);
  --workbench-surface-subtle: var(--consult-surface-subtle, #E9EFEC);
  --workbench-text: var(--consult-text, #18201C);
  --workbench-muted: var(--consult-text-muted, #526059);
  --workbench-line: var(--consult-line, rgb(24 32 28 / 14%));
  --workbench-line-strong: var(--consult-line-strong, rgb(24 32 28 / 28%));
  --workbench-primary: var(--consult-primary, #90BE22);
  --workbench-focus: var(--consult-focus, #526FA8);
  --workbench-shadow: var(--consult-shadow-float, 0 16px 40px rgb(18 32 25 / 12%));
}

:global(html[data-theme='light']) .workbench-layer {
  background: rgb(24 32 28 / 34%);
}

.workbench-header {
  min-height: 64px;
  padding: 10px 12px 10px 16px;
  border-bottom: 1px solid var(--workbench-line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.workbench-kicker {
  display: block;
  margin-bottom: 3px;
  color: var(--workbench-muted);
  font: 500 10px/14px var(--font-chat-data, var(--font-data));
  letter-spacing: 0;
}

.workbench-header h2 {
  margin: 0;
  color: var(--workbench-text);
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
}

.workbench-content {
  min-height: 0;
  overflow: auto;
  padding: 16px;
}

.workbench-footer {
  padding: 12px 16px;
  border-top: 1px solid var(--workbench-line);
}

.icon-command {
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  border: 1px solid var(--workbench-line-strong);
  border-radius: 6px;
  background: transparent;
  color: var(--workbench-muted);
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: transform 120ms ease-out, border-color 120ms ease-out, background-color 120ms ease-out;
}

.icon-command:hover,
.icon-command:focus-visible {
  border-color: var(--workbench-focus);
  background: color-mix(in srgb, var(--workbench-primary) 10%, transparent);
  color: var(--workbench-text);
}
.icon-command:active { transform: scale(.98); }

.mode-drawer .workbench-panel { width: min(360px, 100%); }
.mode-sheet { align-items: flex-end; }
.mode-sheet .workbench-panel { width: 100%; height: min(78dvh, 720px); border-left: 0; border-top: 1px solid var(--workbench-line); }
.mode-dialog { justify-content: center; align-items: center; padding: 20px; }
.mode-dialog .workbench-panel { width: min(520px, 100%); height: auto; max-height: min(78dvh, 720px); border: 1px solid var(--workbench-line); border-radius: 8px; }
.mode-dock { position: static; z-index: auto; min-width: 0; width: 100%; height: 100%; overflow: hidden; background: none; }
.mode-dock .workbench-panel { width: 100%; min-width: 320px; height: 100%; }
.mode-popover { inset: 0; background: transparent; pointer-events: none; }
.mode-popover .workbench-panel {
  position: fixed;
  width: clamp(360px, 29vw, 420px);
  height: auto;
  max-height: min(70dvh, 680px);
  border: 1px solid var(--workbench-line-strong);
  border-radius: 8px;
  background: color-mix(in srgb, var(--workbench-surface) 92%, transparent);
  box-shadow: var(--workbench-shadow);
  backdrop-filter: blur(16px) saturate(108%);
  pointer-events: auto;
  overflow: hidden;
}
.mode-popover .workbench-header { min-height: 66px; padding: 13px 15px; }
.mode-popover .workbench-content { padding: 14px; }
.workbench-enter-active { transition: opacity 140ms ease-out; }
.workbench-leave-active { transition: opacity 100ms ease-in; }
.workbench-enter-active .workbench-panel { transition: transform 220ms cubic-bezier(.23, 1, .32, 1); }
.workbench-leave-active .workbench-panel { transition: transform 100ms ease-in; }
.workbench-enter-from, .workbench-leave-to { opacity: 0; }
.workbench-enter-from .workbench-panel, .workbench-leave-to .workbench-panel { transform: translateX(100%); }
.mode-sheet.workbench-enter-from .workbench-panel, .mode-sheet.workbench-leave-to .workbench-panel { transform: translateY(100%); }
.mode-popover.workbench-enter-from .workbench-panel, .mode-popover.workbench-leave-to .workbench-panel { transform: translateY(-8px) scale(.985); }
.mode-popover.workbench-enter-active,
.mode-popover.workbench-enter-active .workbench-panel { transition: none; }
:global(body.has-workbench) { overflow: hidden; }
@supports not (backdrop-filter: blur(1px)) {
  .mode-popover .workbench-panel { background: var(--workbench-surface); }
}
@media (prefers-reduced-motion: reduce) { .workbench-enter-active, .workbench-leave-active, .workbench-enter-active .workbench-panel, .workbench-leave-active .workbench-panel { transition: none; } }
</style>

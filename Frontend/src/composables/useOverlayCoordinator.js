import { computed, onUnmounted, ref, unref } from 'vue'

function resolveFocusTarget(target) {
  const candidate = typeof target === 'function' ? target() : unref(target)
  return candidate?.isConnected && typeof candidate.focus === 'function' ? candidate : null
}

/** Coordinates mutually exclusive context workbenches and blocking overlays. */
export function useOverlayCoordinator(options = {}) {
  const { fallbackFocusTarget = null } = options
  const activeContext = ref(null)
  const blocking = ref(null)
  let contextTrigger = null
  let blockingTrigger = null

  function currentTrigger(explicitTrigger) {
    if (explicitTrigger) return explicitTrigger
    if (typeof document === 'undefined' || document.activeElement === document.body) return null
    return document.activeElement
  }

  function restoreFocus(trigger, fallback = fallbackFocusTarget) {
    const target = resolveFocusTarget(trigger) ?? resolveFocusTarget(fallback)
    target?.focus()
  }

  function openContext(kind, trigger) {
    if (!kind || blocking.value) return false
    activeContext.value = kind
    contextTrigger = currentTrigger(trigger)
    return true
  }

  function closeContext({ restore = true, fallback = fallbackFocusTarget } = {}) {
    if (!activeContext.value) return false
    const trigger = contextTrigger
    activeContext.value = null
    contextTrigger = null
    if (restore) restoreFocus(trigger, fallback)
    return true
  }

  function openBlocking(kind, trigger) {
    if (!kind) return false
    blockingTrigger = currentTrigger(trigger)
    closeContext({ restore: false })
    blocking.value = kind
    return true
  }

  function closeBlocking({ restore = true, fallback = fallbackFocusTarget } = {}) {
    if (!blocking.value) return false
    const trigger = blockingTrigger
    blocking.value = null
    blockingTrigger = null
    if (restore) restoreFocus(trigger, fallback)
    return true
  }

  function handleKeydown(event) {
    if (event.key === 'Escape' && !blocking.value) closeContext()
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', handleKeydown)
  }

  onUnmounted(() => {
    if (typeof document !== 'undefined') {
      document.removeEventListener('keydown', handleKeydown)
    }
  })

  return {
    activeContext,
    context: activeContext,
    blocking,
    blockingOverlay: blocking,
    hasContext: computed(() => activeContext.value !== null),
    hasBlocking: computed(() => blocking.value !== null),
    isContextOpen: (kind) => activeContext.value === kind,
    openContext,
    closeContext,
    openBlocking,
    closeBlocking,
  }
}

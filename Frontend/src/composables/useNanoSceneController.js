import { getCurrentInstance, inject, onScopeDispose, provide, readonly, ref, shallowRef } from 'vue'

import { normalizeExclusionRect } from '@/utils/nanoSceneGeometry'

export const NANO_SCENE_CONTROLLER_KEY = Symbol('nano-scene-controller')

function callAdapter(adapter, method, ...args) {
  const handler = adapter?.[method]
  return typeof handler === 'function' ? handler(...args) : undefined
}

export function createNanoSceneController() {
  const exclusionRect = shallowRef(null)
  const phase = ref('settled')
  const layoutRevision = ref(0)
  let rendererAdapter = null

  function setExclusionRect(rect) {
    exclusionRect.value = normalizeExclusionRect(rect)
    callAdapter(rendererAdapter, 'setExclusionRect', exclusionRect.value)
    return exclusionRect.value
  }

  function collapse() {
    phase.value = 'collapsed'
    callAdapter(rendererAdapter, 'collapse')
  }

  function settle() {
    phase.value = 'settled'
    callAdapter(rendererAdapter, 'settle')
  }

  function refreshLayout() {
    layoutRevision.value += 1
    callAdapter(rendererAdapter, 'refreshLayout')
    return layoutRevision.value
  }

  function getDiagnostics() {
    const rendererDiagnostics = callAdapter(rendererAdapter, 'getDiagnostics') || {}
    return {
      phase: phase.value,
      hasExclusion: exclusionRect.value !== null,
      layoutRevision: layoutRevision.value,
      attached: rendererAdapter !== null,
      ...rendererDiagnostics,
    }
  }

  function attachRenderer(adapter) {
    if (!adapter || typeof adapter !== 'object') return () => {}
    rendererAdapter = adapter
    callAdapter(rendererAdapter, 'setExclusionRect', exclusionRect.value)
    if (phase.value === 'collapsed') callAdapter(rendererAdapter, 'collapse')
    else callAdapter(rendererAdapter, 'settle')
    callAdapter(rendererAdapter, 'refreshLayout')

    let detached = false
    return () => {
      if (detached) return
      detached = true
      detachRenderer(adapter)
    }
  }

  function detachRenderer(adapter = null) {
    if (adapter && rendererAdapter !== adapter) return false
    if (!rendererAdapter) return false
    rendererAdapter = null
    return true
  }

  function dispose() {
    exclusionRect.value = null
    phase.value = 'settled'
    layoutRevision.value = 0
    rendererAdapter = null
  }

  return {
    exclusionRect: readonly(exclusionRect),
    phase: readonly(phase),
    layoutRevision: readonly(layoutRevision),
    setExclusionRect,
    collapse,
    settle,
    refreshLayout,
    getDiagnostics,
    attachRenderer,
    detachRenderer,
    dispose,
  }
}

const defaultController = createNanoSceneController()

export function provideNanoSceneController(controller = createNanoSceneController()) {
  provide(NANO_SCENE_CONTROLLER_KEY, controller)
  onScopeDispose(() => controller.dispose())
  return controller
}

export function useNanoSceneController() {
  if (!getCurrentInstance()) return defaultController
  return inject(NANO_SCENE_CONTROLLER_KEY, defaultController)
}

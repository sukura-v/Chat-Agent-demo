<template>
  <div
    ref="hostRef"
    class="nano-scene"
    :class="{
      'is-ready': webglReady,
      'is-fallback': fallbackReason,
      'is-collapsed': collapsed,
      'is-message-state': isMessageState,
    }"
    :data-scene-mode="mode"
    :data-scene-status="status"
    aria-hidden="true"
    data-nano-scene
  >
    <canvas
      ref="posterCanvasRef"
      class="nano-scene__poster"
    />
    <canvas
      ref="webglCanvasRef"
      class="nano-scene__webgl"
      @webglcontextlost="handleContextLost"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'

import { useNanoSceneController } from '@/composables/useNanoSceneController'
import {
  NANO_QUALITY_PROFILES,
  createNanoPointData,
  easeOutNano,
  modeToValue,
  normalizeExclusionRect,
  rectToNdc,
  selectNanoQuality,
} from '@/utils/nanoSceneGeometry'

const props = defineProps({
  mode: {
    type: String,
    default: 'consultation',
    validator: (value) => ['dashboard', 'consultation', 'analytics'].includes(value),
  },
  theme: {
    type: String,
    default: 'light',
    validator: (value) => ['light', 'dark'].includes(value),
  },
  consultationPhase: {
    type: String,
    default: 'welcome',
  },
  exclusionRect: {
    type: Object,
    default: null,
  },
  quality: {
    type: String,
    default: 'auto',
    validator: (value) => ['auto', 'high', 'medium', 'low'].includes(value),
  },
  paused: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['ready', 'quality-change', 'fallback'])

const hostRef = ref(null)
const posterCanvasRef = ref(null)
const webglCanvasRef = ref(null)
const webglReady = ref(false)
const fallbackReason = ref('')
const status = ref('idle')
const collapsed = ref(false)
const activeQuality = shallowRef(null)
const averageFps = ref(0)
const contextLost = ref(false)
const controller = useNanoSceneController()
const runtimeExclusionRect = shallowRef(normalizeExclusionRect(props.exclusionRect))

const isMessageState = computed(
  () =>
    props.mode === 'consultation' &&
    ['message', 'messages', 'messages-stable', 'streaming'].includes(props.consultationPhase),
)

let THREE = null
let scene = null
let camera = null
let renderer = null
let geometry = null
let material = null
let points = null
let resizeObserver = null
let reducedMotionQuery = null
let detachController = null
let idleHandle = null
let frameHandle = null
let loadGeneration = 0
let disposed = false
let documentHidden = false
let reducedMotion = false
let lastFrameTime = 0
let fpsWindowStartedAt = 0
let fpsWindowFrames = 0
let lowFpsWindows = 0
let morph = {
  from: modeToValue(props.mode),
  to: modeToValue(props.mode),
  startedAt: 0,
  active: false,
}

const diagnostics = {
  status: 'idle',
  mode: props.mode,
  quality: null,
  pointCount: 0,
  dpr: 0,
  renderCalls: 0,
  rafActive: false,
  reducedMotion: false,
  saveData: false,
  contextLost: false,
  averageFps: 0,
  exclusionNdc: null,
}

const vertexShader = `
  uniform float uTime;
  uniform float uMode;
  uniform float uMotion;
  uniform float uDpr;
  uniform float uSceneOpacity;
  uniform float uExclusionActive;
  uniform float uPushNdc;
  uniform vec4 uExclusion;
  uniform float uExclusionRadius;

  attribute vec3 aLattice;
  attribute float aSeed;
  attribute float aFlow;

  varying float vAlpha;
  varying float vSeed;
  varying float vBand;

  float roundedBoxSdf(vec2 point, vec2 halfSize, float radius) {
    vec2 q = abs(point) - max(halfSize - vec2(radius), vec2(0.0));
    return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - radius;
  }

  void main() {
    float analyticsMix = smoothstep(1.08, 1.92, uMode);
    float dashboardMix = 1.0 - smoothstep(0.0, 0.94, uMode);
    vec3 transformed = mix(position, aLattice, analyticsMix);

    transformed.xy *= mix(1.0, 0.86, dashboardMix);
    transformed.x += dashboardMix * 0.64;

    float yaw = sin(uTime * 0.153) * 0.0436332 * uMotion * (1.0 - analyticsMix);
    float yawCos = cos(yaw);
    float yawSin = sin(yaw);
    transformed.xz = mat2(yawCos, -yawSin, yawSin, yawCos) * transformed.xz;

    float microPhase = uTime * 0.21 + aSeed * 31.4159;
    transformed.z += sin(microPhase) * 0.0024 * uMotion;
    transformed.x += cos(microPhase * 0.73) * 0.0016 * uMotion;
    transformed.xz += vec2(cos(microPhase), sin(microPhase)) * aFlow * 0.0045 * uMotion;

    vec4 clip = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
    vec2 ndc = clip.xy / max(clip.w, 0.0001);
    float exclusionDistance = roundedBoxSdf(
      ndc - uExclusion.xy,
      uExclusion.zw,
      uExclusionRadius
    );
    float exclusionFade = mix(
      1.0,
      smoothstep(-0.018, 0.024, exclusionDistance),
      uExclusionActive
    );
    float push = (
      1.0 - smoothstep(0.0, 0.075, max(exclusionDistance, 0.0))
    ) * uPushNdc * uExclusionActive;
    vec2 pushDirection = normalize(ndc - uExclusion.xy + vec2(0.0001, 0.0));
    clip.xy += pushDirection * push * clip.w;

    float latitude = transformed.y * 0.34 + 0.5;
    float bandCenter = fract(uTime / 30.0);
    float bandDistance = abs(fract(latitude - bandCenter + 0.5) - 0.5);
    vBand = exp(-bandDistance * bandDistance * 180.0);
    vSeed = aSeed;
    vAlpha = exclusionFade * uSceneOpacity;

    gl_Position = clip;
    gl_PointSize = mix(1.05, 1.78, aSeed) * uDpr * (1.0 + vBand * 0.36);
  }
`

const fragmentShader = `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uAccent;

  varying float vAlpha;
  varying float vSeed;
  varying float vBand;

  void main() {
    vec2 point = gl_PointCoord - vec2(0.5);
    float radius = length(point);
    if (radius > 0.5) discard;

    float edge = 1.0 - smoothstep(0.34, 0.5, radius);
    vec3 base = mix(uColorA, uColorB, smoothstep(0.18, 0.86, vSeed));
    vec3 color = mix(base, uAccent, vBand * 0.54);
    float opacity = edge * vAlpha * mix(0.38, 0.82, vSeed) * (1.0 + vBand * 0.52);
    gl_FragColor = vec4(color, opacity);
  }
`

function getDeviceSignals() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection
  return {
    dpr: Math.max(1, window.devicePixelRatio || 1),
    hardwareConcurrency: Math.max(1, navigator.hardwareConcurrency || 4),
    deviceMemory: Math.max(1, navigator.deviceMemory || 4),
    saveData: connection?.saveData === true,
  }
}

function getHostRect() {
  const host = hostRef.value
  if (!host) return null
  const rect = host.getBoundingClientRect()
  if (!(rect.width > 0 && rect.height > 0)) return null
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  }
}

function exclusionGap(width) {
  if (width >= 1200) return 48
  if (width >= 768) return 36
  return 24
}

function updateExclusionUniform() {
  const viewportRect = getHostRect()
  const exclusion = viewportRect
    ? rectToNdc(runtimeExclusionRect.value, viewportRect, exclusionGap(viewportRect.width))
    : null

  diagnostics.exclusionNdc = exclusion ? { ...exclusion } : null
  if (!material) return

  const uniforms = material.uniforms
  uniforms.uExclusionActive.value = exclusion ? 1 : 0
  if (exclusion) {
    uniforms.uExclusion.value.set(
      exclusion.centerX,
      exclusion.centerY,
      exclusion.halfWidth,
      exclusion.halfHeight,
    )
    uniforms.uExclusionRadius.value = exclusion.radius
  }
}

function getThemeColors() {
  if (props.theme === 'dark') {
    return {
      colorA: '#65C6C1',
      colorB: '#8FA8DF',
      accent: '#B8D84A',
      poster: 'rgba(101, 198, 193, 0.30)',
      posterAccent: 'rgba(184, 216, 74, 0.43)',
    }
  }
  return {
    colorA: '#167C78',
    colorB: '#526FA8',
    accent: '#91B62B',
    poster: 'rgba(22, 124, 120, 0.22)',
    posterAccent: 'rgba(82, 111, 168, 0.31)',
  }
}

function updateThemeUniforms() {
  if (!material || !THREE) return
  const colors = getThemeColors()
  material.uniforms.uColorA.value.set(colors.colorA)
  material.uniforms.uColorB.value.set(colors.colorB)
  material.uniforms.uAccent.value.set(colors.accent)
  renderStaticFrame()
}

function drawPoster() {
  const canvas = posterCanvasRef.value
  const viewportRect = getHostRect()
  if (!canvas || !viewportRect || navigator.userAgent?.includes('jsdom')) return

  let context
  try {
    context = canvas.getContext('2d', { alpha: true })
  } catch (_) {
    return
  }
  if (!context) return

  const posterDpr = Math.min(window.devicePixelRatio || 1, 1.25)
  const pixelWidth = Math.max(1, Math.round(viewportRect.width * posterDpr))
  const pixelHeight = Math.max(1, Math.round(viewportRect.height * posterDpr))
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth
    canvas.height = pixelHeight
  }
  canvas.style.width = `${viewportRect.width}px`
  canvas.style.height = `${viewportRect.height}px`

  context.setTransform(posterDpr, 0, 0, posterDpr, 0, 0)
  context.clearRect(0, 0, viewportRect.width, viewportRect.height)
  // 完全消除背景点阵，保持画布纯净清爽
}

function updateSceneOpacity() {
  if (!material) return
  material.uniforms.uSceneOpacity.value = 0.0
}

function resizeRenderer() {
  const viewportRect = getHostRect()
  if (!viewportRect) return

  drawPoster()
  if (!renderer || !camera || !material || !activeQuality.value) return

  const deviceDpr = Math.max(1, window.devicePixelRatio || 1)
  const dpr = Math.min(deviceDpr, activeQuality.value.dpr)
  renderer.setPixelRatio(dpr)
  renderer.setSize(viewportRect.width, viewportRect.height, false)
  camera.aspect = viewportRect.width / viewportRect.height
  camera.position.z = camera.aspect < 0.76 ? 6.35 : camera.aspect < 1 ? 5.65 : 5.05
  camera.updateProjectionMatrix()

  material.uniforms.uDpr.value = dpr
  material.uniforms.uPushNdc.value = 10 / Math.min(viewportRect.width, viewportRect.height)
  diagnostics.dpr = dpr
  updateExclusionUniform()
  renderStaticFrame()
}

function renderFrame(time = performance.now()) {
  if (!renderer || !scene || !camera || !material || contextLost.value) return
  const seconds = time / 1000
  material.uniforms.uTime.value = seconds
  material.uniforms.uMotion.value = reducedMotion ? 0 : 1

  if (morph.active) {
    const progress = Math.min(1, Math.max(0, (time - morph.startedAt) / 220))
    material.uniforms.uMode.value = morph.from + (morph.to - morph.from) * easeOutNano(progress)
    if (progress >= 1) morph.active = false
  }

  renderer.render(scene, camera)
  diagnostics.renderCalls = renderer.info.render.calls
}

function renderStaticFrame() {
  if (!renderer) return
  renderFrame(performance.now())
}

function shouldRunAnimation() {
  return (
    !disposed &&
    renderer !== null &&
    !props.paused &&
    !collapsed.value &&
    !documentHidden &&
    !reducedMotion &&
    !contextLost.value &&
    !fallbackReason.value
  )
}

function stopAnimation() {
  if (frameHandle !== null) cancelAnimationFrame(frameHandle)
  frameHandle = null
  diagnostics.rafActive = false
}

function applyQuality(profile, reason = 'initial') {
  if (!profile || !geometry || !renderer) return
  if (activeQuality.value?.name === profile.name && reason !== 'initial') return

  activeQuality.value = profile
  geometry.setDrawRange(0, profile.count)
  diagnostics.quality = profile.name
  diagnostics.pointCount = profile.count
  resizeRenderer()
  emit('quality-change', {
    quality: profile.name,
    count: profile.count,
    dpr: diagnostics.dpr,
    reason,
  })
}

function samplePerformance(time) {
  if (!fpsWindowStartedAt) fpsWindowStartedAt = time
  fpsWindowFrames += 1
  const elapsed = time - fpsWindowStartedAt
  if (elapsed < 2000) return

  const fps = (fpsWindowFrames * 1000) / elapsed
  averageFps.value = Math.round(fps * 10) / 10
  diagnostics.averageFps = averageFps.value
  fpsWindowStartedAt = time
  fpsWindowFrames = 0

  const current = activeQuality.value
  if (!current || current.name === 'low') return
  if (fps < current.minFps) lowFpsWindows += 1
  else lowFpsWindows = 0
  if (lowFpsWindows < 2) return

  const viewportRect = getHostRect()
  const signals = getDeviceSignals()
  const nextProfile = selectNanoQuality({
    requested: props.quality,
    width: viewportRect?.width || 0,
    height: viewportRect?.height || 0,
    ...signals,
    current,
    averageFps: fps,
    mobile: (viewportRect?.width || 0) < 768,
  })
  lowFpsWindows = 0
  if (nextProfile && nextProfile.name !== current.name)
    applyQuality(nextProfile, 'sustained-low-fps')
}

function animate(time) {
  frameHandle = null
  if (!shouldRunAnimation()) {
    diagnostics.rafActive = false
    return
  }

  if (lastFrameTime && time - lastFrameTime > 1000) {
    fpsWindowStartedAt = time
    fpsWindowFrames = 0
  }
  lastFrameTime = time
  renderFrame(time)
  samplePerformance(time)
  frameHandle = requestAnimationFrame(animate)
  diagnostics.rafActive = true
}

function syncAnimation() {
  stopAnimation()
  if (shouldRunAnimation()) {
    lastFrameTime = 0
    fpsWindowStartedAt = 0
    fpsWindowFrames = 0
    frameHandle = requestAnimationFrame(animate)
    diagnostics.rafActive = true
  } else {
    renderStaticFrame()
  }
}

function markFallback(reason) {
  if (disposed || fallbackReason.value) return
  fallbackReason.value = reason
  status.value = 'fallback'
  diagnostics.status = 'fallback'
  diagnostics.saveData = reason === 'save-data'
  stopAnimation()
  drawPoster()
  emit('fallback', { reason, diagnostics: getDiagnostics() })
}

function supportsWebGL() {
  const canvas = webglCanvasRef.value
  if (!canvas || typeof canvas.getContext !== 'function') return null
  try {
    return canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      powerPreference: 'high-performance',
      premultipliedAlpha: true,
    })
  } catch (_) {
    return null
  }
}

async function initializeThree() {
  const generation = ++loadGeneration
  const signals = getDeviceSignals()
  diagnostics.saveData = signals.saveData
  if (signals.saveData) {
    markFallback('save-data')
    return
  }

  const webglContext = supportsWebGL()
  if (!webglContext) {
    markFallback('webgl-unavailable')
    return
  }

  status.value = 'loading'
  diagnostics.status = 'loading'

  try {
    const threeModule = await import('@/utils/nanoThreeRuntime')
    if (disposed || generation !== loadGeneration) return
    THREE = threeModule

    const viewportRect = getHostRect()
    const profile = selectNanoQuality({
      requested: props.quality,
      width: viewportRect?.width || 0,
      height: viewportRect?.height || 0,
      ...signals,
      mobile: (viewportRect?.width || 0) < 768,
    })
    if (!profile) {
      markFallback('quality-disabled')
      return
    }

    scene = new THREE.Scene()
    camera = new THREE.PerspectiveCamera(34, 1, 0.1, 20)
    camera.position.set(0, 0, 5.05)

    const pointData = createNanoPointData()
    geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(pointData.facePositions, 3))
    geometry.setAttribute('aLattice', new THREE.BufferAttribute(pointData.latticePositions, 3))
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(pointData.seeds, 1))
    geometry.setAttribute('aFlow', new THREE.BufferAttribute(pointData.flow, 1))
    geometry.computeBoundingSphere()

    const colors = getThemeColors()
    material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMode: { value: modeToValue(props.mode) },
        uMotion: { value: reducedMotion ? 0 : 1 },
        uDpr: { value: 1 },
        uSceneOpacity: { value: 0.0 },
        uExclusionActive: { value: 0 },
        uPushNdc: { value: 0.01 },
        uExclusion: { value: new THREE.Vector4(0, 0, 0, 0) },
        uExclusionRadius: { value: 0.02 },
        uColorA: { value: new THREE.Color(colors.colorA) },
        uColorB: { value: new THREE.Color(colors.colorB) },
        uAccent: { value: new THREE.Color(colors.accent) },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NormalBlending,
    })

    points = new THREE.Points(geometry, material)
    points.frustumCulled = false
    scene.add(points)

    renderer = new THREE.WebGLRenderer({
      canvas: webglCanvasRef.value,
      context: webglContext,
      alpha: true,
      antialias: false,
      depth: false,
      powerPreference: 'high-performance',
      premultipliedAlpha: true,
    })
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace

    applyQuality(profile, 'initial')
    updateThemeUniforms()
    updateSceneOpacity()
    resizeRenderer()
    renderStaticFrame()

    webglReady.value = true
    status.value = 'ready'
    diagnostics.status = 'ready'
    emit('ready', getDiagnostics())
    syncAnimation()
  } catch (_) {
    markFallback('initialization-failed')
  }
}

function scheduleInitialization() {
  const initialize = () => {
    idleHandle = null
    initializeThree()
  }
  if (typeof window.requestIdleCallback === 'function') {
    idleHandle = window.requestIdleCallback(initialize, { timeout: 500 })
  } else {
    idleHandle = window.setTimeout(initialize, 0)
  }
}

function cancelScheduledInitialization() {
  if (idleHandle === null) return
  if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idleHandle)
  else window.clearTimeout(idleHandle)
  idleHandle = null
}

function setMode(nextMode) {
  diagnostics.mode = nextMode
  const target = modeToValue(nextMode)
  drawPoster()
  if (!material) return

  if (reducedMotion || props.paused || collapsed.value) {
    morph = { from: target, to: target, startedAt: 0, active: false }
    material.uniforms.uMode.value = target
    renderStaticFrame()
    return
  }

  morph = {
    from: material.uniforms.uMode.value,
    to: target,
    startedAt: performance.now(),
    active: true,
  }
  syncAnimation()
}

function setExclusionRect(rect) {
  runtimeExclusionRect.value = normalizeExclusionRect(rect)
  updateExclusionUniform()
  drawPoster()
  renderStaticFrame()
  return runtimeExclusionRect.value
}

function collapse() {
  collapsed.value = true
  updateSceneOpacity()
  syncAnimation()
}

function settle() {
  collapsed.value = false
  updateSceneOpacity()
  syncAnimation()
}

function refreshLayout() {
  nextTick(resizeRenderer)
}

function getDiagnostics() {
  return {
    ...diagnostics,
    quality: activeQuality.value?.name || diagnostics.quality,
    pointCount: activeQuality.value?.count || diagnostics.pointCount,
    reducedMotion,
    contextLost: contextLost.value,
    averageFps: averageFps.value,
    exclusionNdc: diagnostics.exclusionNdc ? { ...diagnostics.exclusionNdc } : null,
  }
}

function handleContextLost(event) {
  event?.preventDefault?.()
  contextLost.value = true
  diagnostics.contextLost = true
  markFallback('context-lost')
}

function handleVisibilityChange() {
  documentHidden = document.visibilityState === 'hidden'
  syncAnimation()
}

function handleReducedMotionChange(event) {
  reducedMotion = event.matches === true
  diagnostics.reducedMotion = reducedMotion
  if (material) {
    material.uniforms.uMotion.value = reducedMotion ? 0 : 1
    if (reducedMotion) {
      const target = modeToValue(props.mode)
      morph = { from: target, to: target, startedAt: 0, active: false }
      material.uniforms.uMode.value = target
    }
  }
  syncAnimation()
}

function teardownThree() {
  stopAnimation()
  if (points && scene) scene.remove(points)
  geometry?.dispose?.()
  material?.dispose?.()
  renderer?.dispose?.()
  renderer?.forceContextLoss?.()
  points = null
  geometry = null
  material = null
  renderer = null
  camera = null
  scene = null
  THREE = null
  diagnostics.status = 'disposed'
  diagnostics.renderCalls = 0
  diagnostics.rafActive = false
}

watch(() => props.mode, setMode)
watch(
  () => props.theme,
  () => {
    drawPoster()
    updateThemeUniforms()
  },
)
watch(() => props.exclusionRect, setExclusionRect, { deep: true })
watch(() => props.paused, syncAnimation)
watch(isMessageState, () => {
  updateSceneOpacity()
  renderStaticFrame()
})
watch(
  () => props.quality,
  () => {
    if (!geometry || !renderer) return
    const viewportRect = getHostRect()
    const profile = selectNanoQuality({
      requested: props.quality,
      width: viewportRect?.width || 0,
      height: viewportRect?.height || 0,
      ...getDeviceSignals(),
      current: activeQuality.value,
      mobile: (viewportRect?.width || 0) < 768,
    })
    if (profile) applyQuality(profile, 'requested')
  },
)

onMounted(() => {
  disposed = false
  diagnostics.status = 'poster'
  status.value = 'poster'
  drawPoster()

  reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') || null
  reducedMotion = reducedMotionQuery?.matches === true
  diagnostics.reducedMotion = reducedMotion
  reducedMotionQuery?.addEventListener?.('change', handleReducedMotionChange)
  document.addEventListener('visibilitychange', handleVisibilityChange)

  resizeObserver = new ResizeObserver(refreshLayout)
  if (hostRef.value) resizeObserver.observe(hostRef.value)

  const adapter = {
    collapse,
    settle,
    refreshLayout,
    getDiagnostics,
    setExclusionRect,
  }
  detachController = controller.attachRenderer(adapter)
  scheduleInitialization()
})

onBeforeUnmount(() => {
  disposed = true
  loadGeneration += 1
  cancelScheduledInitialization()
  detachController?.()
  detachController = null
  resizeObserver?.disconnect?.()
  resizeObserver = null
  reducedMotionQuery?.removeEventListener?.('change', handleReducedMotionChange)
  reducedMotionQuery = null
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  teardownThree()
})

defineExpose({
  collapse,
  settle,
  refreshLayout,
  getDiagnostics,
  setExclusionRect,
})
</script>

<style scoped>
.nano-scene {
  position: absolute;
  z-index: 0;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  contain: strict;
  isolation: isolate;
  opacity: 1;
  transition: opacity 140ms ease-out;
}

.nano-scene__poster-image,
.nano-scene__poster,
.nano-scene__webgl {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.nano-scene__poster-image {
  z-index: 0;
  object-fit: contain;
  object-position: center;
  opacity: 0.34;
  transition: opacity 140ms ease-in;
}

.nano-scene__poster {
  z-index: 1;
  opacity: 0.74;
  transition: opacity 140ms ease-in;
}

.nano-scene__webgl {
  z-index: 2;
  opacity: 0;
  filter: saturate(0.9);
  transition: opacity 140ms ease-out;
}

.nano-scene.is-ready .nano-scene__poster-image,
.nano-scene.is-ready .nano-scene__poster {
  opacity: 0;
}

.nano-scene.is-ready .nano-scene__webgl {
  opacity: 1;
}

.nano-scene.is-collapsed {
  opacity: 0.22;
  transition: opacity 100ms ease-in;
}

.nano-scene.is-message-state .nano-scene__webgl {
  filter: saturate(0.72);
}

.nano-scene.is-fallback .nano-scene__poster-image {
  opacity: 0.46;
}

.nano-scene.is-fallback .nano-scene__poster {
  opacity: 0.7;
}

@media (prefers-reduced-motion: reduce) {
  .nano-scene,
  .nano-scene__poster-image,
  .nano-scene__poster,
  .nano-scene__webgl {
    transition: none;
  }
}
</style>

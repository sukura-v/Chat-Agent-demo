<template>
  <figure
    ref="rootRef"
    class="head-study"
    :class="[`head-study--${endpointOrientation}`, { 'is-dynamic': rendererState === 'dynamic', 'is-sequencing': sequencePlaying }]"
    :data-head-orientation="endpointOrientation"
    :data-head-tier="tier"
    :data-head-state="rendererState"
    :data-head-backend="activeBackend || 'unavailable'"
    :data-sequence-playing="String(sequencePlaying)"
    aria-hidden="true"
    @pointerdown="handlePointerDown"
    @pointermove="handlePointerMove"
    @pointerleave="handlePointerLeave"
    @pointerup="handlePointerEnd"
    @pointercancel="handlePointerEnd"
  >
    <span class="head-study__axis head-study__axis--x" />
    <span class="head-study__axis head-study__axis--y" />
    <span class="head-study__index">{{ endpointOrientation === 'front' ? '00°' : '90°' }}</span>
    <div class="head-study__plate">
      <img
        ref="endpointImageRef"
        class="head-study__image"
        :src="endpointUrl"
        alt=""
        decoding="async"
        draggable="false"
      >
      <canvas
        ref="sequenceCanvasRef"
        class="head-study__sequence-canvas"
        aria-hidden="true"
      />
      <canvas
        v-if="shouldRenderCanvas"
        ref="canvasRef"
        class="head-study__canvas"
      />
    </div>
    <figcaption>
      <span>{{ endpointOrientation === 'front' ? 'FRONTAL CALIBRATION' : 'PROFILE CALIBRATION' }}</span>
      <strong>{{ endpointOrientation === 'front' ? '正视基准' : '侧视基准' }}</strong>
    </figcaption>
  </figure>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import {
  DEFAULT_HEAD_SCENE_MANIFEST,
  getHeadSceneCoverAlignment,
  getHeadSceneFramePath,
  resolveHeadSceneRuntimeAssets,
} from '@/head-scene/runtimeManifest.js'
import {
  HeadSceneWebGpuRuntime,
} from '@/head-scene/headSceneWebGpuRuntime.js'
import {
  HeadSceneRuntime,
  loadHeadSceneRuntimeManifest,
} from '@/head-scene/headSceneRuntime.js'

const props = defineProps({
  orientation: {
    type: String,
    default: 'front',
    validator: value => ['front', 'profile'].includes(value),
  },
  capability: {
    type: String,
    default: 'auto',
    validator: value => ['auto', 'high', 'medium', 'low'].includes(value),
  },
  baseUrl: { type: String, default: '/head-scene-v1' },
  manifest: { type: Object, default: null },
  active: { type: Boolean, default: true },
})

const emit = defineEmits(['ready', 'state-change', 'capability-change', 'sequence-progress', 'sequence-done', 'sequence-error'])

const rootRef = ref(null)
const canvasRef = ref(null)
const sequenceCanvasRef = ref(null)
const endpointImageRef = ref(null)
const manifestRef = ref(props.manifest || DEFAULT_HEAD_SCENE_MANIFEST)
const endpointOrientation = ref(props.orientation)
const rendererState = ref('static')
const tier = ref('low')
const activeBackend = ref(null)
const sequencePlaying = ref(false)
const alignmentLocked = ref(false)
const sequenceBitmaps = new Map()
const pointerClientPositions = new Map()
const MIN_POINTER_TRAVEL_PX = 0.75
let runtime = null
let disposed = false
let sequenceRun = 0
let sequenceAbortController = null
let sequenceRafId = null
let sequenceWindowCenter = null
let sequenceWindowDirection = 'forward'
let activeTouchPointerId = null
const shouldRenderCanvas = typeof window !== 'undefined'
  && !(typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || ''))
let preferredWebGpuAdapterPromise = null

function requestPreferredWebGpuAdapter() {
  if (typeof navigator === 'undefined' || !navigator.gpu) return Promise.resolve(null)
  if (!preferredWebGpuAdapterPromise) {
    preferredWebGpuAdapterPromise = navigator.gpu
      .requestAdapter({ powerPreference: 'high-performance' })
  }
  return preferredWebGpuAdapterPromise
}

const endpointUrl = computed(() => {
  const endpoint = manifestRef.value?.endpoints?.[endpointOrientation.value]
  return getHeadSceneFramePath(manifestRef.value, endpoint?.frameIndex, props.baseUrl)
})

function setCanvasVisibility(visible) {
  if (!canvasRef.value) return
  canvasRef.value.style.visibility = visible ? 'visible' : 'hidden'
  canvasRef.value.style.opacity = visible ? '1' : '0'
}

function setEndpointVisibility(visible) {
  if (!endpointImageRef.value) return
  endpointImageRef.value.hidden = !visible
  endpointImageRef.value.style.visibility = visible ? 'visible' : 'hidden'
  endpointImageRef.value.style.opacity = visible ? '1' : '0'
}

function setSequenceVisibility(visible) {
  if (!sequenceCanvasRef.value) return
  sequenceCanvasRef.value.style.visibility = visible ? 'visible' : 'hidden'
  sequenceCanvasRef.value.style.opacity = visible ? '1' : '0'
}

function handleRuntimeState(change) {
  if (Object.prototype.hasOwnProperty.call(change, 'activeBackend')) {
    activeBackend.value = change.activeBackend
  }
  if (change.tier) {
    tier.value = change.tier
    emit('capability-change', change.tier)
  }
  if (change.state) rendererState.value = change.state === 'dynamic' ? 'dynamic' : 'static'
  const canvasVisible = props.active && rendererState.value === 'dynamic' && !sequencePlaying.value
  setCanvasVisibility(canvasVisible)
  setEndpointVisibility(!canvasVisible && !sequencePlaying.value)
  if (!props.active) runtime?.suspendRendering?.()
  emit('state-change', change)
  if (change.state === 'dynamic' || (change.state === 'static' && change.reason)) emit('ready', change)
}

function pointerFromEvent(event) {
  const rect = canvasRef.value?.getBoundingClientRect?.()
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return null
  }
  const surfaceX = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
  const surfaceY = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
  return {
    surfaceUv: [surfaceX, surfaceY],
    timestamp: event.timeStamp,
  }
}

function forwardPointerSamples(event) {
  const coalesced = event.getCoalescedEvents?.()
  const samples = coalesced?.length ? coalesced : [event]
  samples.forEach(sample => {
    const pointerId = Number.isFinite(sample.pointerId) ? sample.pointerId : event.pointerId
    const clientPosition = [Number(sample.clientX), Number(sample.clientY)]
    const previousClientPosition = pointerClientPositions.get(pointerId)
    if (
      previousClientPosition
      && Math.hypot(
        clientPosition[0] - previousClientPosition[0],
        clientPosition[1] - previousClientPosition[1],
      ) < MIN_POINTER_TRAVEL_PX
    ) {
      return
    }
    const pointer = pointerFromEvent(sample)
    if (pointer) {
      pointerClientPositions.set(pointerId, clientPosition)
      runtime?.setPointer(pointer)
    }
  })
}

function handlePointerDown(event) {
  if (!props.active || alignmentLocked.value || !runtime || rendererState.value !== 'dynamic' || sequencePlaying.value) return
  if (event.pointerType !== 'touch') return
  if (activeTouchPointerId !== null && activeTouchPointerId !== event.pointerId) return
  activeTouchPointerId = event.pointerId
  rootRef.value?.setPointerCapture?.(event.pointerId)
  forwardPointerSamples(event)
}

function handlePointerMove(event) {
  if (!props.active || alignmentLocked.value || !runtime || rendererState.value !== 'dynamic' || sequencePlaying.value) return
  if (event.pointerType === 'touch' && activeTouchPointerId !== event.pointerId) return
  forwardPointerSamples(event)
}

function handlePointerLeave(event) {
  if (event?.pointerType === 'touch' && rootRef.value?.hasPointerCapture?.(event.pointerId)) return
  pointerClientPositions.delete(event?.pointerId)
  runtime?.resetPointer?.()
}

function handlePointerEnd(event) {
  if (event.pointerType !== 'touch') return
  if (activeTouchPointerId !== event.pointerId) return
  if (rootRef.value?.hasPointerCapture?.(event.pointerId)) {
    rootRef.value.releasePointerCapture(event.pointerId)
  }
  activeTouchPointerId = null
  pointerClientPositions.delete(event.pointerId)
  runtime?.resetPointer?.()
}

const SEQUENCE_WINDOW_RADIUS = 3

function sequenceBounds(direction = 'forward') {
  const sequence = manifestRef.value?.sequence
  if (!sequence) throw new Error('Head-scene sequence manifest is unavailable')
  const forward = direction !== 'reverse' && direction !== 'backward'
  return {
    forward,
    start: forward ? sequence.firstFrameIndex : sequence.lastFrameIndex,
    end: forward ? sequence.lastFrameIndex : sequence.firstFrameIndex,
    step: forward ? 1 : -1,
  }
}

function sequenceFrameUrl(frameIndex) {
  return getHeadSceneFramePath(manifestRef.value, frameIndex, props.baseUrl)
}

function closeSequenceBitmap(frameIndex) {
  const bitmap = sequenceBitmaps.get(frameIndex)
  if (!bitmap) return
  bitmap.close?.()
  sequenceBitmaps.delete(frameIndex)
}

function trimSequenceWindow(centerIndex, direction = 'forward') {
  const { step } = sequenceBounds(direction)
  const keep = new Set()
  for (let offset = -SEQUENCE_WINDOW_RADIUS; offset <= SEQUENCE_WINDOW_RADIUS; offset += 1) {
    keep.add(centerIndex + offset * step)
  }
  for (const frameIndex of sequenceBitmaps.keys()) {
    if (typeof frameIndex !== 'number') continue
    if (!keep.has(frameIndex)) closeSequenceBitmap(frameIndex)
  }
}

function loadSequenceBitmap(frameIndex, signal) {
  if (sequenceBitmaps.has(frameIndex)) return Promise.resolve(sequenceBitmaps.get(frameIndex))
  const current = sequenceBitmaps.get(`loading:${frameIndex}`)
  if (current) return current
  if (typeof createImageBitmap !== 'function') {
    return Promise.reject(new Error('ImageBitmap decoding is unavailable'))
  }
  const promise = fetch(sequenceFrameUrl(frameIndex), { signal })
    .then(response => {
      if (!response.ok) throw new Error(`Sequence frame request failed: ${response.status}`)
      return response.blob()
    })
    .then(blob => createImageBitmap(blob))
    .then(bitmap => {
      sequenceBitmaps.set(frameIndex, bitmap)
      if (sequenceWindowCenter !== null) {
        trimSequenceWindow(sequenceWindowCenter, sequenceWindowDirection)
      }
      return bitmap
    })
    .finally(() => sequenceBitmaps.delete(`loading:${frameIndex}`))
  sequenceBitmaps.set(`loading:${frameIndex}`, promise)
  return promise
}

function maintainSequenceWindow(centerIndex, direction, signal) {
  const { forward, end } = sequenceBounds(direction)
  sequenceWindowCenter = centerIndex
  sequenceWindowDirection = direction
  const pending = []
  for (let offset = 0; offset <= SEQUENCE_WINDOW_RADIUS; offset += 1) {
    const frameIndex = centerIndex + (forward ? offset : -offset)
    if (forward ? frameIndex > end : frameIndex < end) break
    pending.push(loadSequenceBitmap(frameIndex, signal))
  }
  return pending
}

function resizeSequenceCanvas() {
  const canvas = sequenceCanvasRef.value
  const rect = canvas?.getBoundingClientRect?.()
  const source = manifestRef.value?.canvas
  if (!canvas || !rect || !source || rect.width <= 0 || rect.height <= 0) {
    throw new Error('Sequence canvas has no drawable size')
  }
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
  const width = Math.max(1, Math.round(rect.width * pixelRatio))
  const height = Math.max(1, Math.round(rect.height * pixelRatio))
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  return { canvas, width, height, pixelRatio, source }
}

function drawSequenceBitmap(frameIndex) {
  const bitmap = sequenceBitmaps.get(frameIndex)
  if (!bitmap) return false
  const { canvas, width, height, pixelRatio, source } = resizeSequenceCanvas()
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('Sequence canvas 2D context is unavailable')
  const displayWidth = width / pixelRatio
  const displayHeight = height / pixelRatio
  const alignment = getHeadSceneCoverAlignment(
    manifestRef.value,
    displayWidth,
    displayHeight,
    endpointOrientation.value,
  )
  const [cropScaleX, cropScaleY] = alignment.cropScale
  const [cropOffsetX, cropOffsetY] = alignment.cropOffset
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.fillStyle = source.backgroundColor || '#F3F6F4'
  context.fillRect(0, 0, width, height)
  context.drawImage(
    bitmap,
    cropOffsetX * source.width,
    cropOffsetY * source.height,
    cropScaleX * source.width,
    cropScaleY * source.height,
    0,
    0,
    width,
    height,
  )
  setSequenceVisibility(true)
  setEndpointVisibility(false)
  return true
}

async function preloadSequence({ direction = 'forward' } = {}) {
  if (disposed || !props.active) return false
  const controller = sequenceAbortController || new AbortController()
  sequenceAbortController = controller
  const { start } = sequenceBounds(direction)
  try {
    await Promise.all(maintainSequenceWindow(start, direction, controller.signal))
    trimSequenceWindow(start, direction)
    return true
  } catch (error) {
    if (controller.signal.aborted) return false
    emit('sequence-error', { direction, error })
    return false
  }
}

function emitDrawnSequenceFrame(frameIndex, sequence) {
  if (!drawSequenceBitmap(frameIndex)) return false
  emit('sequence-progress', {
    frameIndex,
    drawnFrameIndex: frameIndex,
    frameCount: sequence.frameCount,
    normalizedFrameIndex: (frameIndex - sequence.firstFrameIndex) / Math.max(sequence.frameCount - 1, 1),
    progress: (frameIndex - sequence.firstFrameIndex) / Math.max(sequence.frameCount - 1, 1),
  })
  return true
}

function emitSequenceClock(frameIndex, drawnFrameIndex, progress, sequence) {
  emit('sequence-progress', {
    frameIndex,
    scheduledFrameIndex: frameIndex,
    drawnFrameIndex,
    frameCount: sequence.frameCount,
    normalizedFrameIndex: progress,
    progress,
    source: 'clock',
  })
}

function waitAnimationFrames(count = 3) {
  return new Promise(resolve => {
    let remaining = count
    const tick = () => {
      remaining -= 1
      if (remaining <= 0) resolve()
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

async function handoffToInteractiveSurface() {
  if (!props.active || endpointOrientation.value !== props.orientation || rendererState.value !== 'dynamic') return false
  const sequenceRect = sequenceCanvasRef.value?.getBoundingClientRect?.()
  const canvasRect = canvasRef.value?.getBoundingClientRect?.()
  if (!sequenceRect || !canvasRect || sequenceRect.width <= 0 || sequenceRect.height <= 0) return false
  const aligned = ['left', 'top', 'width', 'height'].every(key => Math.abs(sequenceRect[key] - canvasRect[key]) <= 0.5)
  if (!aligned) return false
  runtime?.resize?.()
  runtime?.resumeRendering?.()
  setCanvasVisibility(true)
  setSequenceVisibility(true)
  await waitAnimationFrames(3)
  if (disposed || !props.active) return false
  setSequenceVisibility(false)
  setEndpointVisibility(false)
  return true
}

/**
 * Play WebP frames from the manifest using the actual drawn index as the clock
 * source. The canvas is only an aspect-ratio adapter; all head composition is
 * authored by the frame itself.
 */
async function playSequence({ direction = 'forward' } = {}) {
  if (disposed || !props.active || sequencePlaying.value) return false
  const sequence = manifestRef.value?.sequence
  if (!sequence) return false
  const runId = ++sequenceRun
  const controller = sequenceAbortController?.signal?.aborted
    ? new AbortController()
    : (sequenceAbortController || new AbortController())
  sequenceAbortController = controller
  const { forward, start, end, step } = sequenceBounds(direction)
  sequencePlaying.value = true
  alignmentLocked.value = true
  runtime?.suspendRendering?.()
  setCanvasVisibility(false)
  setSequenceVisibility(false)
  setEndpointVisibility(true)

  let completed = false
  let handedOff = false
  try {
    if (!await preloadSequence({ direction })) throw new Error('Sequence prefetch failed')
    if (!sequenceBitmaps.has(start) || !emitDrawnSequenceFrame(start, sequence)) {
      throw new Error(`Sequence start frame failed to draw: ${start}`)
    }
    let lastDrawnFrameIndex = start
    const startedAt = performance.now()
    const frameDurationMs = Math.max(1, Number(sequence.frameDurationSeconds || 0.082) * 1000)
    const totalDurationMs = frameDurationMs * Math.max(sequence.frameCount - 1, 1)
    let windowFailure = null
    await new Promise((resolve, reject) => {
      const tick = now => {
        if (disposed || !props.active || runId !== sequenceRun || controller.signal.aborted) {
          reject(new Error('Sequence playback was interrupted'))
          return
        }
        if (windowFailure) {
          reject(windowFailure)
          return
        }
        const elapsed = Math.max(0, now - startedAt)
        const elapsedProgress = Math.min(1, elapsed / totalDurationMs)
        const clockProgress = forward ? elapsedProgress : 1 - elapsedProgress
        const elapsedIndex = Math.floor(elapsed / frameDurationMs)
        const targetFrameIndex = Math.min(
          Math.max(start + elapsedIndex * step, Math.min(start, end)),
          Math.max(start, end),
        )
        const loadPromises = maintainSequenceWindow(targetFrameIndex, direction, controller.signal)
        Promise.all(loadPromises).catch(error => { windowFailure = error })

        if (targetFrameIndex !== lastDrawnFrameIndex && sequenceBitmaps.has(targetFrameIndex)) {
          if (!emitDrawnSequenceFrame(targetFrameIndex, sequence)) {
            reject(new Error(`Sequence frame failed to draw: ${targetFrameIndex}`))
            return
          }
          lastDrawnFrameIndex = targetFrameIndex
          trimSequenceWindow(targetFrameIndex, direction)
        }

        // Geometry follows the monotonic playback clock on every paint. Bitmap
        // decoding may skip scheduled frames, but the surrounding UI must not
        // stall and then sprint to its endpoint when a decode finishes late.
        emitSequenceClock(targetFrameIndex, lastDrawnFrameIndex, clockProgress, sequence)

        if (targetFrameIndex === end && sequenceBitmaps.has(end)) {
          resolve()
          return
        }
        if (elapsed >= totalDurationMs) {
          reject(new Error(`Sequence endpoint frame was not ready: ${end}`))
          return
        }
        sequenceRafId = requestAnimationFrame(tick)
      }
      sequenceRafId = requestAnimationFrame(tick)
    })

    const finalOrientation = forward ? 'profile' : 'front'
    endpointOrientation.value = finalOrientation
    setSequenceVisibility(true)
    handedOff = await handoffToInteractiveSurface()
    completed = true
    emit('sequence-done', { direction, endpoint: endpointOrientation.value, frameIndex: end })
    return true
  } catch (error) {
    if (!controller.signal.aborted) emit('sequence-error', { direction, error })
    return false
  } finally {
    if (runId === sequenceRun) {
      if (sequenceRafId !== null) cancelAnimationFrame(sequenceRafId)
      sequenceRafId = null
      sequencePlaying.value = false
      alignmentLocked.value = false
      if (completed && handedOff) {
        setSequenceVisibility(false)
        setEndpointVisibility(false)
        setCanvasVisibility(true)
      } else if (completed) {
        setSequenceVisibility(true)
        setEndpointVisibility(false)
        setCanvasVisibility(false)
      } else {
        setSequenceVisibility(false)
        setEndpointVisibility(true)
      }
    }
  }
}

async function stopSequence({ restoreEndpoint = true } = {}) {
  sequenceRun += 1
  sequenceAbortController?.abort()
  sequenceAbortController = null
  if (sequenceRafId !== null) cancelAnimationFrame(sequenceRafId)
  sequenceRafId = null
  sequencePlaying.value = false
  alignmentLocked.value = false
  sequenceWindowCenter = null
  for (const frameIndex of [...sequenceBitmaps.keys()]) {
    if (typeof frameIndex === 'number') closeSequenceBitmap(frameIndex)
  }
  if (restoreEndpoint) {
    endpointOrientation.value = props.orientation
    setSequenceVisibility(false)
    setEndpointVisibility(true)
  }
  runtime?.suspendRendering?.()
  return true
}

function setPointer(pointer) {
  if (!props.active || alignmentLocked.value) return false
  return runtime?.setPointer(pointer) || false
}

function resetPointer() {
  pointerClientPositions.clear()
  return runtime?.resetPointer() || false
}

function lockInteraction() {
  alignmentLocked.value = true
  pointerClientPositions.clear()
  runtime?.resetPointer?.()
  runtime?.suspendRendering?.()
  setSequenceVisibility(false)
  setCanvasVisibility(false)
  setEndpointVisibility(true)
  return true
}

function unlockInteraction() {
  alignmentLocked.value = false
  if (props.active && !sequencePlaying.value && rendererState.value === 'dynamic') {
    runtime?.resumeRendering?.()
  }
  return true
}

function getDiagnostics() {
  return {
    ...runtime?.getDiagnostics?.(),
    sequencePlaying: sequencePlaying.value,
    endpointUrl: endpointUrl.value,
  }
}

async function mountRuntime() {
  try {
    manifestRef.value = props.manifest || await loadHeadSceneRuntimeManifest()
  } catch {
    manifestRef.value = DEFAULT_HEAD_SCENE_MANIFEST
  }
  if (disposed || !endpointImageRef.value) return
  const assets = resolveHeadSceneRuntimeAssets(manifestRef.value, 'low', props.baseUrl)
  endpointImageRef.value.src = assets.endpoints[props.orientation]
  if (disposed || !canvasRef.value) return
  let preferredAdapter
  try {
    preferredAdapter = await requestPreferredWebGpuAdapter()
  } catch (error) {
    if (!disposed) {
      handleRuntimeState({
        state: 'static',
        tier: 'low',
        backend: 'unavailable',
        preferredBackend: 'webgpu',
        activeBackend: null,
        reason: 'webgpu-adapter-request-failed',
        error,
      })
    }
    return
  }
  if (disposed || !canvasRef.value) return
  const Runtime = preferredAdapter ? HeadSceneWebGpuRuntime : HeadSceneRuntime
  runtime = new Runtime({
    canvas: canvasRef.value,
    orientation: props.orientation,
    capability: props.capability,
    baseUrl: props.baseUrl,
    manifest: manifestRef.value,
    onStateChange: handleRuntimeState,
    ...(preferredAdapter ? { adapter: preferredAdapter } : {}),
  })
  await runtime.init()
  if (disposed) {
    runtime.dispose()
    runtime = null
  } else if (!props.active) {
    runtime.suspendRendering?.()
  }
}

onMounted(() => {
  void mountRuntime()
})

watch(
  () => props.active,
  active => {
    pointerClientPositions.clear()
    runtime?.resetPointer?.()
    if (!active) {
      void stopSequence({ restoreEndpoint: false })
      setCanvasVisibility(false)
      return
    }
    if (
      !sequencePlaying.value
      && endpointOrientation.value === props.orientation
      && runtime?.getDiagnostics?.().state === 'dynamic'
    ) {
      rendererState.value = 'dynamic'
      runtime.resumeRendering?.()
      setCanvasVisibility(true)
      setEndpointVisibility(false)
    }
  },
)

onBeforeUnmount(() => {
  disposed = true
  sequenceRun += 1
  sequenceAbortController?.abort()
  if (sequenceRafId !== null) cancelAnimationFrame(sequenceRafId)
  sequenceRafId = null
  activeTouchPointerId = null
  pointerClientPositions.clear()
  for (const frameIndex of [...sequenceBitmaps.keys()]) {
    if (typeof frameIndex === 'number') closeSequenceBitmap(frameIndex)
  }
  runtime?.dispose?.()
  runtime = null
  sequenceBitmaps.clear()
})

defineExpose({
  playSequence,
  preloadSequence,
  stopSequence,
  lockInteraction,
  unlockInteraction,
  setPointer,
  resetPointer,
  getDiagnostics,
})
</script>

<style scoped>
.head-study {
  --head-ink: var(--lab-ink, #171918);
  --head-line: var(--lab-line, rgb(23 25 24 / 22%));
  position: relative;
  width: 100%;
  min-width: 0;
  min-height: 0;
  margin: 0;
  color: var(--head-ink);
  isolation: isolate;
  touch-action: none;
}

.head-study__plate {
  position: absolute;
  inset: 8% 8% 13%;
  display: grid;
  place-items: center;
  overflow: hidden;
  background: var(--lab-paper, #F1F2EE);
}

.head-study__image,
.head-study__sequence-canvas,
.head-study__canvas {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: center;
  border: 0;
}

.head-study__image {
  opacity: 1;
  filter: none;
  mix-blend-mode: normal;
}

.head-study.is-dynamic .head-study__image {
  opacity: 0;
}

.head-study__sequence-canvas {
  z-index: 2;
  visibility: hidden;
  opacity: 0;
  pointer-events: none;
}

.head-study__canvas {
  z-index: 1;
  visibility: hidden;
  opacity: 0;
  pointer-events: none;
}

.head-study--profile .head-study__plate {
  inset-inline: 14% 2%;
  clip-path: polygon(8% 0, 72% 0, 72% 13%, 85% 22%, 82% 35%, 98% 48%, 80% 57%, 76% 76%, 60% 100%, 8% 100%);
}

.head-study__axis {
  position: absolute;
  z-index: -1;
  background: var(--head-line);
  pointer-events: none;
}

.head-study__axis--x {
  left: 0;
  right: 0;
  top: 50%;
  height: 1px;
}

.head-study__axis--y {
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
}

.head-study__index,
.head-study figcaption {
  font-family: var(--font-chat-data, "IBM Plex Mono", monospace);
  font-size: 10px;
  line-height: 14px;
  letter-spacing: .04em;
}

.head-study__index {
  position: absolute;
  top: 4px;
  right: 0;
  color: var(--lab-orange, #F0642E);
}

.head-study figcaption {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding-top: 7px;
  border-top: 1px solid var(--head-line);
}

.head-study figcaption span { color: var(--lab-muted, #696D69); }
.head-study figcaption strong { color: var(--head-ink); font-weight: 600; }

@media (prefers-reduced-motion: reduce) {
.head-study__image,
.head-study__sequence-canvas,
.head-study__canvas { transition: none; }
}
</style>

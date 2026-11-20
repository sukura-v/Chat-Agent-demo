<template>
  <section
    ref="rootRef"
    class="chat-lab-layout"
    :class="[`is-${state}`, { 'is-entering': entering }]"
    :data-experience-state="state"
    data-testid="chat-lab-layout"
  >
    <div
      class="chat-lab-layout__grid"
      aria-hidden="true"
    >
      <span
        v-for="track in 12"
        :key="track"
        data-testid="grid-track"
      />
    </div>

    <header class="chat-lab-layout__masthead">
      <div class="chat-lab-layout__brand">
        <span>ORAL REHAB / LAB OS</span>
        <strong>{{ title }}</strong>
      </div>
      <div
        class="chat-lab-layout__state"
        aria-live="polite"
      >
        <span>STATIC ENDPOINT</span>
        <strong>{{ state === 'landing' ? 'LANDING / 00' : 'CHAT / 01' }}</strong>
      </div>
      <slot name="utility" />
    </header>

    <ChatSessionRail
      ref="sessionRailRef"
      class="chat-lab-layout__session-rail"
      :sessions="sessions"
      :current-thread-id="currentThreadId"
      :pending-thread-id="pendingThreadId"
      :failed-thread-id="failedThreadId"
      :session-load-error="sessionLoadError"
      :loading="sessionsLoading"
      :error="sessionsError"
      :locked="sessionRailLocked"
      :new-session-disabled="sessionRailNewDisabled"
      :new-session-label="sessionRailNewLabel"
      @select="$emit('select-session', $event)"
      @create="handleCreateSession"
      @retry="$emit('retry-sessions')"
      @retry-session="$emit('retry-session', $event)"
      @delete="$emit('delete-session', $event)"
    />

    <section
      class="chat-lab-layout__landing"
      :class="{ 'is-hidden': state !== 'landing' && !entering }"
      :aria-hidden="String(state !== 'landing' && !entering)"
      :inert="state !== 'landing' && !entering"
      data-testid="landing-surface"
    >
      <div class="chat-lab-layout__landing-head">
        <ChatHeadStudy
          ref="landingHeadRef"
          orientation="front"
          :active="state === 'landing' || entering"
          @sequence-progress="$emit('entry-progress', $event)"
          @sequence-error="$emit('entry-error', $event)"
        />
      </div>
      <div class="chat-lab-layout__landing-copy">
        <span>CLINICAL MULTI-AGENT CONSULTATION</span>
        <h1
          tabindex="-1"
          data-consultation-primary-title
        >从一次清晰描述开始</h1>
        <p>描述训练表现、口腔动作或康复疑问，三位智能体会共同整理下一步。</p>
      </div>
      <div class="chat-lab-layout__landing-actions">
        <slot name="landing-actions" />
      </div>
    </section>

    <section
      class="chat-lab-layout__chat"
      :class="{ 'is-hidden': state !== 'chat' && !entering }"
      :aria-hidden="String(state !== 'chat' && !entering)"
      :inert="state !== 'chat' && !entering"
      data-testid="chat-surface"
    >
      <aside class="chat-lab-layout__left">
        <div class="chat-lab-layout__profile-head">
          <ChatHeadStudy
            orientation="profile"
            :active="state === 'chat'"
          />
        </div>
      </aside>

      <main class="chat-lab-layout__main">
        <header class="chat-lab-layout__conversation-heading">
          <span>ACTIVE CONSULTATION</span>
          <h1
            tabindex="-1"
            data-consultation-primary-title
          >{{ title }}</h1>
          <slot name="conversation-meta" />
          <span class="chat-lab-layout__conversation-structure" aria-hidden="true" />
        </header>
        <div class="chat-lab-layout__transcript">
          <slot name="transcript" />
        </div>
      </main>
    </section>

    <div
      class="chat-lab-layout__composer"
      data-testid="composer-host"
    >
      <span
        class="chat-lab-layout__composer-index"
        aria-hidden="true"
      >INPUT / 01</span>
      <slot name="composer" />
    </div>
  </section>
</template>

<script setup>
import { ref } from 'vue'

import ChatHeadStudy from '@/components/chat/ChatHeadStudy.vue'
import ChatSessionRail from '@/components/chat/ChatSessionRail.vue'

defineProps({
  state: {
    type: String,
    default: 'landing',
    validator: value => ['landing', 'chat'].includes(value),
  },
  title: { type: String, default: '口腔康复会诊' },
  sessions: { type: Array, default: () => [] },
  currentThreadId: { type: String, default: '' },
  pendingThreadId: { type: String, default: '' },
  failedThreadId: { type: String, default: '' },
  sessionLoadError: { type: String, default: '' },
  sessionsLoading: Boolean,
  sessionsError: { type: String, default: '' },
  entering: Boolean,
  sessionRailLocked: Boolean,
  sessionRailNewDisabled: Boolean,
  sessionRailNewLabel: { type: String, default: '当前已是新会话' },
})

const emit = defineEmits([
  'select-session',
  'create-session',
  'retry-sessions',
  'retry-session',
  'delete-session',
  'entry-progress',
  'entry-error',
])

const rootRef = ref(null)
const landingHeadRef = ref(null)
const sessionRailRef = ref(null)

function getEntryTargets() {
  const root = rootRef.value
  const landingCopy = root?.querySelector('.chat-lab-layout__landing-copy')
  const landingActions = root?.querySelector('.chat-lab-layout__landing-actions')
  const chatHeading = root?.querySelector('.chat-lab-layout__conversation-heading')
  const chatTranscript = root?.querySelector('.chat-lab-layout__transcript')
  const chatProfile = root?.querySelector('.chat-lab-layout__profile-head')
  return {
    history: root?.querySelector('.chat-lab-layout__session-rail'),
    title: [
      root?.querySelector('.chat-lab-layout__conversation-heading > span:not(.chat-lab-layout__conversation-structure)'),
      root?.querySelector('.chat-lab-layout__conversation-heading h1'),
      root?.querySelector('.consultation-status-rail'),
    ].filter(Boolean),
    structure: root?.querySelector('.chat-lab-layout__conversation-structure'),
    messages: chatTranscript,
    composer: root?.querySelector('.chat-lab-layout__composer'),
    landingCopy,
    landingActions,
    landingOnly: [landingCopy, landingActions].filter(Boolean),
    chatHeading,
    chatTranscript,
    chatProfile,
    // The profile renderer is the continuous media surface, not part of the
    // UI cross-slide. It is handed off separately at the sequence endpoint.
    chatOnly: [chatHeading, chatTranscript].filter(Boolean),
  }
}

let entryGeometry = null
let frozenEntryGeometry = null

const GEOMETRY_STYLE_PROPERTIES = [
  'left',
  'top',
  'right',
  'bottom',
  'width',
  'height',
  'marginInline',
]
const RAIL_FADE_OUT_END = 0.18
const RAIL_GEOMETRY_SWITCH = 0.45
const RAIL_FADE_IN_START = 0.72
const RAIL_FADE_IN_END = 0.92

function normalizeEntryDirection(direction) {
  return direction === 'reverse' || direction === 'backward' ? 'reverse' : 'forward'
}

function readGeometry(target, rootRect) {
  const rect = target?.getBoundingClientRect?.()
  if (!rect || !(rect.width > 0 && rect.height > 0)) return null
  return {
    left: rect.left - rootRect.left,
    top: rect.top - rootRect.top,
    width: rect.width,
    height: rect.height,
  }
}

function measureEntryGeometry() {
  const root = rootRef.value
  const targets = getEntryTargets()
  if (!root || !targets.history || !targets.composer) return false
  const previousMode = root.dataset.entryMeasure || ''
  const geometryTargets = [targets.history, targets.composer]
  const previousInlineGeometry = geometryTargets.map(target => (
    Object.fromEntries(GEOMETRY_STYLE_PROPERTIES.map(property => [property, target.style[property]]))
  ))
  geometryTargets.forEach(target => {
    GEOMETRY_STYLE_PROPERTIES.forEach(property => {
      target.style[property] = ''
    })
  })
  try {
    const read = mode => {
      root.dataset.entryMeasure = mode
      void root.offsetWidth
      const rootRect = root.getBoundingClientRect()
      return {
        history: readGeometry(targets.history, rootRect),
        composer: readGeometry(targets.composer, rootRect),
      }
    }
    entryGeometry = { start: read('landing'), end: read('chat') }
  } finally {
    if (previousMode) root.dataset.entryMeasure = previousMode
    else delete root.dataset.entryMeasure
    geometryTargets.forEach((target, index) => {
      GEOMETRY_STYLE_PROPERTIES.forEach(property => {
        target.style[property] = previousInlineGeometry[index][property]
      })
    })
  }
  return Boolean(entryGeometry.start.history && entryGeometry.end.history && entryGeometry.start.composer && entryGeometry.end.composer)
}

function applyGeometry(target, start, end, progress) {
  if (!target || !start || !end) return
  const mix = (from, to) => from + (to - from) * progress
  target.style.left = `${mix(start.left, end.left)}px`
  target.style.top = `${mix(start.top, end.top)}px`
  target.style.width = `${mix(start.width, end.width)}px`
  target.style.height = `${mix(start.height, end.height)}px`
  target.style.right = 'auto'
  target.style.bottom = 'auto'
  target.style.marginInline = '0'
}

function applyRailProgress(target, geometry, progress) {
  const selectedGeometry = progress < RAIL_GEOMETRY_SWITCH
    ? geometry.start.history
    : geometry.end.history
  applyGeometry(target, selectedGeometry, selectedGeometry, 0)

  let opacity = 1
  if (progress <= RAIL_FADE_OUT_END) {
    opacity = 1 - progress / RAIL_FADE_OUT_END
  } else if (progress < RAIL_FADE_IN_START) {
    opacity = 0
  } else if (progress < RAIL_FADE_IN_END) {
    opacity = (progress - RAIL_FADE_IN_START) / (RAIL_FADE_IN_END - RAIL_FADE_IN_START)
  }

  const hidden = progress >= RAIL_FADE_OUT_END && progress <= RAIL_FADE_IN_START
  target.style.opacity = String(Math.min(1, Math.max(0, opacity)))
  target.style.visibility = hidden ? 'hidden' : 'visible'
  target.style.pointerEvents = opacity < 1 ? 'none' : ''
  target.style.willChange = 'opacity, left, top, width, height'
}

function freezeEntryGeometry(direction = 'reverse') {
  const root = rootRef.value
  const targets = getEntryTargets()
  if (!root || !targets.history || !targets.composer) return false
  const rootRect = root.getBoundingClientRect()
  const current = {
    history: readGeometry(targets.history, rootRect),
    composer: readGeometry(targets.composer, rootRect),
  }
  if (!current.history || !current.composer) return false

  const normalizedDirection = normalizeEntryDirection(direction)
  frozenEntryGeometry = { direction: normalizedDirection, current }
  root.dataset.entryFrozen = normalizedDirection
  applyGeometry(targets.history, current.history, current.history, 0)
  applyGeometry(targets.composer, current.composer, current.composer, 0)
  return true
}

function prepareEntryGeometry(direction = 'forward') {
  const root = rootRef.value
  const targets = getEntryTargets()
  const normalizedDirection = normalizeEntryDirection(direction)
  const frozen = frozenEntryGeometry?.direction === normalizedDirection
    ? frozenEntryGeometry
    : null
  if (!measureEntryGeometry()) return false
  if (frozen) {
    const endpoint = normalizedDirection === 'reverse' ? 'end' : 'start'
    entryGeometry[endpoint] = {
      history: frozen.current.history,
      composer: frozen.current.composer,
    }
  }
  const progress = normalizedDirection === 'reverse' ? 1 : 0
  root.dataset.entryProgress = String(progress)
  applyRailProgress(targets.history, entryGeometry, progress)
  applyGeometry(targets.composer, entryGeometry.start.composer, entryGeometry.end.composer, progress)
  if (frozen) {
    frozenEntryGeometry = null
    delete root.dataset.entryFrozen
  }
  return true
}

function setEntryProgress(value) {
  const root = rootRef.value
  const targets = getEntryTargets()
  if (!root || !targets.history || !targets.composer) return false
  if (!entryGeometry && !measureEntryGeometry()) return false
  const progress = Math.min(1, Math.max(0, Number(value) || 0))
  root.dataset.entryProgress = String(progress)
  applyRailProgress(targets.history, entryGeometry, progress)
  applyGeometry(targets.composer, entryGeometry.start.composer, entryGeometry.end.composer, progress)
  targets.composer.style.willChange = 'left, top, width, height'
  return true
}

function clearEntryGeometry() {
  const targets = getEntryTargets()
  entryGeometry = null
  const root = rootRef.value
  if (root) {
    delete root.dataset.entryProgress
    delete root.dataset.entryMeasure
  }
  if (frozenEntryGeometry) return
  const geometryTargets = [targets.history, targets.composer]
  geometryTargets.forEach(target => {
    if (!target) return
    target.style.left = ''
    target.style.top = ''
    target.style.width = ''
    target.style.height = ''
    target.style.right = ''
    target.style.bottom = ''
    target.style.marginInline = ''
  })
  if (targets.history) {
    targets.history.style.opacity = ''
    targets.history.style.visibility = ''
    targets.history.style.pointerEvents = ''
    targets.history.style.willChange = ''
  }
  if (targets.composer) targets.composer.style.willChange = ''
}

function closeSessionManagement() {
  sessionRailRef.value?.closeManagement?.()
}

function handleCreateSession() {
  if (rootRef.value?.dataset.experienceState === 'chat') {
    freezeEntryGeometry('reverse')
  }
  emit('create-session')
}

function alignEntryFront() {
  landingHeadRef.value?.lockInteraction?.()
  landingHeadRef.value?.resetPointer?.()
  return landingHeadRef.value?.getDiagnostics?.()
}

defineExpose({
  alignEntryFront,
  getEntryTargets,
  freezeEntryGeometry,
  prepareEntryGeometry,
  setEntryProgress,
  clearEntryGeometry,
  closeSessionManagement,
  preloadEntrySequence: options => landingHeadRef.value?.preloadSequence?.(options) || Promise.resolve(false),
  playEntrySequence: options => landingHeadRef.value?.playSequence?.(options) || Promise.resolve(false),
  stopEntrySequence: options => landingHeadRef.value?.stopSequence?.(options) || Promise.resolve(false),
})
</script>

<style scoped>
.chat-lab-layout {
  --lab-paper: #F1F2EE;
  --lab-paper-raised: #F8F8F4;
  --lab-ink: #171918;
  --lab-muted: #696D69;
  --lab-line: rgb(23 25 24 / 20%);
  --lab-line-strong: rgb(23 25 24 / 44%);
  --lab-orange: #F0642E;
  --lab-safe-x: 48px;
  --lab-safe-y: 32px;
  --lab-gutter: 24px;
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  padding: var(--lab-safe-y) var(--lab-safe-x);
  display: block;
  overflow: hidden;
  background: var(--lab-paper);
  color: var(--lab-ink);
  font-family: var(--font-chat, "IBM Plex Sans SC", sans-serif);
  container: chat-lab / inline-size;
  isolation: isolate;
}

.chat-lab-layout__grid {
  position: absolute;
  z-index: 0;
  inset: var(--lab-safe-y) var(--lab-safe-x);
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: var(--lab-gutter);
  pointer-events: none;
}

.chat-lab-layout__grid span {
  border-inline: 1px solid rgb(23 25 24 / 3.5%);
}

.chat-lab-layout__masthead {
  position: relative;
  z-index: 8;
  width: 100%;
  height: 36px;
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: start;
  gap: 24px;
  border-top: 1px solid var(--lab-ink);
  padding-top: 7px;
}

.chat-lab-layout__brand,
.chat-lab-layout__state {
  min-width: 0;
  display: flex;
  gap: 14px;
  font: 500 10px/14px var(--font-chat-data, "IBM Plex Mono", monospace);
  letter-spacing: .04em;
}

.chat-lab-layout__brand span,
.chat-lab-layout__state span {
  color: var(--lab-muted);
}

.chat-lab-layout__brand strong,
.chat-lab-layout__state strong {
  color: var(--lab-ink);
  font-weight: 600;
}

.chat-lab-layout__state strong {
  color: var(--lab-ink);
  text-decoration: underline 2px var(--lab-orange);
  text-underline-offset: 3px;
}

.chat-lab-layout__landing,
.chat-lab-layout__chat {
  position: absolute;
  inset: 0;
  z-index: 1;
  min-width: 0;
  min-height: 0;
}

.chat-lab-layout__landing {
  display: block;
}

.chat-lab-layout__landing-head {
  position: absolute;
  z-index: 1;
  inset: 0;
  left: 50%;
  width: 100vw;
  min-height: 100dvh;
  transform: translateX(-50%);
}

.chat-lab-layout__landing-copy {
  position: absolute;
  z-index: 3;
  top: clamp(112px, 17dvh, 156px);
  left: var(--lab-safe-x);
  width: min(360px, 28vw);
  padding-top: 9px;
  border-top: 1px solid var(--lab-line-strong);
  text-align: left;
}

.chat-lab-layout__landing-actions {
  position: absolute;
  z-index: 5;
  right: var(--lab-safe-x);
  bottom: 32px;
  left: var(--lab-safe-x);
  width: min(680px, calc(100% - (2 * var(--lab-safe-x))));
  margin-inline: auto;
  min-width: 0;
}

.chat-lab-layout__session-rail {
  position: absolute;
  z-index: 6;
  top: clamp(248px, 42dvh, 360px);
  bottom: auto;
  left: 24px;
  width: 250px;
  height: 132px;
  overflow: visible;
}

.chat-lab-layout__landing-copy > span,
.chat-lab-layout__conversation-heading > span,
.chat-lab-layout__composer-index {
  color: var(--lab-muted);
  font: 500 10px/14px var(--font-chat-data, "IBM Plex Mono", monospace);
  letter-spacing: .05em;
}

.chat-lab-layout__landing-copy h1,
.chat-lab-layout__conversation-heading h1 {
  color: var(--lab-ink);
  font-family: var(--font-display, "IBM Plex Sans SC", sans-serif);
  font-weight: 600;
  letter-spacing: -.035em;
}

.chat-lab-layout__landing-copy h1 {
  margin: 7px 0 10px;
  font-size: clamp(27px, 2.5vw, 40px);
  line-height: 1.04;
}

.chat-lab-layout__landing-copy p {
  max-width: 330px;
  margin: 0;
  color: var(--lab-muted);
  font-size: 13px;
  line-height: 21px;
}

.chat-lab-layout__chat {
  display: block;
}

.chat-lab-layout__left {
  position: absolute;
  z-index: 1;
  inset: 0 auto 0 0;
  width: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.chat-lab-layout__left::after {
  content: '';
  position: absolute;
  z-index: 3;
  top: var(--lab-safe-y);
  right: 0;
  bottom: var(--lab-safe-y);
  width: 1px;
  background: linear-gradient(
    180deg,
    transparent,
    var(--lab-line-strong) 12% 88%,
    transparent
  );
}

.chat-lab-layout__left::before {
  content: '';
  position: absolute;
  z-index: 2;
  inset: 0 auto 0 0;
  width: min(260px, 42%);
  background: linear-gradient(90deg, rgb(241 242 238 / 92%), rgb(241 242 238 / 0%));
  pointer-events: none;
}

.chat-lab-layout.is-chat > .chat-lab-layout__session-rail {
  top: 106px;
  bottom: 42px;
  height: auto;
}

.chat-lab-layout[data-entry-measure='landing'] > .chat-lab-layout__session-rail {
  top: clamp(248px, 42dvh, 360px);
  bottom: auto;
  left: 24px;
  width: 250px;
  height: 132px;
}

.chat-lab-layout[data-entry-measure='chat'] > .chat-lab-layout__session-rail {
  top: 106px;
  bottom: 42px;
  left: 24px;
  width: 250px;
  height: auto;
}

.chat-lab-layout__profile-head {
  position: absolute;
  z-index: 1;
  inset: 0;
  left: 50%;
  width: 100vw;
  min-height: 100dvh;
  transform: translateX(-50%);
}

.chat-lab-layout__main {
  position: absolute;
  z-index: 3;
  top: 92px;
  right: var(--lab-safe-x);
  bottom: 126px;
  left: max(48vw, 610px);
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: 82px minmax(0, 1fr);
  overflow: hidden;
}

.chat-lab-layout__conversation-heading {
  position: relative;
  display: grid;
  align-content: start;
  gap: 4px;
  border-bottom: 0;
  padding-bottom: 14px;
}

.chat-lab-layout__conversation-structure {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 1px;
  background: var(--lab-line-strong);
  transform-origin: left center;
}

.chat-lab-layout__conversation-heading h1 {
  font-size: clamp(24px, 2vw, 32px);
  line-height: 1.1;
}

.chat-lab-layout__transcript {
  min-height: 0;
  overflow: hidden;
  overscroll-behavior: contain;
}

.chat-lab-layout__composer {
  position: absolute;
  z-index: 7;
  min-width: 0;
  transition: none;
}

.chat-lab-layout.is-landing .chat-lab-layout__composer {
  right: var(--lab-safe-x);
  bottom: 25dvh;
  left: var(--lab-safe-x);
  width: min(680px, calc(100% - (2 * var(--lab-safe-x))));
  margin-inline: auto;
  --composer-glass: rgb(248 248 244 / 86%);
}

.chat-lab-layout.is-chat .chat-lab-layout__composer {
  right: var(--lab-safe-x);
  bottom: 28px;
  left: max(48vw, 610px);
}

.chat-lab-layout[data-entry-measure='landing'] > .chat-lab-layout__composer {
  top: auto;
  right: var(--lab-safe-x);
  bottom: 25dvh;
  left: var(--lab-safe-x);
  width: min(680px, calc(100% - (2 * var(--lab-safe-x))));
  margin-inline: auto;
}

.chat-lab-layout[data-entry-measure='chat'] > .chat-lab-layout__composer {
  top: auto;
  right: var(--lab-safe-x);
  bottom: 28px;
  left: max(48vw, 610px);
  width: auto;
  margin-inline: 0;
}

.chat-lab-layout.is-entering .chat-lab-layout__chat.is-hidden {
  visibility: visible;
  opacity: 1;
  pointer-events: none;
}

.chat-lab-layout.is-entering .chat-lab-layout__profile-head,
.chat-lab-layout.is-entering .chat-lab-layout__transcript {
  pointer-events: none;
}

.chat-lab-layout.is-entering .chat-lab-layout__conversation-heading h1,
.chat-lab-layout.is-entering .chat-lab-layout__conversation-heading > span:not(.chat-lab-layout__conversation-structure),
.chat-lab-layout.is-entering .chat-lab-layout__conversation-heading .consultation-status-rail,
.chat-lab-layout.is-entering .chat-lab-layout__transcript,
.chat-lab-layout.is-entering .chat-lab-layout__profile-head {
  opacity: 0;
}

.chat-lab-layout.is-entering .chat-lab-layout__conversation-structure {
  opacity: 0;
}

.chat-lab-layout__composer-index {
  position: absolute;
  right: 0;
  bottom: calc(100% + 6px);
}

.chat-lab-layout__landing-head :deep(.head-study),
.chat-lab-layout__profile-head :deep(.head-study) {
  height: 100%;
}

.chat-lab-layout__landing-head :deep(.head-study__plate) {
  inset: 0;
  background: transparent;
  clip-path: none !important;
}

.chat-lab-layout__landing-head :deep(.head-study__image),
.chat-lab-layout__landing-head :deep(.head-study__sequence-canvas),
.chat-lab-layout__landing-head :deep(.head-study__canvas) {
  object-fit: cover;
  object-position: center top;
}

.chat-lab-layout__landing-head :deep(.head-study__axis),
.chat-lab-layout__landing-head :deep(.head-study__index),
.chat-lab-layout__landing-head :deep(.head-study figcaption),
.chat-lab-layout__profile-head :deep(.head-study__axis),
.chat-lab-layout__profile-head :deep(.head-study__index),
.chat-lab-layout__profile-head :deep(.head-study figcaption) {
  display: none;
}

.chat-lab-layout__profile-head :deep(.head-study__plate) {
  inset: 0;
  background: transparent;
  clip-path: none;
}

.chat-lab-layout__profile-head :deep(.head-study__image),
.chat-lab-layout__profile-head :deep(.head-study__sequence-canvas),
.chat-lab-layout__profile-head :deep(.head-study__canvas) {
  object-fit: cover;
  object-position: center top;
}

.chat-lab-layout__landing-head :deep(.head-study__image),
.chat-lab-layout__landing-head :deep(.head-study__sequence-canvas),
.chat-lab-layout__profile-head :deep(.head-study__image),
.chat-lab-layout__profile-head :deep(.head-study__sequence-canvas) {
  opacity: 1;
  filter: none;
}

.is-hidden {
  visibility: hidden;
  opacity: 0;
  pointer-events: none;
}

@media (max-width: 1023px) {
  .chat-lab-layout {
    --lab-safe-x: 24px;
    --lab-safe-y: 24px;
    --lab-gutter: 16px;
  }
  .chat-lab-layout__landing-copy { width: min(236px, 24vw); }
  .chat-lab-layout__left { width: 100%; }
  .chat-lab-layout__main,
  .chat-lab-layout.is-chat .chat-lab-layout__composer {
    left: 43vw;
  }
  .chat-lab-layout__session-rail { left: 24px; width: 250px; }
}

@media (max-width: 767px) {
  .chat-lab-layout {
    --lab-safe-x: 16px;
    --lab-safe-y: max(16px, env(safe-area-inset-top));
  }
  .chat-lab-layout__brand span,
  .chat-lab-layout__state span { display: none; }
  .chat-lab-layout__landing-head,
  .chat-lab-layout__profile-head {
    top: 48px;
    bottom: 126px;
    width: 118vw;
  }
  .chat-lab-layout__landing-copy {
    top: 76px;
    width: min(220px, calc(100vw - 32px));
  }
  .chat-lab-layout__landing-copy p { display: none; }
  .chat-lab-layout__landing-actions {
    right: 16px;
    bottom: max(16px, env(safe-area-inset-bottom));
    left: 16px;
    width: auto;
  }
  .chat-lab-layout.is-landing .chat-lab-layout__composer {
    right: 16px;
    bottom: 21dvh;
    left: 16px;
    width: auto;
  }
  .chat-lab-layout__left {
    width: 100%;
  }
  .chat-lab-layout__session-rail {
    top: 70px;
    bottom: auto;
    left: 8px;
    width: 44px;
    height: 116px;
  }
  .chat-lab-layout.is-chat > .chat-lab-layout__session-rail {
    top: 70px;
    bottom: auto;
    height: 116px;
  }
  .chat-lab-layout__main {
    top: 72px;
    right: 16px;
    bottom: 112px;
    left: 28vw;
    grid-template-rows: 58px minmax(0, 1fr);
  }
  .chat-lab-layout.is-chat .chat-lab-layout__composer {
    right: 16px;
    bottom: max(16px, env(safe-area-inset-bottom));
    left: 28vw;
  }
  .chat-lab-layout.is-entering .chat-lab-layout__composer { right: auto; }
}

@media (prefers-reduced-motion: reduce) {
  .chat-lab-layout__landing,
  .chat-lab-layout__chat,
  .chat-lab-layout__composer { transition: none; }
}
</style>

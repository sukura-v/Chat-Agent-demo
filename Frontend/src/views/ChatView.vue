<template>
  <div
    class="chat-view rhine-consultation"
    :class="{
      'is-static-first-commit': isStaticFirstCommit,
      'is-static-first-commit-fading': isStaticFirstCommitFading,
    }"
    :data-ui-phase="uiPhase"
  >
    <ChatLabLayout
      ref="labLayoutRef"
      :state="experienceState"
      :entering="isMediaEntryActive"
      :title="sessionTitle"
      :sessions="displaySessions"
      :current-thread-id="displayThreadId"
      :pending-thread-id="pendingSessionId"
      :failed-thread-id="failedSessionId"
      :session-load-error="historyLoadError"
      :sessions-loading="sessionsLoading"
      :sessions-error="sessionsError"
      :session-rail-locked="sessionRailLocked"
      :session-rail-new-disabled="sessionRailNewDisabled"
      :session-rail-new-label="sessionRailNewLabel"
      @select-session="onSelectSessionRequested"
      @create-session="onNewSession"
      @retry-sessions="fetchSessions"
      @retry-session="retryHistorySession"
      @delete-session="deleteSession"
      @entry-progress="handleEntryProgress"
      @entry-error="handleEntryError"
    >
      <template #utility>
        <div class="lab-context-tools">
          <button
            type="button"
            class="context-command archive-command"
            aria-label="历史会话"
            :aria-expanded="context === 'history' ? 'true' : 'false'"
            @click="openWorkbench('history', $event.currentTarget)"
          >
            <el-icon class="context-icon" :size="16"><Reading /></el-icon>
            <span><small>会话存档</small><strong>历史会话</strong></span>
          </button>
          <button
            v-if="isDoctor"
            type="button"
            class="context-command patient-command"
            @click="openWorkbench('patient', $event.currentTarget)"
          >
            <el-icon class="context-icon" :size="16"><User /></el-icon>
            <span><small>当前患者</small><strong>{{ currentPatientName }}</strong></span>
          </button>
          <div v-else class="context-identity">
            <el-icon class="context-icon" :size="16"><User /></el-icon>
            <span><small>当前会诊对象</small><strong>{{ authUser.name || '本人' }}</strong></span>
          </div>
        </div>
      </template>

      <template #landing-actions>
        <div class="welcome-tools">
          <div class="quick-scenes">
            <button
              v-for="scene in quickScenes"
              :key="scene.id"
              type="button"
              :data-scene="scene.id"
              @click="prefillScene(scene.id)"
            >
              <el-icon :size="17"><component :is="scene.icon" /></el-icon>
              <strong>{{ scene.shortName }}</strong>
            </button>
          </div>
        </div>
      </template>

      <template #conversation-meta>
        <div class="consultation-status-rail" role="status" aria-live="polite">
          <span class="status-rail-code">CONSULT / LIVE</span>
          <span class="status-rail-copy">{{ statusRailText }}</span>
          <span class="status-rail-rule" aria-hidden="true" />
          <span class="status-rail-phase">{{ uiPhaseLabel }}</span>
        </div>
      </template>

      <template #transcript>
        <main
          class="conversation-stage"
          :class="{
            'is-welcome': isWelcome,
            'is-thread': !isWelcome,
            'is-fresh-welcome': isFreshWelcome,
            'is-restored-welcome': uiPhase === 'welcome-restored',
            'is-resetting': uiPhase === 'new-session-reset',
            'is-first-transition': isFirstCommitAnimating,
            'history-loading': historyLoading,
          }"
          :data-ui-phase="uiPhase"
        >
          <div v-if="historyLoading" class="history-load-status" role="status">
            <span class="history-progress" />
            <span>正在调取会诊记录</span>
          </div>

          <div v-if="historyLoadError && failedSessionId" class="history-load-error" role="alert">
            <strong>目标会话加载失败</strong>
            <span>{{ historyLoadError }}</span>
            <button type="button" @click="retryHistorySessionById(failedSessionId)">重新加载</button>
          </div>

          <div v-if="sseError" class="sse-error-status" role="alert">
            <strong>会诊请求未完成</strong>
            <span>{{ sseError }}</span>
            <button type="button" :disabled="chatStore.turnInFlight" @click="retryFailedMessage">重新发送</button>
          </div>

          <div
            ref="messagesArea"
            class="messages-area"
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            @scroll.passive="onScroll"
          >
            <TransitionGroup name="message" tag="div" class="message-list">
              <ChatMessage
                v-for="(message, index) in displayMessages"
                :key="message.id"
                :message="message"
                :is-latest="index === displayMessages.length - 1"
                :highlighted-feedback-id="activeFeedbackId"
                @retry="retryInterruptedMessage"
                @retry-turn="retryDurableTurn"
                @resume-turn="resumeDurableTurn"
                @cancel-turn="cancelDurableTurn"
                @cancel-task="cancelConsultationTask"
                @confirm-task="confirmConsultationTask"
                @clarify-task="clarifyConsultationTask"
                @retry-task="retryConsultationTask"
              />
            </TransitionGroup>

            <div v-if="!displayMessages.length" class="conversation-empty">
              <span>NO MESSAGE RECORD</span>
              <p>提交第一条描述后，会诊记录会按时间顺序显示在这里。</p>
            </div>

            <div v-if="chatStore.turnInFlight" class="thinking-status" role="status">
              <OcclusalTrace mode="thread" :active-agents="activeAgents" aria-hidden="true" />
              <strong>{{ chatStore.thinkingText || '智能体正在整理信息' }}</strong>
              <button
                v-if="chatStore.durableWorkflowEnabled"
                type="button"
                class="turn-cancel-command"
                @click="chatStore.abortActiveTurn?.()"
              >
                取消本轮
              </button>
            </div>
          </div>

          <button
            v-if="experienceState === 'chat' && !isNearBottom"
            type="button"
            class="new-message-command"
            @click="scrollToBottom({ force: true })"
          >
            <el-icon :size="16"><ArrowDown /></el-icon>
            查看最新回复
          </button>

          <div
            v-if="uiPhase === 'route-loading' || (uiPhase === 'new-session-reset' && !isMediaEntryActive)"
            class="phase-bridge"
            role="status"
            aria-live="polite"
          >
            <span class="phase-bridge-track" aria-hidden="true" />
            <span>{{ uiPhase === 'new-session-reset' ? '正在建立新会话' : '正在建立会诊空间' }}</span>
          </div>
        </main>
      </template>

      <template #composer>
        <div ref="composerDock" class="composer-dock">
          <ChatComposer
            ref="composerRef"
            v-model="inputText"
            :variant="experienceState === 'landing' ? 'welcome' : 'docked'"
            :disabled="chatStore.turnInFlight || chatStore.currentSessionHasUnfinishedTurn || chatStore.isThinking || transitionLocked"
            :busy="chatStore.turnInFlight || chatStore.currentSessionHasUnfinishedTurn"
            :placeholder="placeholderText"
            @submit="sendMessage"
            @toggle-actions="openWorkbench('protocols', $event?.currentTarget)"
          />
        </div>
      </template>
    </ChatLabLayout>

    <ContextWorkbench
      v-model:open="contextOpen"
      :kind="contextKind"
      :mode="workbenchMode"
      :title="workbenchTitle"
      :anchor-rect="contextAnchorRect"
      :placement="contextPlacement"
      @request-close="closeWorkbench"
    >
      <template v-if="contextKind === 'patient'">
        <div class="workbench-field">
          <label for="chat-patient">会诊患者</label>
          <el-select
            id="chat-patient"
            v-model="selectedPatientId"
            filterable
            placeholder="选择患者"
            style="width: 100%"
            @change="onPatientSelect"
          >
            <el-option v-for="patient in patientList" :key="patient.id" :label="patient.name" :value="patient.id" />
          </el-select>
          <p>切换患者会创建新的会话上下文。</p>
        </div>
      </template>

      <SessionHistoryPage
        v-else-if="contextKind === 'history'"
        :sessions="displaySessions"
        :current-thread-id="displayThreadId"
        :pending-thread-id="pendingSessionId"
        :failed-thread-id="failedSessionId"
        :load-error="historyLoadError"
        :loading="sessionsLoading"
        :error="sessionsError"
        @select="onSelectSessionRequested"
        @create="onNewSession"
        @delete="deleteSession"
        @retry="fetchSessions"
        @close="closeWorkbench"
      />

      <ChatCommandPalette
        v-else
        :protocols="[]"
        :suggestions="suggestHints.map(stripHint)"
        @prefill="prefillScene"
        @prefill-prompt="prefillPrompt"
        @clear="clearChat"
      />
    </ContextWorkbench>

  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Aim, ArrowDown, Reading, TrendCharts, User } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { gsap } from 'gsap'
import ChatCommandPalette from '@/components/chat/ChatCommandPalette.vue'
import ChatComposer from '@/components/chat/ChatComposer.vue'
import ChatLabLayout from '@/components/chat/ChatLabLayout.vue'
import ChatMessage from '@/components/chat/ChatMessage.vue'
import SessionHistoryPage from '@/components/chat/SessionHistoryPage.vue'
import { consultationTargetId } from '@/utils/consultationTarget'
import OcclusalTrace from '@/components/chat/OcclusalTrace.vue'
import ContextWorkbench from '@/components/shell/ContextWorkbench.vue'
import { useAutoScroll } from '@/composables/useAutoScroll'
import { useDebounce } from '@/composables/useDebounce'
import { useNanoSceneController } from '@/composables/useNanoSceneController'
import { useOverlayCoordinator } from '@/composables/useOverlayCoordinator'
import { ref as vueRef } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useAuthStore } from '@/stores/auth'
import { useConsultationContextStore } from '@/stores/consultationContext'
import { getAuthHeaders } from '@/utils/agentAPI'
import { analyticsAPI } from '@/utils/request'

const props = defineProps({
  previewState: {
    type: String,
    default: '',
    validator: value => ['', 'landing', 'chat'].includes(value),
  },
})

const STATIC_PREVIEW_THREAD_ID = 'preview-current'
const STATIC_PREVIEW_SESSIONS = Object.freeze([
  { thread_id: STATIC_PREVIEW_THREAD_ID, title: '本次动作评估', updated_at: '10:24' },
  { thread_id: 'preview-follow-up', title: '吞咽协调复盘', updated_at: '周二' },
  { thread_id: 'preview-baseline', title: '初始能力基线', updated_at: '07 / 18' },
])
const STATIC_PREVIEW_MESSAGES = Object.freeze([
  {
    id: 'preview-user',
    role: 'user',
    content: '孩子做唇肌闭合训练时，右侧容易先松开，想确认今天该怎样调整。',
    timestamp: '2026-07-23T10:18:00+08:00',
  },
  {
    id: 'preview-agent-a',
    role: 'agent',
    agent: 'A',
    agentName: '临床分析 Agent A',
    content: '从近期记录看，右侧闭合保持时间短于左侧。先降低单次保持时长，再观察两侧同步性。',
    timestamp: '2026-07-23T10:19:00+08:00',
  },
  {
    id: 'preview-agent-b',
    role: 'agent',
    agent: 'B',
    agentName: '训练协作 Agent B',
    content: '今天建议进行 3 组短时闭合，每组 5 次；每次以两侧同时放松作为结束信号。',
    timestamp: '2026-07-23T10:20:00+08:00',
  },
])
const STATIC_FIRST_COMMIT_DURATION_MS = 180

const router = useRouter()
const currentRouteRef = computed(() => {
  const cr = router?.currentRoute?.value || router?.currentRoute || {}
  return {
    path: cr.path || '/chat',
    meta: cr.meta || {},
    ...cr,
    query: cr.query || {},
  }
})
const currentQuery = computed(() => currentRouteRef.value.query || {})
const route = new Proxy({}, {
  get(_, prop) {
    if (prop === 'query') return currentQuery.value
    return currentRouteRef.value[prop]
  },
})
const chatStore = useChatStore()
// Demo 没有工作台/会诊跳转路由；过渡锁常量保留原契约形状。
const consultationShellTransitionLocked = vueRef(false)
const authStore = useAuthStore()
const consultationContext = useConsultationContextStore()
const pageSessionKey = authStore.sessionKey
let disposed = false
const ownsPage = () => !disposed && authStore.sessionKey === pageSessionKey
const { delay } = useDebounce(800)
const nanoScene = useNanoSceneController()
const { context, openContext: coordinateContext, closeContext: coordinateClose } = useOverlayCoordinator()
const messagesArea = ref(null)
const composerDock = ref(null)
const composerRef = ref(null)
const labLayoutRef = ref(null)
const { scrollToBottom, onScroll, isNearBottom } = useAutoScroll(messagesArea)
const inputText = ref('')
const activeScene = ref(null)
const sessionList = ref([])
const sessionsLoading = ref(false)
const sessionsError = ref('')
const historyLoading = computed(() => chatStore.isLoadingHistory)
const pendingSessionId = ref('')
const failedSessionId = ref('')
const historyLoadError = ref('')
const lastSubmittedMessage = ref('')
const sseError = ref('')
const patientList = ref([])
const selectedPatientId = computed({
  get: () => consultationContext.patientId,
  set: value => { if (ownsPage()) consultationContext.selectPatient(value) },
})
const activeFeedbackId = ref(currentQuery.value.feedback_id || null)
const viewportWidth = ref(typeof window === 'undefined' ? 1440 : window.innerWidth)
const contextAnchorRect = ref(null)
const contextPlacement = ref('bottom-end')
const isFirstCommitAnimating = ref(false)
const isStaticFirstCommit = ref(false)
const isStaticFirstCommitFading = ref(false)
const hasPlayedFirstTransition = ref(false)
const isMediaEntryActive = ref(false)
const isTransitionLocked = ref(false)
const hideResetSessionSelection = ref(false)
const uiPhase = ref(chatStore.messages.length ? 'thread' : 'route-loading')
let entryTimeline = null
let entryGeneration = 0
let resetInProgress = false
let phaseGeneration = 0
let routePhaseTimer = null
let sessionsRequestId = 0
let composerResizeObserver = null
let pendingAgenticSessionReset = false

const authUser = computed(() => authStore.user || {})
const isDoctor = computed(() => authStore.userRole === 'doctor')
const isStaticPreview = computed(() => props.previewState === 'landing' || props.previewState === 'chat')
const currentPatientName = computed(() => (
  patientList.value.find(patient => patient.id === selectedPatientId.value)?.name || '选择患者'
))
const sessionTitle = computed(() => {
  const source = isStaticPreview.value ? STATIC_PREVIEW_SESSIONS : sessionList.value
  const threadId = isStaticPreview.value ? STATIC_PREVIEW_THREAD_ID : chatStore.currentThreadId
  const current = source.find(session => session.thread_id === threadId)
  return current?.title || (chatStore.currentThreadId ? '当前会诊' : '新会诊')
})
const welcomePhases = new Set(['route-loading', 'welcome-fresh', 'welcome-restored', 'new-session-reset'])
const isWelcome = computed(() => (
  welcomePhases.has(uiPhase.value)
  || (uiPhase.value === 'first-commit' && chatStore.messages.length === 0)
))
const isFreshWelcome = computed(() => (
  uiPhase.value === 'welcome-fresh'
  || (uiPhase.value === 'first-commit' && chatStore.messages.length === 0)
))
const experienceState = computed(() => (
  isMediaEntryActive.value
    ? 'landing'
    : isStaticPreview.value && !hasPlayedFirstTransition.value
      ? props.previewState
        : isWelcome.value
        ? 'landing'
        : 'chat'
))
const transitionLocked = computed(() => (
  consultationShellTransitionLocked.value
  ||
  isTransitionLocked.value
  || isMediaEntryActive.value
  || isFirstCommitAnimating.value
))
const sessionRailLocked = computed(() => (
  transitionLocked.value
))
const sessionRailNewDisabled = computed(() => (
  experienceState.value !== 'chat'
  || sessionRailLocked.value
))
const sessionRailNewLabel = computed(() => (
  experienceState.value !== 'chat' ? '当前已是新会话' : '新建会话'
))
const displaySessions = computed(() => {
  if (isStaticPreview.value) return STATIC_PREVIEW_SESSIONS
  chatStore.durableStateRevision
  return sessionList.value.map(session => {
    const summary = chatStore.getSessionDurableSummary?.(session.thread_id)
    return summary
      ? { ...session, turnProgressLabel: summary.label, turnProgressTone: summary.tone }
      : session
  })
})
const displayThreadId = computed(() => (
  isStaticPreview.value
    ? STATIC_PREVIEW_THREAD_ID
    : hideResetSessionSelection.value
      ? ''
      : chatStore.currentThreadId
))
const displayMessages = computed(() => (
  props.previewState === 'chat' ? STATIC_PREVIEW_MESSAGES : chatStore.messages
))
const activeAgents = computed(() => {
  if (!chatStore.turnInFlight && !chatStore.isThinking) return []
  const text = String(chatStore.thinkingText || '')
  if (/检索|诊断|Agent A/i.test(text)) return ['A']
  if (/回复|表达|Agent B/i.test(text)) return ['B']
  return ['C']
})
const uiPhaseLabel = computed(() => ({
  'route-loading': 'INITIALIZING',
  'welcome-fresh': 'READY',
  'welcome-restored': 'RESTORED',
  'new-session-reset': 'RESETTING',
  'first-commit': 'COMMITTING',
  'history-loading': 'LOADING',
  thread: 'ACTIVE',
}[uiPhase.value] || 'READY'))
const statusRailText = computed(() => {
  const progress = chatStore.currentTurnProgress
  if (chatStore.currentSessionHasUnfinishedTurn && progress?.total) {
    return `会诊任务处理中 · ${progress.completed}/${progress.total}`
  }
  if (activeScene.value) {
    return `正在处理 · ${quickScenes.value.find(item => item.id === activeScene.value)?.name || '会诊任务'}`
  }
  if (chatStore.turnInFlight || chatStore.isThinking) return chatStore.thinkingText || '智能体正在整理信息'
  return '三智能体临床会诊链路待命'
})
const contextOpen = computed({
  get: () => Boolean(context.value),
  set: value => { if (!value) closeWorkbench() },
})
const contextKind = computed(() => context.value || 'protocols')
const workbenchMode = computed(() => {
  if (viewportWidth.value >= 1180) return 'popover'
  if (viewportWidth.value >= 768) return 'drawer'
  return 'sheet'
})
const workbenchTitle = computed(() => ({
  patient: '患者上下文',
  protocols: '快捷任务与训练',
}[contextKind.value]))

const quickScenes = computed(() => {
  const patientName = currentPatientName.value === '选择患者' ? '该患者' : currentPatientName.value
  return [
    { id: 'diagnosis', icon: Aim, name: '视觉驱动诊断', shortName: '辅助诊断', desc: '训练视频分析与康复建议' },
    { id: 'progress', icon: TrendCharts, name: '历史进度', shortName: '训练进展', desc: isDoctor.value ? `查看 ${patientName} 的客观走势` : '查看近期训练变化' },
    { id: 'knowledge', icon: Reading, name: '康复知识', shortName: '康复知识', desc: isDoctor.value ? '检索动作机理和临床依据' : '查询训练动作要领' },
  ]
})

const suggestHints = computed(() => {
  const patientName = currentPatientName.value === '选择患者' ? '该患者' : currentPatientName.value
  return isDoctor.value
    ? [`[I] 汇总 ${patientName} 最近四周走势`, `[+] 调取 ${patientName} 薄弱动作临床参考`, `[O] 查看 ${patientName} 今日计划`]
    : ['[+] 分析我的训练视频', '[I] 我最近四周的进度？', '[?] 舌肌训练怎么做？', '[O] 今天的计划是什么？']
})

const placeholderText = computed(() => '描述患者情况或训练问题')

const promptByScene = computed(() => ({
  diagnosis: '请帮我分析最近的训练视频，并给出康复建议。',
  progress: isDoctor.value
    ? `请汇总 ${currentPatientName.value} 最近四周的训练走势。`
    : '请总结我最近四周的训练进度。',
  knowledge: isDoctor.value
    ? `请检索 ${currentPatientName.value} 薄弱动作的临床依据与训练要点。`
    : '请介绍舌肌与吞咽协调训练的动作要领。',
}))

function stripHint(hint) {
  return hint.replace(/^\[[^\]]+\]\s*/, '')
}

function handleResize() {
  viewportWidth.value = window.innerWidth
  if (context.value && contextAnchorRect.value) contextAnchorRect.value = null
  nextTick(() => {
    reportComposerRect()
    nanoScene.refreshLayout()
  })
}

function getComposerElement() {
  const exposedElement = composerRef.value?.element
  return exposedElement?.value
    || exposedElement
    || composerDock.value?.querySelector?.('.composer')
    || composerDock.value
}

function reportComposerRect() {
  const element = getComposerElement()
  const rect = element?.getBoundingClientRect?.()
  if (!rect || !(rect.width > 0 && rect.height > 0)) {
    nanoScene.setExclusionRect(null)
    return
  }
  nanoScene.setExclusionRect({
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  })
}

function syncNanoSceneState() {
  if (experienceState.value === 'chat') nanoScene.collapse()
  else nanoScene.settle()
  nextTick(reportComposerRect)
}

function openWorkbench(kind, trigger) {
  const rect = trigger?.getBoundingClientRect?.()
  contextAnchorRect.value = rect ? {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  } : null
  contextPlacement.value = kind === 'protocols' ? 'top-start' : 'bottom-end'
  coordinateContext(kind, trigger)
}

function closeWorkbench(options) {
  contextAnchorRect.value = null
  coordinateClose(options)
}

function prefillPrompt(prompt) {
  inputText.value = prompt
  closeWorkbench({ restore: false })
  nextTick(() => composerRef.value?.focus())
}

function prefillScene(sceneId) {
  const prompt = promptByScene.value[sceneId]
  if (prompt) prefillPrompt(prompt)
}

function withSequenceTimeout(sequencePromise, timeoutMs = 9000) {
  // Slow-network guard: a stuck WebP entry sequence must never lock the UI.
  // Resolving false routes the caller into the existing static fallback.
  return Promise.race([
    Promise.resolve(sequencePromise),
    new Promise(resolve => setTimeout(() => resolve(false), timeoutMs)),
  ])
}

function shouldReduceMotion() {
  return typeof window === 'undefined'
    || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    || typeof Element === 'undefined'
    || typeof Element.prototype.animate !== 'function'
}

function shouldUseStaticFirstCommit() {
  if (typeof window === 'undefined') return true
  return typeof window.requestAnimationFrame !== 'function'
    || typeof window.performance?.now !== 'function'
    || typeof window.fetch !== 'function'
    || typeof window.createImageBitmap !== 'function'
}

function wait(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

function waitWithAnimationFrame(durationMs) {
  return new Promise(resolve => {
    const startedAt = performance.now()
    const tick = now => {
      if (now - startedAt >= durationMs) {
        resolve()
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

function clearEntryTimeline() {
  const targets = labLayoutRef.value?.getEntryTargets?.() || {}
  entryTimeline?.kill()
  entryTimeline = null
  const resetTargets = [
    targets.history,
    ...(Array.isArray(targets.landingOnly) ? targets.landingOnly : []),
    ...(Array.isArray(targets.chatOnly) ? targets.chatOnly : []),
    ...(Array.isArray(targets.title) ? targets.title : [targets.title]),
    targets.structure,
    targets.messages,
    targets.composer,
  ].filter(Boolean)
  gsap.set(
    resetTargets,
    { clearProps: 'opacity,visibility,transform' },
  )
  labLayoutRef.value?.clearEntryGeometry?.()
}

function createEntryTimeline() {
  const targets = labLayoutRef.value?.getEntryTargets?.() || {}
  const landingTargets = Array.isArray(targets.landingOnly) ? targets.landingOnly : []
  const chatTargets = [
    ...(Array.isArray(targets.title) ? targets.title : [targets.title]),
    targets.structure,
    targets.messages,
  ].filter(Boolean)
  if (!landingTargets.length || !chatTargets.length || !targets.history || !targets.composer) {
    throw new Error('Chat entry transition targets are unavailable')
  }

  const durationAnchor = { progress: 0 }
  const timeline = gsap.timeline({ paused: true })
  timeline
    // Keep the master duration at one normalized sequence unit so these
    // percentage windows remain exact when the same timeline runs in reverse.
    .to(durationAnchor, { progress: 1, duration: 1, ease: 'none' }, 0)
    .fromTo(
      landingTargets,
      { autoAlpha: 1, x: 0 },
      { autoAlpha: 0, x: -24, duration: .17, ease: 'power1.in', stagger: .015 },
      .05,
    )
    .fromTo(
      chatTargets,
      { autoAlpha: 0, x: 24 },
      { autoAlpha: 1, x: 0, duration: .2, ease: 'power1.out', stagger: .015 },
      .72,
    )
  return timeline
}

function handleEntryProgress(event) {
  if (!entryTimeline) return
  const normalized = Number(event?.normalizedFrameIndex ?? event?.progress)
  if (!Number.isFinite(normalized)) return
  const progress = Math.min(1, Math.max(0, normalized))
  labLayoutRef.value?.setEntryProgress?.(progress)
  entryTimeline.progress(progress, false)
  if (
    uiPhase.value === 'new-session-reset'
    && isMediaEntryActive.value
    && progress <= 0.45
  ) {
    // The rail is fully hidden here and has switched to its Landing geometry.
    // Remove only the visual selection; the old conversation stays intact
    // until the reverse sequence reaches frame 001.
    hideResetSessionSelection.value = true
  }
}

function handleEntryError() {
  // The sequence promise owns the static fallback. Do not pause the UI or the
  // already-running SSE request when a frame pipeline fails.
}

function finishEntryAsStaticChat() {
  labLayoutRef.value?.setEntryProgress?.(1)
  entryTimeline?.progress(1, false)
  isMediaEntryActive.value = false
  isTransitionLocked.value = false
  isStaticFirstCommit.value = false
  isStaticFirstCommitFading.value = false
  isFirstCommitAnimating.value = false
  uiPhase.value = 'thread'
  clearEntryTimeline()
}

async function commitMediaFirstCommit(message) {
  const commitGeneration = phaseGeneration
  entryGeneration += 1
  const currentEntryGeneration = entryGeneration
  uiPhase.value = 'first-commit'
  isFirstCommitAnimating.value = true
  isTransitionLocked.value = true
  nanoScene.collapse()
  labLayoutRef.value?.closeSessionManagement?.()
  labLayoutRef.value?.alignEntryFront?.()
  isMediaEntryActive.value = true
  await nextTick()
  labLayoutRef.value?.prepareEntryGeometry?.('forward')
  void labLayoutRef.value?.preloadEntrySequence?.({ direction: 'forward' })

  try {
    await waitWithAnimationFrame(150)
    if (commitGeneration !== phaseGeneration || currentEntryGeneration !== entryGeneration) return
    chatStore.addMessage({ role: 'user', content: message, type: 'text' })
    await nextTick()
    if (commitGeneration !== phaseGeneration || currentEntryGeneration !== entryGeneration) return

    entryTimeline = createEntryTimeline()
    labLayoutRef.value?.setEntryProgress?.(0)
    const succeeded = await withSequenceTimeout(
      labLayoutRef.value?.playEntrySequence?.({ direction: 'forward' }),
    )
    if (!succeeded) throw new Error('Chat entry WebP sequence failed')
    if (commitGeneration !== phaseGeneration || currentEntryGeneration !== entryGeneration) return
    entryTimeline.progress(1, false)
    isMediaEntryActive.value = false
    await nextTick()
    isFirstCommitAnimating.value = false
    isTransitionLocked.value = false
    uiPhase.value = 'thread'
    clearEntryTimeline()
  } catch (error) {
    if (commitGeneration !== phaseGeneration || currentEntryGeneration !== entryGeneration) return
    console.warn('[ChatView] media entry falling back to static Chat', error)
    labLayoutRef.value?.stopEntrySequence?.({ restoreEndpoint: false })
    finishEntryAsStaticChat()
  }
}

async function commitUserMessage(message, animateFirstCommit) {
  const commitGeneration = phaseGeneration
  if (!animateFirstCommit) {
    chatStore.addMessage({ role: 'user', content: message, type: 'text' })
    uiPhase.value = 'thread'
    return
  }

  if (isStaticFirstCommit.value) {
    uiPhase.value = 'first-commit'
    isFirstCommitAnimating.value = true
    isTransitionLocked.value = true
    isStaticFirstCommitFading.value = false
    nanoScene.collapse()
    chatStore.addMessage({ role: 'user', content: message, type: 'text' })
    await nextTick()
    if (commitGeneration !== phaseGeneration) return
    isStaticFirstCommitFading.value = true
    await nextTick()
    if (commitGeneration !== phaseGeneration) return
    await wait(100) // 100ms fade
    await wait(STATIC_FIRST_COMMIT_DURATION_MS) // duration: 220
    if (commitGeneration !== phaseGeneration) return
    isStaticFirstCommitFading.value = false
    isStaticFirstCommit.value = false
    isFirstCommitAnimating.value = false
    isTransitionLocked.value = false
    uiPhase.value = 'thread'
    return
  }
  await commitMediaFirstCommit(message)
}

async function sendMessage() {
  const message = inputText.value.trim()
  if (
    !message
    || transitionLocked.value
    || chatStore.turnInFlight
    || chatStore.currentSessionHasUnfinishedTurn
    || chatStore.isThinking
  ) return
  // contract: const animateFirstCommit = uiPhase.value === 'welcome-fresh' && !hasPlayedFirstTransition.value
  const animateFirstCommit = (uiPhase.value === 'welcome-fresh' || experienceState.value === 'landing') && !hasPlayedFirstTransition.value
  if (animateFirstCommit) hasPlayedFirstTransition.value = true
  isStaticFirstCommit.value = animateFirstCommit && shouldUseStaticFirstCommit()
  isMediaEntryActive.value = animateFirstCommit && !isStaticFirstCommit.value
  isStaticFirstCommitFading.value = false
  lastSubmittedMessage.value = message
  sseError.value = ''
  inputText.value = ''
  closeWorkbench({ restore: false })

  let scenario = 'knowledge'
  if (/进度|对比|提升|成长|进步|走势/.test(message)) scenario = 'progress'
  else if (/视频|分析|诊断/.test(message)) scenario = 'diagnosis'
  activeScene.value = scenario
  delay(() => fetchSessions())

  const commitPromise = commitUserMessage(message, animateFirstCommit)
  let responsePromise
  if (chatStore.useRealAI) {
    responsePromise = chatStore.sendToBackend(message).catch((error) => {
      console.error('[ChatView] send failed', error)
      sseError.value = '网络或会诊服务未响应，已保留本次描述。'
      ElMessage.error('后端通信失败，请检查服务是否启动')
      return false
    })
  } else {
    responsePromise = chatStore.simulateAgentResponse(scenario)
  }
  await commitPromise
  await scrollToBottom({ force: true })
  await responsePromise
  activeScene.value = null
}

async function retryFailedMessage() {
  if (
    !lastSubmittedMessage.value
    || transitionLocked.value
    || chatStore.turnInFlight
    || chatStore.currentSessionHasUnfinishedTurn
  ) return
  sseError.value = ''
  activeScene.value = null
  const sent = await chatStore.sendToBackend(lastSubmittedMessage.value)
  if (!sent) sseError.value = '重新发送仍未完成，请稍后再试。'
}

async function loadPatients() {
  if (!isDoctor.value) return
  try {
    const response = await analyticsAPI.getPatients()
    if (!ownsPage()) return
    patientList.value = response.data || response || []
    if (!patientList.value.length) return
    const saved = consultationContext.patientId
    selectedPatientId.value = patientList.value.some(patient => patient.id === saved)
      ? saved
      : patientList.value[0].id
  } catch (error) {
    if (!ownsPage()) return
    console.error('[ChatView] patient load failed', error)
    ElMessage.error('患者列表加载失败')
  }
}

async function onPatientSelect(value) {
  if (!ownsPage()) return
  consultationContext.selectPatient(value)
  ElMessage.success(`已切换至 ${currentPatientName.value}`)
}

async function retryInterruptedMessage(message) {
  const prompt = message?.retryPrompt
  if (
    !prompt
    || message.retryRequested
    || transitionLocked.value
    || chatStore.turnInFlight
    || chatStore.isThinking
  ) return false

  message.retryRequested = true
  try {
    const sent = await chatStore.sendToBackend(prompt)
    await scrollToBottom({ force: true })
    return Boolean(sent)
  } finally {
    message.retryRequested = false
  }
}

async function retryDurableTurn(message) {
  if (message?.retryRequested || chatStore.turnInFlight) return false
  message.retryRequested = true
  try {
    return Boolean(await chatStore.retryActiveTurn?.(message.turnId))
  } finally {
    message.retryRequested = false
  }
}

async function resumeDurableTurn(message) {
  if (message?.retryRequested || chatStore.turnInFlight) return false
  message.retryRequested = true
  try {
    return Boolean(await chatStore.resumeActiveTurn?.())
  } finally {
    message.retryRequested = false
  }
}

function cancelDurableTurn(message) {
  if (!message?.turnId || message.streamState === 'cancel_requested') return false
  return Boolean(chatStore.abortActiveTurn?.(message.turnId))
}

async function cancelConsultationTask({ message, task } = {}) {
  if (!message?.turnId || !task?.task_id || message.taskActionPending?.[task.task_id]) return false
  message.taskActionPending = { ...(message.taskActionPending || {}), [task.task_id]: true }
  try {
    return Boolean(await chatStore.cancelConsultationTask?.(message.turnId, task.task_id))
  } finally {
    message.taskActionPending = { ...(message.taskActionPending || {}), [task.task_id]: false }
  }
}

async function confirmConsultationTask({ message, task } = {}) {
  if (
    !message?.turnId
    || task?.status !== 'WAITING_CONFIRMATION'
    || !task.task_id
    || message.taskActionPending?.[task.task_id]
  ) return false
  message.taskActionPending = { ...(message.taskActionPending || {}), [task.task_id]: true }
  try {
    const confirmed = await chatStore.confirmConsultationTask?.(message.turnId, task.task_id)
    if (confirmed) await scrollToBottom({ force: true })
    return Boolean(confirmed)
  } finally {
    message.taskActionPending = { ...(message.taskActionPending || {}), [task.task_id]: false }
  }
}

async function retryConsultationTask({ message, task } = {}) {
  if (!message?.turnId || !task?.task_id || message.taskActionPending?.[task.task_id]) return false
  message.taskActionPending = { ...(message.taskActionPending || {}), [task.task_id]: true }
  try {
    const resumed = await chatStore.retryConsultationTask?.(message.turnId, task.task_id)
    if (resumed) await scrollToBottom({ force: true })
    return Boolean(resumed)
  } finally {
    message.taskActionPending = { ...(message.taskActionPending || {}), [task.task_id]: false }
  }
}

async function clarifyConsultationTask({ message, task } = {}) {
  if (
    !message?.turnId
    || task?.status !== 'NEEDS_INPUT'
    || !task.task_id
    || message.taskActionPending?.[task.task_id]
  ) return false

  let text = ''
  try {
    const result = await ElMessageBox.prompt(
      '请补充完成此项所需的信息。提交后会从这一项继续处理。',
      task.title ? `补充：${task.title}` : '补充任务信息',
      {
        confirmButtonText: '提交补充',
        cancelButtonText: '取消',
        inputPlaceholder: '请输入补充信息',
        inputPattern: /\S+/,
        inputErrorMessage: '请输入补充信息',
        closeOnClickModal: false,
      },
    )
    text = String(result?.value || '').trim()
  } catch (_) {
    return false
  }
  if (!text) return false
  if (!ownsPage()) return false

  message.taskActionPending = { ...(message.taskActionPending || {}), [task.task_id]: true }
  try {
    const resumed = await chatStore.retryConsultationTask?.(message.turnId, task.task_id, text)
    if (resumed) await scrollToBottom({ force: true })
    return Boolean(resumed)
  } finally {
    message.taskActionPending = { ...(message.taskActionPending || {}), [task.task_id]: false }
  }
}

async function clearChat() {
  try {
    await ElMessageBox.confirm(
      '仅清空当前可见消息，不会删除历史会话。',
      '清空当前消息',
      { confirmButtonText: '清空', cancelButtonText: '取消', type: 'warning' },
    )
    if (!ownsPage()) return
    chatStore.clearMessages()
    hasPlayedFirstTransition.value = true
    uiPhase.value = 'welcome-restored'
    closeWorkbench()
    ElMessage.success('当前消息已清空')
  } catch (_) { /* cancelled */ }
}

async function fetchSessions() {
  if (isStaticPreview.value) return
  if (!ownsPage()) return
  const patientId = selectedPatientId.value
  const doctorId = authStore.doctorId
  const requestId = ++sessionsRequestId
  sessionsError.value = ''
  if (!patientId || !doctorId) {
    sessionList.value = []
    sessionsLoading.value = false
    return
  }
  sessionsLoading.value = true
  try {
    const response = await fetch(
      `/api/chat/sessions?patient_id=${patientId}&doctor_id=${doctorId}`,
      { headers: getAuthHeaders() },
    )
    if (response.ok === false) throw new Error(`HTTP ${response.status}`)
    const payload = await response.json()
    if (!ownsPage() || requestId !== sessionsRequestId) return
    if (payload.code !== 200) throw new Error(payload.message || '会话列表响应异常')
    sessionList.value = payload.data || []
  } catch (error) {
    if (!ownsPage() || requestId !== sessionsRequestId) return
    console.error('[ChatView] sessions load failed', error)
    sessionsError.value = '无法读取会话列表，请检查网络后重试。'
  } finally {
    if (requestId === sessionsRequestId) sessionsLoading.value = false
  }
}

function resetLocalConversationState({ stayInChat = false, resetStore = true } = {}) {
  inputText.value = ''
  activeScene.value = null
  pendingSessionId.value = ''
  failedSessionId.value = ''
  historyLoadError.value = ''
  sseError.value = ''
  if (stayInChat) hasPlayedFirstTransition.value = true
  if (resetStore) chatStore.createNewSession()
}

async function transitionToNewSession({ resetStore = true } = {}) {
  if (isTransitionLocked.value) return false
  const wasChat = experienceState.value === 'chat'
  const localGeneration = ++phaseGeneration
  resetInProgress = true
  isTransitionLocked.value = true
  closeWorkbench({ restore: false })
  labLayoutRef.value?.closeSessionManagement?.()
  uiPhase.value = wasChat ? 'thread' : 'new-session-reset'
  isFirstCommitAnimating.value = false
  isStaticFirstCommit.value = false
  isStaticFirstCommitFading.value = false
  isMediaEntryActive.value = false
  hideResetSessionSelection.value = false
  entryGeneration += 1
  clearEntryTimeline()

  if (localGeneration !== phaseGeneration) return
  resetLocalConversationState({ stayInChat: wasChat, resetStore })
  hideResetSessionSelection.value = false
  await nextTick()
  if (localGeneration !== phaseGeneration) return
  uiPhase.value = wasChat ? 'thread' : 'welcome-fresh'
  isFirstCommitAnimating.value = false
  isTransitionLocked.value = false
  resetInProgress = false
  await nextTick()
  composerRef.value?.focus?.()
  return true
}

async function onNewSession() {
  const hadActiveTurn = chatStore.turnInFlight || chatStore.currentSessionHasUnfinishedTurn
  const created = await transitionToNewSession()
  if (!created) return
  void fetchSessions()
  ElMessage.success(hadActiveTurn ? '已创建新会话，原会诊继续在后台处理' : '已创建新会话')
}

async function waitForConsultationTarget(targetId) {
  for (let attempt = 0; attempt < 12; attempt++) {
    if (!ownsPage()) return null
    await nextTick()
    const target = document.getElementById(targetId)
    if (target) return target
    await new Promise(resolve => window.setTimeout(resolve, 50))
  }
  return null
}

async function revealConsultationTarget() {
  if (!ownsPage()) return
  const threadId = String(route.query.consultationThread || '')
  const messageAnchor = String(route.query.consultationMessage || '')
  const artifactAnchor = String(route.query.consultationArtifact || '')
  if (!threadId) return

  if (chatStore.currentThreadId !== threadId) {
    uiPhase.value = 'history-loading'
    const loaded = await chatStore.loadHistorySession(threadId)
    if (!ownsPage()) return
    if (!loaded) {
      ElMessage.warning('未能加载该会诊内容')
      return
    }
    hasPlayedFirstTransition.value = true
    uiPhase.value = 'thread'
    void chatStore.resumeSessionTurn?.(threadId, { historyLoaded: true })
  }

  if (!messageAnchor) {
    await scrollToBottom({ force: true })
    return
  }

  const exactId = consultationTargetId(messageAnchor, artifactAnchor || 'message')
  const fallbackId = consultationTargetId(messageAnchor, 'message')
  let target = await waitForConsultationTarget(exactId)
  if (!target && exactId !== fallbackId) target = await waitForConsultationTarget(fallbackId)
  if (!ownsPage()) return
  if (!target) {
    ElMessage.warning('该内容暂时无法定位，请在当前会话中查看')
    return
  }
  target.scrollIntoView({ behavior: shouldReduceMotion() ? 'auto' : 'smooth', block: 'center' })
  target.focus?.({ preventScroll: true })
  target.classList.remove('is-navigation-target')
  void target.offsetWidth
  target.classList.add('is-navigation-target')
  window.setTimeout(() => target.classList.remove('is-navigation-target'), 1500)
  const query = { ...currentQuery.value }
  delete query.consultationThread
  delete query.consultationMessage
  delete query.consultationArtifact
  delete query.consultationType
  await router.replace({ path: currentRouteRef.value.path || '/chat', query })
}

function onSelectSessionRequested(session) {
  return onSelectSession(session)
}

async function onSelectSession(session) {
  const threadId = session.thread_id
  if (!threadId || (chatStore.currentThreadId === threadId && !historyLoading.value)) return
  chatStore.disconnectActiveTurn?.()
  const fromLanding = experienceState.value === 'landing' && !hasPlayedFirstTransition.value
  pendingSessionId.value = threadId
  failedSessionId.value = ''
  historyLoadError.value = ''
  uiPhase.value = 'history-loading'
  const historyPromise = chatStore.loadHistorySession(threadId)
  let transitionPromise = Promise.resolve(true)
  if (fromLanding) {
    const localGeneration = ++phaseGeneration
    hasPlayedFirstTransition.value = true
    isTransitionLocked.value = true
    isFirstCommitAnimating.value = true
    isMediaEntryActive.value = true
    labLayoutRef.value?.closeSessionManagement?.()
    labLayoutRef.value?.alignEntryFront?.()
    await nextTick()
    labLayoutRef.value?.prepareEntryGeometry?.('forward')
    entryTimeline = createEntryTimeline()
    entryTimeline.progress(0, false)
    labLayoutRef.value?.setEntryProgress?.(0)
    transitionPromise = (async () => {
      const succeeded = await withSequenceTimeout(
        labLayoutRef.value?.playEntrySequence?.({ direction: 'forward' }),
      )
      if (localGeneration !== phaseGeneration) return false
      if (!succeeded) {
        labLayoutRef.value?.stopEntrySequence?.({ restoreEndpoint: false })
        finishEntryAsStaticChat()
        return false
      }
      labLayoutRef.value?.setEntryProgress?.(1)
      entryTimeline?.progress(1, false)
      isMediaEntryActive.value = false
      isFirstCommitAnimating.value = false
      isTransitionLocked.value = false
      clearEntryTimeline()
      return true
    })()
  }

  const [transitionSucceeded, succeeded] = await Promise.all([
    transitionPromise,
    historyPromise,
  ])
  if (!ownsPage()) return
  if (pendingSessionId.value !== threadId) return
  pendingSessionId.value = ''
  if (succeeded) {
    failedSessionId.value = ''
    historyLoadError.value = ''
    uiPhase.value = fromLanding || transitionSucceeded
      ? 'thread'
      : chatStore.messages.length ? 'thread' : 'welcome-restored'
    await scrollToBottom({ force: true })
    void chatStore.resumeSessionTurn?.(threadId, { historyLoaded: true })
    ElMessage.success(`已打开：${session.title}`)
  } else {
    failedSessionId.value = threadId
    historyLoadError.value = '无法读取目标会话，请检查网络后重试。'
    uiPhase.value = fromLanding || transitionSucceeded || hasPlayedFirstTransition.value
      ? 'thread'
      : chatStore.messages.length ? 'thread' : 'welcome-restored'
  }
}

function retryHistorySession(session) {
  if (!session?.thread_id) return
  return onSelectSession(session)
}

function retryHistorySessionById(threadId) {
  const session = displaySessions.value.find(item => item.thread_id === threadId)
  if (session) return retryHistorySession(session)
}

async function deleteSession(session) {
  if (!session?.thread_id || chatStore.currentThreadId === session.thread_id) {
    ElMessage.warning('当前会话不能直接删除，请先建立新会话。')
    return
  }
  const success = await chatStore.deleteSession(session.thread_id)
  if (!ownsPage()) return
  if (!success) {
    ElMessage.error('删除失败')
    return
  }
  sessionList.value = sessionList.value.filter(item => item.thread_id !== session.thread_id)
  ElMessage.success('会话已删除')
  fetchSessions()
}

watch(selectedPatientId, async () => {
  if (!ownsPage() || !isDoctor.value) return
  sessionsRequestId += 1
  if (consultationContext.selectionSource === 'agent' && chatStore.turnInFlight) {
    pendingAgenticSessionReset = true
    return
  }
  chatStore.disconnectActiveTurn?.()
  await transitionToNewSession({ resetStore: consultationContext.selectionSource === 'agent' })
  if (ownsPage()) void fetchSessions()
})

watch(() => chatStore.messages.length, (length) => {
  if (resetInProgress || uiPhase.value === 'route-loading') return
  if (uiPhase.value !== 'history-loading' && uiPhase.value !== 'first-commit') {
    if (length > 0) uiPhase.value = 'thread'
    else if (uiPhase.value === 'thread') uiPhase.value = 'welcome-restored'
  }
  if (length > 0) scrollToBottom()
})
watch(() => chatStore.isThinking, () => scrollToBottom())
watch([() => chatStore.turnInFlight, () => chatStore.trainingNavigationPending], ([inFlight, navigating]) => { /* demo: training nav is inert */
  scrollToBottom()
  if (inFlight || navigating || !pendingAgenticSessionReset || !ownsPage()) return
  pendingAgenticSessionReset = false
  void transitionToNewSession().then(() => { if (ownsPage()) void fetchSessions() })
})
watch(historyLoading, (loading, wasLoading) => {
  if (resetInProgress) return
  if (loading) {
    uiPhase.value = 'history-loading'
    return
  }
  if (wasLoading) {
    uiPhase.value = chatStore.messages.length ? 'thread' : 'welcome-restored'
  }
})
watch(experienceState, syncNanoSceneState)
watch(
  () => [
    route.query.consultationThread,
    route.query.consultationMessage,
    route.query.consultationArtifact,
  ].join('|'),
  value => {
    if (value.replace(/\|/g, '')) void revealConsultationTarget()
  },
  { flush: 'post' },
)

onMounted(async () => {
  window.addEventListener('resize', handleResize, { passive: true })
  routePhaseTimer = window.setTimeout(() => {
    if (uiPhase.value !== 'route-loading') return
    uiPhase.value = chatStore.messages.length ? 'thread' : 'welcome-fresh'
  }, shouldReduceMotion() ? 0 : 150)
  await nextTick()
  composerResizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => {
      reportComposerRect()
      nanoScene.refreshLayout()
    })
    : null
  if (composerDock.value) composerResizeObserver?.observe?.(composerDock.value)
  const composerElement = getComposerElement()
  if (composerElement && composerElement !== composerDock.value) {
    composerResizeObserver?.observe?.(composerElement)
  }
  syncNanoSceneState()
  if (!isStaticPreview.value) {
    await loadPatients()
    if (!ownsPage()) return
    delay(() => fetchSessions())
    if (currentQuery.value.consultationThread) await revealConsultationTarget()
  }
})

onBeforeUnmount(() => {
  disposed = true
  sessionsRequestId += 1
  phaseGeneration += 1
  entryGeneration += 1
  entryTimeline?.kill()
  entryTimeline = null
  labLayoutRef.value?.stopEntrySequence?.({ restoreEndpoint: false })
  chatStore.disconnectActiveTurn?.()
  window.clearTimeout(routePhaseTimer)
  window.removeEventListener('resize', handleResize)
  composerResizeObserver?.disconnect?.()
  composerResizeObserver = null
  nanoScene.setExclusionRect(null)
  nanoScene.settle()
})
</script>

<style scoped>
.chat-view {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: block;
  overflow: hidden;
  background: #F1F2EE;
  color: #171918;
  font-family: var(--font-chat);
  letter-spacing: 0;
  isolation: isolate;
}

.consultation-page {
  grid-column: 1;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: 64px 28px minmax(0, 1fr);
  overflow: hidden;
  border-inline: 1px solid var(--consult-line);
  background: transparent;
}

.conversation-context {
  min-width: 0;
  min-height: 64px;
  display: grid;
  grid-template-columns: minmax(164px, 204px) minmax(180px, 1fr) auto 48px;
  align-items: stretch;
  border-bottom: 1px solid var(--consult-line);
  background: color-mix(in srgb, var(--consult-surface) 82%, transparent);
  backdrop-filter: blur(14px) saturate(108%);
}

.context-command,
.context-identity,
.session-summary {
  min-width: 0;
  padding: 0 16px;
  border: 0;
  border-right: 1px solid var(--consult-line);
  background: transparent;
  color: inherit;
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
}

.context-command {
  border-radius: 0;
  cursor: pointer;
  transition: transform 120ms ease-out, background-color 120ms ease-out;
}

.context-command:active {
  transform: scale(.98);
}

.context-command:focus-visible {
  background: var(--consult-primary-soft);
}

.context-command:focus-visible {
  position: relative;
  z-index: 1;
  outline: 2px solid var(--consult-focus);
  outline-offset: -3px;
}

.archive-command:focus-visible {
  position: relative;
  z-index: 1;
  outline: none;
  box-shadow: inset 0 -2px 0 var(--consult-focus);
}

.context-icon {
  flex: 0 0 18px;
  color: var(--consult-secondary);
}

.context-command > span,
.context-identity > span,
.session-summary > span {
  min-width: 0;
}

.context-command small,
.context-command strong,
.context-identity small,
.context-identity strong,
.session-summary small,
.session-summary strong {
  display: block;
  letter-spacing: 0;
}

.context-command small,
.context-identity small,
.session-summary small {
  color: var(--consult-text-quiet);
  font: 500 10px/14px var(--font-chat-data);
}

.context-command strong,
.context-identity strong,
.session-summary strong {
  max-width: 100%;
  margin-top: 2px;
  overflow: hidden;
  color: var(--consult-text);
  font: 600 13px/20px var(--font-chat);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-summary :deep(.occlusal-trace) {
  flex: 0 0 42px;
  width: 42px;
  color: var(--consult-text-muted);
  opacity: .64;
}

.agent-presence {
  min-width: 0;
  padding: 0 14px;
  display: flex;
  align-items: center;
  gap: 12px;
  border-right: 1px solid var(--consult-line);
}

.agent-presence span {
  color: var(--consult-text-quiet);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: 500 10px/14px var(--font-chat-data);
  white-space: nowrap;
}

.agent-presence i {
  width: 6px;
  height: 6px;
  border: 1px solid currentColor;
  border-radius: 50%;
}

.agent-presence span.active {
  color: var(--consult-text);
}

.agent-presence span.active i {
  border-color: var(--consult-primary);
  background: var(--consult-primary);
  box-shadow: 0 0 0 3px var(--consult-primary-soft);
}

.archive-command {
  position: relative;
  isolation: isolate;
  width: 48px;
  height: 64px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--consult-text-muted);
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: color 120ms ease-out, transform 120ms ease-out;
}

.archive-command::before {
  content: '';
  position: absolute;
  z-index: -1;
  left: 50%;
  top: 50%;
  width: 32px;
  height: 32px;
  border: 1px solid var(--consult-line-strong);
  border-radius: 6px;
  background: var(--consult-surface-subtle);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 8%);
  transform: translate(-50%, -50%);
  transition: border-color 120ms ease-out, background-color 120ms ease-out;
}

.archive-command:active {
  transform: scale(.98);
}

@media (hover: hover) and (pointer: fine) {
  .context-command:hover,
  .quick-scenes button:hover {
    background: var(--consult-primary-soft);
    color: var(--consult-text);
  }

  .archive-command:hover::before {
    border-color: var(--consult-focus);
    background: var(--consult-primary-soft);
  }

  .new-message-command:hover {
    filter: brightness(1.04);
  }
}

.consultation-status-rail {
  min-width: 0;
  min-height: 28px;
  padding: 0 12px;
  display: grid;
  grid-template-columns: auto minmax(0, auto) minmax(24px, 1fr) auto;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid var(--consult-line);
  background: color-mix(in srgb, var(--consult-surface-subtle) 84%, transparent);
  color: var(--consult-text-quiet);
  font: 500 10px/14px var(--font-chat-data);
}

.status-rail-code,
.status-rail-phase {
  color: var(--consult-data);
  white-space: nowrap;
}

.status-rail-copy {
  overflow: hidden;
  color: var(--consult-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-rail-rule {
  height: 1px;
  background: var(--consult-line);
}

.conversation-stage {
  position: relative;
  min-width: 0;
  min-height: 0;
  display: grid;
  overflow: hidden;
  background: transparent;
}

.conversation-stage.is-thread {
  grid-template-rows: minmax(0, 1fr) 132px;
}

.messages-area {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  color: var(--consult-text);
  scrollbar-gutter: stable;
  scroll-behavior: smooth;
}

.is-thread .messages-area {
  padding: 32px max(24px, calc((100% - 960px) / 2)) 24px;
}

.message-list {
  width: min(960px, 100%);
  margin: 0 auto;
  display: grid;
  gap: 16px;
}

.conversation-welcome {
  position: relative;
  min-height: 100%;
  overflow: hidden;
}

.welcome-tools {
  position: absolute;
  left: 50%;
  top: calc(50% + 86px);
  width: min(760px, calc(100% - 48px));
  transform: translateX(-50%);
  transition: opacity 100ms linear, transform 100ms ease;
}

.is-first-transition .welcome-tools {
  opacity: 0;
  transform: translate(-50%, 4px);
  pointer-events: none;
}

/* The static first-submit path keeps both ends in the same Lab OS stage while
   the already-running SSE stream accumulates offscreen chat content. */
.chat-view.is-static-first-commit[data-ui-phase='first-commit'] :deep(.chat-lab-layout__landing.is-hidden),
.chat-view.is-static-first-commit[data-ui-phase='first-commit'] :deep(.chat-lab-layout__chat) {
  visibility: visible;
  pointer-events: none;
  transition: opacity 180ms linear, visibility 0s linear 180ms;
}

.chat-view.is-static-first-commit[data-ui-phase='first-commit'] :deep(.chat-lab-layout__landing.is-hidden) {
  opacity: 1;
}

.chat-view.is-static-first-commit-fading[data-ui-phase='first-commit'] :deep(.chat-lab-layout__landing.is-hidden) {
  opacity: 0;
}

.chat-view.is-static-first-commit[data-ui-phase='first-commit'] :deep(.chat-lab-layout__chat) {
  opacity: 0;
}

.chat-view.is-static-first-commit-fading[data-ui-phase='first-commit'] :deep(.chat-lab-layout__chat) {
  opacity: 1;
}

.quick-scenes {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border-block: 1px solid var(--consult-line);
}

.quick-scenes button {
  min-width: 0;
  min-height: 56px;
  padding: 0 16px;
  border: 0;
  border-right: 1px solid var(--consult-line);
  border-radius: 0;
  background: transparent;
  color: var(--consult-text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  transition: color 120ms ease-out, background-color 120ms ease-out, transform 120ms ease-out;
}

.quick-scenes button:last-child {
  border-right: 0;
}

.quick-scenes button:focus-visible {
  background: var(--consult-primary-soft);
  color: var(--consult-text);
}

.quick-scenes button:active {
  transform: scale(.98);
}

.quick-scenes button:focus-visible {
  outline: 2px solid var(--consult-focus);
  outline-offset: -3px;
}

.quick-scenes .el-icon {
  flex: 0 0 auto;
  color: var(--consult-secondary);
}

.quick-scenes strong {
  overflow: hidden;
  font: 500 13px/20px var(--font-chat);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer-dock {
  z-index: 5;
  min-width: 0;
  width: min(760px, calc(100% - 48px));
  margin: 0 auto;
}

.is-welcome .composer-dock {
  position: absolute;
  left: 50%;
  top: 50%;
  width: min(760px, calc(100% - 48px));
  margin: 0;
  transform: translate(-50%, -50%);
}

.is-thread .composer-dock {
  width: 100%;
  height: 132px;
  padding: 16px max(24px, calc((100% - 760px) / 2)) 20px;
  border-top: 1px solid var(--consult-line);
  background: color-mix(in srgb, var(--consult-canvas) 66%, transparent);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: flex-start;
}

.thinking-status {
  width: min(720px, 100%);
  min-height: 48px;
  margin: 16px auto 0;
  color: var(--consult-text-muted);
  display: flex;
  align-items: center;
  gap: 10px;
}

.thinking-status :deep(.occlusal-trace) {
  flex: 0 0 48px;
  width: 48px;
  color: var(--consult-secondary);
}

.thinking-status strong {
  font: 500 13px/20px var(--font-chat);
}

.turn-cancel-command {
  margin-left: auto;
  padding: 5px 9px;
  border: 1px solid currentColor;
  border-radius: 0;
  background: transparent;
  color: inherit;
  font: 500 11px/16px var(--font-chat-data);
  cursor: pointer;
}

.turn-cancel-command:focus-visible {
  outline: 2px solid var(--consult-secondary);
  outline-offset: 2px;
}

.history-load-status {
  position: absolute;
  inset: 0 0 auto;
  z-index: 6;
  min-height: 36px;
  padding: 10px 16px 9px;
  border-bottom: 1px solid var(--consult-line);
  background: var(--consult-surface);
  color: var(--consult-text-muted);
  font: 500 11px/16px var(--font-chat-data);
}

.history-load-error,
.sse-error-status {
  position: absolute;
  top: 42px;
  right: 0;
  left: 0;
  z-index: 5;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 2px 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--lab-line-strong, rgb(23 25 24 / 44%));
  background: var(--lab-paper-raised, #F8F8F4);
  color: var(--lab-ink, #171918);
}

.history-load-error strong,
.sse-error-status strong,
.history-load-error span,
.sse-error-status span {
  grid-column: 1;
}

.history-load-error strong,
.sse-error-status strong {
  font: 600 13px/20px var(--font-chat, "IBM Plex Sans SC", sans-serif);
}

.history-load-error span,
.sse-error-status span {
  color: var(--lab-muted, #696D69);
  font: 400 12px/18px var(--font-chat, "IBM Plex Sans SC", sans-serif);
}

.history-load-error button,
.sse-error-status button {
  grid-column: 2;
  grid-row: 1 / span 2;
  align-self: center;
  min-height: 32px;
  padding: 0 10px;
  border: 1px solid var(--lab-ink, #171918);
  border-radius: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.history-load-error button:focus-visible,
.sse-error-status button:focus-visible {
  outline: 2px solid var(--lab-orange, #F0642E);
  outline-offset: 2px;
}

.history-progress {
  position: absolute;
  inset: 0 auto auto 0;
  width: 100%;
  height: 2px;
  background: linear-gradient(
    90deg,
    transparent 0 12%,
    var(--consult-primary) 34% 68%,
    transparent 88% 100%
  );
  transform: translateX(-72%) scaleX(.28);
  transform-origin: left;
  animation: history-progress 1.1s linear infinite;
}

.history-loading .messages-area {
  padding-top: 52px;
}

.new-message-command {
  position: absolute;
  right: max(24px, calc((100% - 760px) / 2));
  bottom: 148px;
  z-index: 4;
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid var(--consult-line-strong);
  border-radius: 6px;
  background: var(--consult-primary);
  color: var(--consult-primary-ink);
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font: 600 13px/20px var(--font-chat);
  cursor: pointer;
  transition: transform 120ms ease-out, filter 120ms ease-out;
}

.new-message-command:focus-visible {
  filter: brightness(1.04);
}

.new-message-command:active {
  transform: scale(.98);
}

.phase-bridge {
  position: absolute;
  inset: 0;
  z-index: 8;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 14px;
  background: color-mix(in srgb, var(--consult-canvas) 88%, transparent);
  backdrop-filter: blur(8px);
  color: var(--consult-text-muted);
  font: 500 11px/16px var(--font-chat-data);
  pointer-events: none;
  animation: phase-bridge-in 150ms ease both;
}

.phase-bridge-track {
  position: relative;
  width: 126px;
  height: 22px;
  border-top: 1px solid var(--consult-line-strong);
  overflow: hidden;
}

.phase-bridge-track::after {
  content: '';
  position: absolute;
  left: 12px;
  top: -1px;
  width: 42px;
  height: 1px;
  background: var(--consult-primary);
  animation: phase-track 900ms ease-in-out infinite alternate;
}

.workbench-field label {
  display: block;
  margin-bottom: 8px;
  color: var(--consult-text);
  font: 600 13px/20px var(--font-chat);
}

.workbench-field p {
  margin-top: 8px;
  color: var(--consult-text-muted);
  font: 400 12px/20px var(--font-chat);
}

.message-enter-active {
  transition: opacity 160ms ease, transform 160ms ease;
}

.message-enter-from {
  opacity: 0;
  transform: translateY(4px);
}

@keyframes history-progress {
  to { transform: translateX(72%) scaleX(.28); }
}

@keyframes phase-bridge-in {
  from { opacity: 0; }
}

@keyframes phase-track {
  to { transform: translateX(60px); }
}

@media (max-width: 899px) {
  .conversation-context {
    grid-template-columns: minmax(150px, 200px) minmax(0, 1fr) 48px;
  }

  .agent-presence {
    display: none;
  }

  .session-summary {
    border-right: 1px solid var(--consult-line);
  }
}

@media (max-width: 767px) {
  .consultation-page {
    border-inline: 0;
  }

  .conversation-context {
    grid-template-columns: minmax(116px, 40%) minmax(0, 1fr) 48px;
  }

  .context-command,
  .context-identity,
  .session-summary {
    padding: 0 10px;
    gap: 7px;
  }

  .context-command small,
  .context-identity small,
  .session-summary small {
    font-size: 9px;
    line-height: 14px;
  }

  .context-command strong,
  .context-identity strong,
  .session-summary strong {
    font-size: 12px;
    line-height: 18px;
  }

  .session-summary :deep(.occlusal-trace) {
    display: none;
  }

  .consultation-status-rail {
    grid-template-columns: auto minmax(20px, 1fr) auto;
    gap: 8px;
    padding-inline: 10px;
  }

  .status-rail-copy {
    display: none;
  }

  .conversation-stage.is-thread {
    grid-template-rows: minmax(0, 1fr) 120px;
  }

  .is-thread .messages-area {
    padding: 24px 12px 16px;
  }

  .is-welcome .composer-dock {
    top: 47%;
    width: calc(100% - 32px);
  }

  .welcome-tools {
    top: calc(47% + 90px);
    width: calc(100% - 32px);
  }

  .quick-scenes button {
    min-height: 52px;
    padding-inline: 8px;
    gap: 5px;
  }

  .quick-scenes strong {
    font-size: 12px;
  }

  .is-thread .composer-dock {
    height: 120px;
    padding: 12px 10px max(12px, env(safe-area-inset-bottom));
  }

  .new-message-command {
    right: 12px;
    bottom: 132px;
  }

  .thinking-status {
    padding-inline: 4px;
  }

}

@supports not (backdrop-filter: blur(1px)) {
  .conversation-context,
  .consultation-status-rail,
  .is-thread .composer-dock,
  .phase-bridge {
    background: var(--consult-canvas);
  }
}

@media (prefers-reduced-motion: reduce) {
  .chat-view,
  .welcome-tools,
  .message-enter-active {
    animation: none;
    transition: none;
  }

  .messages-area {
    scroll-behavior: auto;
  }

  .history-progress,
  .phase-bridge,
  .phase-bridge-track::after {
    animation: none;
  }
}

/* Issue 04: the laboratory frame owns all spatial layout. The selectors below
   keep the existing business controls intact while removing their former card shell. */
.lab-context-tools {
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.lab-context-tools .context-command,
.lab-context-tools .context-identity {
  min-width: 0;
  min-height: 28px;
  padding: 0 8px;
  border: 0;
  color: var(--lab-ink, #171918);
  gap: 6px;
}

.lab-context-tools .context-icon { color: var(--lab-orange, #F0642E); }
.lab-context-tools small { display: none; }
.lab-context-tools strong {
  max-width: 156px;
  margin: 0;
  color: var(--lab-ink, #171918);
  font: 500 11px/28px var(--font-chat-data);
}

.lab-context-tools .archive-command {
  width: 28px;
  height: 28px;
  color: var(--lab-ink, #171918);
}

.lab-context-tools .archive-command::before {
  width: 26px;
  height: 26px;
  border-color: var(--lab-line, rgb(23 25 24 / 20%));
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.welcome-tools {
  position: static;
  width: 100%;
  transform: none;
}

.quick-scenes {
  border-color: var(--lab-line-strong, rgb(23 25 24 / 44%));
}

.quick-scenes button {
  min-height: 44px;
  border-color: var(--lab-line, rgb(23 25 24 / 20%));
  color: var(--lab-muted, #696D69);
}

.quick-scenes .el-icon { color: var(--lab-orange, #F0642E); }

.consultation-status-rail {
  min-height: 22px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--lab-muted, #696D69);
}

.status-rail-code,
.status-rail-phase { color: var(--lab-ink, #171918); }
.status-rail-rule { background: var(--lab-line, rgb(23 25 24 / 20%)); }

.conversation-stage,
.conversation-stage.is-thread {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  overflow: hidden;
}

.messages-area,
.is-thread .messages-area,
.history-loading .messages-area {
  width: 100%;
  min-height: 0;
  padding: 14px 0 0;
  color: var(--lab-ink, #171918);
  scroll-behavior: smooth;
}

.message-list {
  width: 100%;
  margin: 0;
  gap: 0;
}

.conversation-empty {
  min-height: 160px;
  border-top: 1px solid var(--lab-line-strong, rgb(23 25 24 / 44%));
  padding: 18px 0;
  color: var(--lab-muted, #696D69);
}

.conversation-empty span {
  font: 500 10px/14px var(--font-chat-data);
  letter-spacing: .04em;
}

.conversation-empty p {
  max-width: 440px;
  margin-top: 9px;
  font-size: 13px;
  line-height: 21px;
}

.composer-dock {
  width: 100%;
  margin: 0;
}

.thinking-status {
  width: 100%;
  margin-top: 0;
  padding: 14px 0;
  border-top: 1px solid var(--lab-line, rgb(23 25 24 / 20%));
  color: var(--lab-muted, #696D69);
}

.new-message-command {
  right: 0;
  bottom: 8px;
  border-color: var(--lab-ink, #171918);
  border-radius: 0;
  background: var(--lab-paper-raised, #F8F8F4);
  color: var(--lab-ink, #171918);
}

.phase-bridge {
  background: rgb(241 242 238 / 92%);
  color: var(--lab-muted, #696D69);
}

.phase-bridge-track { border-color: var(--lab-line-strong, rgb(23 25 24 / 44%)); }
.phase-bridge-track::after { background: var(--lab-orange, #F0642E); }

@media (max-width: 767px) {
  .lab-context-tools strong { display: none; }
  .quick-scenes { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .quick-scenes button { padding-inline: 4px; }
}
</style>

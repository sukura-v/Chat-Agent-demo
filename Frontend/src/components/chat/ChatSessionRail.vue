<template>
  <nav
    ref="railRef"
    class="session-rail"
    :class="{ 'is-management-open': managementOpen, 'is-locked': locked }"
    aria-label="会话历史轨道"
    data-testid="session-rail"
  >
    <div
      v-if="managementOpen"
      class="session-rail__management"
      role="region"
      aria-label="会话管理层"
      data-testid="session-management"
    >
      <span>SESSION MANAGEMENT</span>
      <strong>管理当前会话轨道</strong>
      <p>只允许删除已归档会话。当前会话需先通过“＋”建立新会话后才可管理。</p>
    </div>

    <header class="session-rail__header">
      <button
        ref="titleRef"
        type="button"
        class="session-rail__title"
        :disabled="locked"
        :aria-expanded="String(managementOpen)"
        aria-controls="session-management"
        @click="toggleManagement"
      >
        <span>SESSION TRACE</span>
        <strong>会话历史</strong>
      </button>
      <button
        type="button"
        class="session-rail__new"
        :disabled="loading || newSessionDisabled || locked"
        :aria-label="newSessionDisabled ? newSessionLabel : '新建会话'"
        @click="createSession"
      >
        <Plus :size="15" />
      </button>
    </header>

    <div v-if="loading" class="session-rail__status" role="status">正在调取记录</div>
    <div v-else-if="error" class="session-rail__status" role="alert">
      <span>{{ error }}</span>
      <button type="button" :disabled="locked" @click="$emit('retry')">重试</button>
    </div>

    <ol v-else-if="sessions.length" class="session-rail__list">
      <li v-for="session in sessions" :key="session.thread_id">
        <button
          type="button"
          class="session-rail__session"
          :data-session-thread="session.thread_id"
          :class="{
            'is-current': currentThreadId === session.thread_id,
            'is-pending': pendingThreadId === session.thread_id,
            'is-failed': failedThreadId === session.thread_id,
          }"
          :aria-current="currentThreadId === session.thread_id ? 'page' : undefined"
          :disabled="locked || pendingThreadId === session.thread_id || confirmingThreadId === session.thread_id"
          @click="selectSession(session)"
        >
          <span class="session-rail__node" data-session-node aria-hidden="true" />
          <span class="session-rail__copy">
            <strong>{{ session.title || '未命名会话' }}</strong>
            <time :datetime="session.updated_at || undefined">{{ session.updated_at || '时间未记录' }}</time>
            <small
              v-if="session.turnProgressLabel"
              class="session-rail__turn-progress"
              :data-tone="session.turnProgressTone"
            >
              {{ session.turnProgressLabel }}
            </small>
            <small v-if="failedThreadId === session.thread_id" role="alert">历史加载失败</small>
          </span>
        </button>

        <div v-if="failedThreadId === session.thread_id" class="session-rail__retry-row">
          <span>{{ sessionLoadError || '未能读取目标会话' }}</span>
          <button type="button" :disabled="locked" @click="$emit('retry-session', session)">重试</button>
        </div>

        <div v-if="managementOpen && currentThreadId !== session.thread_id" class="session-rail__manage-row">
          <span>ARCHIVE</span>
          <button
            v-if="confirmingThreadId !== session.thread_id"
            type="button"
            class="session-rail__delete"
            :disabled="locked || loading"
            :aria-label="`删除会话：${session.title || '未命名会话'}`"
            @click="beginDelete(session.thread_id)"
          >
            <Delete :size="14" />
            删除
          </button>
          <span v-else class="session-rail__confirm">
            <span>确认删除？</span>
            <button type="button" :disabled="locked" @click="cancelDelete(session.thread_id)">取消</button>
            <button type="button" :disabled="locked" @click="emitDelete(session)">确认</button>
          </span>
        </div>
      </li>
    </ol>

    <p v-else class="session-rail__empty">暂无历史会话</p>
  </nav>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'

const props = defineProps({
  sessions: { type: Array, default: () => [] },
  currentThreadId: { type: String, default: '' },
  pendingThreadId: { type: String, default: '' },
  failedThreadId: { type: String, default: '' },
  sessionLoadError: { type: String, default: '' },
  loading: Boolean,
  error: { type: String, default: '' },
  locked: Boolean,
  newSessionDisabled: Boolean,
  newSessionLabel: { type: String, default: '当前已是新会话' },
})

const emit = defineEmits(['select', 'create', 'retry', 'retry-session', 'delete'])
const railRef = ref(null)
const titleRef = ref(null)
const managementOpen = ref(false)
const confirmingThreadId = ref('')
let focusAfterDeleteId = ''

function closeManagement({ restoreFocus = false } = {}) {
  if (!managementOpen.value) return
  managementOpen.value = false
  confirmingThreadId.value = ''
  if (restoreFocus) nextTick(() => titleRef.value?.focus?.())
}

function toggleManagement() {
  if (managementOpen.value) closeManagement({ restoreFocus: true })
  else managementOpen.value = true
}

function createSession() {
  closeManagement()
  emit('create')
}

function selectSession(session) {
  closeManagement()
  emit('select', session)
}

function beginDelete(threadId) {
  confirmingThreadId.value = threadId
}

function cancelDelete(threadId) {
  if (confirmingThreadId.value !== threadId) return
  confirmingThreadId.value = ''
}

function emitDelete(session) {
  const index = props.sessions.findIndex(item => item.thread_id === session.thread_id)
  focusAfterDeleteId = props.sessions[index + 1]?.thread_id
    || props.sessions[index - 1]?.thread_id
    || ''
  confirmingThreadId.value = ''
  emit('delete', session)
}

watch(
  () => props.sessions.map(session => session.thread_id).join('|'),
  () => {
    if (!focusAfterDeleteId || props.sessions.some(session => session.thread_id === focusAfterDeleteId) === false) return
    const threadId = focusAfterDeleteId
    focusAfterDeleteId = ''
    nextTick(() => railRef.value?.querySelector(`[data-session-thread="${threadId}"]`)?.focus?.())
  },
)

function handleKeydown(event) {
  if (event.key === 'Escape' && managementOpen.value) {
    event.preventDefault()
    closeManagement({ restoreFocus: true })
  }
}

function handlePointerDown(event) {
  if (managementOpen.value && !railRef.value?.contains(event.target)) {
    closeManagement({ restoreFocus: true })
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  document.addEventListener('pointerdown', handlePointerDown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('pointerdown', handlePointerDown)
})

defineExpose({ closeManagement })
</script>

<style scoped>
.session-rail {
  position: relative;
  min-width: 0;
  color: var(--lab-ink, #171918);
  font-family: var(--font-chat, "IBM Plex Sans SC", sans-serif);
}

.session-rail__management {
  position: absolute;
  z-index: 1;
  inset: -16px auto -16px -16px;
  width: min(360px, calc(100vw - 32px));
  padding: 16px 16px 16px 20px;
  border: 1px solid var(--lab-line-strong, rgb(23 25 24 / 44%));
  background: color-mix(in srgb, var(--lab-paper-raised, #F8F8F4) 94%, transparent);
  box-shadow: 18px 0 40px rgb(23 25 24 / 9%);
  pointer-events: none;
}

.session-rail__management span,
.session-rail__management p,
.session-rail__manage-row > span,
.session-rail__retry-row > span {
  color: var(--lab-muted, #696D69);
  font: 500 10px/14px var(--font-chat-data, "IBM Plex Mono", monospace);
  letter-spacing: .04em;
}

.session-rail__management strong {
  display: block;
  margin-top: 3px;
  font-size: 14px;
  line-height: 20px;
}

.session-rail__management p {
  max-width: 250px;
  margin: 8px 0 0;
  font: 400 12px/18px var(--font-chat, "IBM Plex Sans SC", sans-serif);
  letter-spacing: 0;
}

.session-rail__header {
  position: relative;
  z-index: 2;
  min-height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid var(--lab-line, rgb(23 25 24 / 22%));
}

.session-rail__title {
  min-width: 0;
  display: grid;
  gap: 2px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.session-rail__title:disabled {
  cursor: not-allowed;
  opacity: .55;
}

.session-rail__title > span,
.session-rail__title > strong {
  display: block;
}

.session-rail__title:focus-visible,
.session-rail__new:focus-visible,
.session-rail__session:focus-visible,
.session-rail__delete:focus-visible,
.session-rail__retry-row button:focus-visible,
.session-rail__confirm button:focus-visible,
.session-rail__status button:focus-visible {
  outline: 2px solid var(--lab-ink, #171918);
  outline-offset: 2px;
}

.session-rail__header > div {
  display: grid;
  gap: 2px;
}

.session-rail__title > span,
.session-rail__copy time,
.session-rail__status,
.session-rail__empty {
  color: var(--lab-muted, #696D69);
  font: 500 10px/14px var(--font-chat-data, "IBM Plex Mono", monospace);
  letter-spacing: .04em;
}

.session-rail__title > strong {
  font-size: 14px;
  line-height: 20px;
}

.session-rail__new {
  width: 44px;
  height: 44px;
  border: 0;
  background: transparent;
  color: var(--lab-ink, #171918);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.session-rail__list {
  position: relative;
  z-index: 2;
  position: relative;
  margin: 18px 0 0;
  padding: 0;
  list-style: none;
}

.session-rail__list::before {
  content: '';
  position: absolute;
  top: 22px;
  bottom: 22px;
  left: 7px;
  width: 1px;
  background: var(--lab-line-strong, rgb(23 25 24 / 44%));
}

.session-rail__session {
  position: relative;
  width: 100%;
  min-height: 60px;
  padding: 8px 0;
  border: 0;
  background: transparent;
  color: var(--lab-ink, #171918);
  display: grid;
  grid-template-columns: 15px minmax(0, 1fr);
  align-items: center;
  gap: 15px;
  text-align: left;
  cursor: pointer;
}

.session-rail__node {
  position: relative;
  z-index: 1;
  width: 15px;
  height: 15px;
  border: 1px solid var(--lab-ink, #171918);
  border-radius: 0;
  background: var(--lab-ink, #171918);
}

.session-rail__session.is-current .session-rail__node,
.session-rail__session.is-pending .session-rail__node,
.session-rail__session.is-failed .session-rail__node {
  border-color: var(--lab-ink, #171918);
  background: var(--lab-orange, #F0642E);
}

.session-rail__copy {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.session-rail__copy strong,
.session-rail__copy time {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-rail__copy strong {
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
}

.session-rail__copy small {
  color: var(--lab-orange, #F0642E);
  font: 500 10px/14px var(--font-chat-data, "IBM Plex Mono", monospace);
}

.session-rail__copy .session-rail__turn-progress {
  color: var(--lab-muted, #696D69);
}

.session-rail__copy .session-rail__turn-progress[data-tone='processing'] {
  color: var(--lab-orange, #F0642E);
}

.session-rail__copy .session-rail__turn-progress[data-tone='partial'] {
  color: var(--consult-data, #596FA3);
}

.session-rail__retry-row,
.session-rail__manage-row {
  position: relative;
  z-index: 3;
  min-height: 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 0 8px 30px;
}

.session-rail__retry-row > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: 0;
}

.session-rail__retry-row button,
.session-rail__delete,
.session-rail__confirm button {
  min-height: 26px;
  padding: 0 8px;
  border: 1px solid var(--lab-line-strong, rgb(23 25 24 / 44%));
  border-radius: 0;
  background: transparent;
  color: inherit;
  font: 500 11px/18px var(--font-chat, "IBM Plex Sans SC", sans-serif);
  cursor: pointer;
}

.session-rail__manage-row {
  border-top: 1px solid var(--lab-line, rgb(23 25 24 / 20%));
}

.session-rail__manage-row > span {
  letter-spacing: .04em;
}

.session-rail__delete {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--lab-orange, #F0642E);
}

.session-rail__confirm {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--lab-orange, #F0642E) !important;
  letter-spacing: 0 !important;
}

.session-rail__confirm button:last-child {
  border-color: var(--lab-orange, #F0642E);
  background: var(--lab-orange, #F0642E);
  color: var(--lab-paper-raised, #F8F8F4);
}

.session-rail__session.is-current .session-rail__copy strong {
  font-weight: 600;
}

.session-rail__status,
.session-rail__empty {
  min-height: 72px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.session-rail__status button {
  min-height: 32px;
  padding-inline: 10px;
  border: 1px solid var(--lab-line-strong, rgb(23 25 24 / 44%));
  border-radius: 0;
  background: transparent;
  color: inherit;
}

@media (max-width: 767px) {
  .session-rail__header { min-height: 44px; }
  .session-rail__list {
    display: flex;
    gap: 20px;
    overflow-x: auto;
    padding-bottom: 4px;
  }
  .session-rail__list::before {
    top: 15px;
    right: 0;
    bottom: auto;
    left: 0;
    width: auto;
    height: 1px;
  }
  .session-rail__session {
    width: 156px;
    min-height: 46px;
    grid-template-columns: 15px 126px;
    flex: 0 0 auto;
  }

  .session-rail__management {
    inset: -12px -8px -12px -8px;
    width: calc(100vw - 32px);
  }
}
</style>

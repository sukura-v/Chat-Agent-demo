<template>
  <aside
    ref="historyRef"
    id="session-history"
    class="session-history-page"
    role="region"
    :aria-labelledby="titleId"
    :aria-busy="String(loading)"
    data-session-history-page
    data-testid="session-history-page"
  >
    <header class="history-header">
      <button
        type="button"
        class="history-close"
        aria-label="返回会诊"
        @click="$emit('close')"
      >
        <el-icon :size="18"><ArrowLeft /></el-icon>
      </button>
      <div>
        <span>SESSION ARCHIVE</span>
        <h2 :id="titleId" ref="titleRef" tabindex="-1">会话档案</h2>
      </div>
      <span class="history-count">{{ sessions.length.toString().padStart(2, '0') }}</span>
    </header>

    <div class="history-command-row">
      <button
        type="button"
        class="history-new-session"
        :disabled="loading"
        @click="$emit('create')"
      >
        <el-icon :size="16"><Plus /></el-icon>
        <span>新建会话</span>
      </button>
      <span>按最近更新排序</span>
    </div>

    <div class="history-body">
      <div v-if="loading" class="history-status" role="status">
        <span class="history-loader" aria-hidden="true" />
        <span>正在调取会诊记录</span>
      </div>

      <div v-else-if="error" class="history-error" role="alert">
        <strong>会话档案暂时不可用</strong>
        <span>{{ error }}</span>
        <button type="button" class="history-retry" @click="$emit('retry')">
          <el-icon :size="15"><RefreshRight /></el-icon>
          重试
        </button>
      </div>

      <div v-else-if="sessions.length" class="history-session-list">
        <article
          v-for="session in sessions"
          :key="session.thread_id"
          class="history-session-row"
          :class="{
            'is-current': currentThreadId === session.thread_id,
            'is-pending': pendingThreadId === session.thread_id,
            'is-confirming': confirmingThreadId === session.thread_id,
          }"
        >
          <button
            type="button"
            class="history-session-select"
            :disabled="
              pendingThreadId === session.thread_id
              || confirmingThreadId === session.thread_id
            "
            @click="$emit('select', session)"
          >
            <span class="history-session-state">
              {{ currentThreadId === session.thread_id ? 'CURRENT' : 'ARCHIVE' }}
            </span>
            <strong>{{ session.title || '未命名会话' }}</strong>
            <time>{{ session.updated_at || '时间未记录' }}</time>
            <small
              v-if="session.turnProgressLabel"
              class="history-session-progress"
              :data-tone="session.turnProgressTone"
            >
              {{ session.turnProgressLabel }}
            </small>
          </button>

          <button
            v-if="confirmingThreadId !== session.thread_id"
            :ref="element => setDeleteTrigger(session.thread_id, element)"
            type="button"
            class="history-delete"
            :disabled="loading"
            :aria-label="`删除会话：${session.title || '未命名会话'}`"
            @click="beginDelete(session.thread_id)"
          >
            <el-icon :size="16"><Delete /></el-icon>
          </button>

          <div v-else class="history-delete-panel" role="group" aria-label="确认删除会话">
            <span>永久删除？</span>
            <button
              type="button"
              class="history-delete-cancel"
              aria-label="取消删除"
              @click="cancelDelete(session.thread_id)"
            >
              <el-icon :size="15"><Close /></el-icon>
            </button>
            <button
              type="button"
              class="history-delete-confirm"
              aria-label="确认永久删除"
              @click="emitDelete(session)"
            >
              <el-icon :size="15"><Check /></el-icon>
            </button>
          </div>
        </article>
      </div>

      <div v-else class="history-empty">
        <span>NO ARCHIVED SESSION</span>
        <strong>暂无历史会话</strong>
        <p>建立新会话后，记录会按更新时间显示在这里。</p>
      </div>
    </div>
  </aside>
</template>

<script setup>
import { nextTick, onMounted, ref } from 'vue'
import { ArrowLeft, Check, Close, Delete, Plus, RefreshRight } from '@element-plus/icons-vue'

defineProps({
  sessions: { type: Array, default: () => [] },
  currentThreadId: { type: String, default: '' },
  pendingThreadId: { type: String, default: '' },
  loading: Boolean,
  error: { type: String, default: '' },
})

const emit = defineEmits(['select', 'create', 'delete', 'retry', 'close'])
const titleId = 'session-history-title'
const historyRef = ref(null)
const titleRef = ref(null)
const confirmingThreadId = ref('')
const deleteTriggers = new Map()

function setDeleteTrigger(threadId, element) {
  if (element) deleteTriggers.set(threadId, element)
  else deleteTriggers.delete(threadId)
}

function beginDelete(threadId) {
  confirmingThreadId.value = threadId
  nextTick(() => {
    historyRef.value?.querySelector(
      `.history-session-row.is-confirming .history-delete-cancel`,
    )?.focus()
  })
}

function cancelDelete(threadId) {
  confirmingThreadId.value = ''
  nextTick(() => deleteTriggers.get(threadId)?.focus())
}

function emitDelete(session) {
  confirmingThreadId.value = ''
  emit('delete', session)
}

onMounted(() => nextTick(() => titleRef.value?.focus()))
</script>

<style scoped>
.session-history-page {
  min-width: 0;
  height: 100%;
  overflow: hidden;
  display: grid;
  grid-template-rows: 64px 44px minmax(0, 1fr);
  border-left: 0;
  background: color-mix(in srgb, var(--consult-surface) 82%, transparent);
  backdrop-filter: blur(14px) saturate(108%);
  color: var(--consult-text);
  font-family: var(--font-chat);
}

.history-header {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  border-bottom: 1px solid var(--consult-line);
}

.history-header > div {
  position: relative;
  min-width: 0;
}

.history-header > div::before {
  content: "";
  position: absolute;
  top: 2px;
  bottom: 2px;
  left: -8px;
  width: 2px;
  background: var(--consult-focus);
  opacity: 0;
}

.history-header > div:focus-within::before {
  opacity: 1;
}

.history-header span,
.history-count,
.history-command-row > span,
.history-session-state,
.history-session-select time,
.history-empty > span {
  color: var(--consult-text-quiet);
  font: 500 10px/14px var(--font-chat-data);
  letter-spacing: 0;
}

.history-header h2 {
  margin: 1px 0 0;
  overflow: hidden;
  color: var(--consult-text);
  font: 600 16px/24px var(--font-display);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-header h2:focus-visible {
  outline: none;
}

.history-count {
  color: var(--consult-data);
}

.history-close,
.history-delete,
.history-delete-panel button {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--consult-line);
  border-radius: 6px;
  background: transparent;
  color: var(--consult-text-muted);
  cursor: pointer;
  transition: transform 120ms ease-out, border-color 120ms ease-out, color 120ms ease-out, background-color 120ms ease-out;
}

.history-close:focus-visible {
  border-color: var(--consult-focus);
  color: var(--consult-text);
}

.history-command-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 16px;
  border-bottom: 1px solid var(--consult-line);
  background: var(--consult-surface-raised);
}

.history-new-session,
.history-retry {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 32px;
  border: 0;
  background: transparent;
  color: var(--consult-text);
  font: 500 13px/20px var(--font-chat);
  cursor: pointer;
  transition: transform 120ms ease-out, color 120ms ease-out;
}

.history-new-session .el-icon {
  color: var(--consult-primary);
}

.history-body {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.history-status,
.history-error,
.history-empty {
  min-height: 180px;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 10px;
  padding: 24px;
  color: var(--consult-text-muted);
  text-align: center;
}

.history-status {
  grid-template-columns: auto auto;
  min-height: 72px;
  font: 500 11px/16px var(--font-chat-data);
}

.history-loader {
  width: 28px;
  height: 2px;
  background: var(--consult-primary);
  transform-origin: left;
  animation: history-loading 800ms ease-in-out infinite alternate;
}

.history-error strong,
.history-empty strong {
  color: var(--consult-text);
  font: 600 15px/24px var(--font-chat);
}

.history-error span,
.history-empty p {
  max-width: 260px;
  color: var(--consult-text-muted);
  font: 400 13px/20px var(--font-chat);
}

.history-retry {
  margin-top: 4px;
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid var(--consult-line-strong);
  border-radius: 6px;
}

.history-session-list {
  content-visibility: auto;
}

.history-session-row {
  position: relative;
  min-height: 72px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 48px;
  border-bottom: 1px solid var(--consult-line);
  background: transparent;
}

.history-session-row::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 2px;
  background: transparent;
}

.history-session-row.is-current::before,
.history-session-row.is-pending::before {
  background: var(--consult-primary);
}

.history-session-row.is-current {
  background: color-mix(in srgb, var(--consult-primary) 7%, transparent);
}

.history-session-select {
  min-width: 0;
  min-height: 72px;
  display: grid;
  align-content: center;
  justify-items: start;
  gap: 2px;
  padding: 9px 12px 9px 16px;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: transform 120ms ease-out, background-color 120ms ease-out;
}

.history-session-select:focus-visible {
  background: color-mix(in srgb, var(--consult-secondary) 8%, transparent);
  outline: none;
}

.history-session-select strong,
.history-session-select time {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-session-select strong {
  font: 500 13px/20px var(--font-chat);
}

.history-session-progress {
  color: var(--lab-muted, #696D69);
  font: 500 10px/15px var(--font-chat-data, monospace);
}

.history-session-progress[data-tone='processing'] { color: var(--lab-orange, #F0642E); }
.history-session-progress[data-tone='partial'] { color: var(--consult-data, #596FA3); }

.history-delete {
  align-self: center;
  justify-self: center;
  border-color: transparent;
  color: var(--consult-danger);
}

.history-delete:focus-visible {
  border-color: var(--consult-danger);
  background: color-mix(in srgb, var(--consult-danger) 9%, transparent);
}

.history-delete-panel {
  position: absolute;
  inset: 0;
  z-index: 2;
  grid-column: 1 / -1;
  min-height: 72px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 36px 36px;
  align-items: center;
  gap: 8px;
  padding: 0 12px 0 16px;
  background: var(--consult-surface-raised);
  color: var(--consult-danger);
  font: 500 13px/20px var(--font-chat);
}

.history-delete-panel button:last-child {
  border-color: var(--consult-danger);
  background: var(--consult-danger);
  color: var(--consult-canvas);
}

.history-close:active,
.history-delete:active,
.history-delete-panel button:active,
.history-new-session:active,
.history-retry:active,
.history-session-select:active {
  transform: scale(.98);
}

@media (hover: hover) and (pointer: fine) {
  .history-close:hover {
    border-color: var(--consult-focus);
    color: var(--consult-text);
  }

  .history-session-select:hover {
    background: color-mix(in srgb, var(--consult-secondary) 8%, transparent);
  }

  .history-delete:hover {
    border-color: var(--consult-danger);
    background: color-mix(in srgb, var(--consult-danger) 9%, transparent);
  }
}

@supports not (backdrop-filter: blur(1px)) {
  .session-history-page {
    background: var(--consult-surface);
  }
}

@keyframes history-loading {
  to { transform: scaleX(.36); }
}

@media (max-width: 1199px) {
  .session-history-page {
    border-left: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .history-loader {
    animation: none;
  }
}
</style>

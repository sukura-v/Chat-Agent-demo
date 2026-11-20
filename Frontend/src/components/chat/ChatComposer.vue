<template>
  <div
    ref="composerRef"
    class="composer"
    :class="[`composer--${variant}`, { 'composer--busy': busy }]"
    :aria-busy="String(busy)"
  >
    <button
      type="button"
      class="composer-menu"
      aria-label="打开快捷操作"
      :disabled="disabled"
      @click="$emit('toggle-actions', $event)"
    >
      <Plus :size="14" />
    </button>
    <el-input
      ref="inputRef"
      :model-value="modelValue"
      type="textarea"
      :autosize="{ minRows: 1, maxRows: 5 }"
      resize="none"
      :disabled="disabled"
      :placeholder="placeholder"
      aria-label="输入会诊消息"
      @update:model-value="$emit('update:modelValue', $event)"
      @compositionstart="isComposing = true"
      @compositionend="handleCompositionEnd"
      @keydown="handleKeydown"
    />
    <button
      type="button"
      class="composer-send"
      :disabled="disabled || !modelValue.trim()"
      aria-label="发送消息"
      @click="$emit('submit')"
    >
      <Position :size="16" />
    </button>
    <span
      v-if="busy"
      class="composer-turn-status"
      role="status"
      aria-live="polite"
    >
      正在等待回复，发送功能暂时停用
    </span>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { Plus, Position } from '@element-plus/icons-vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  disabled: Boolean,
  busy: Boolean,
  placeholder: { type: String, default: '' },
  variant: {
    type: String,
    default: 'docked',
    validator: value => ['welcome', 'docked'].includes(value),
  },
})

const emit = defineEmits(['update:modelValue', 'submit', 'toggle-actions'])
const composerRef = ref(null)
const inputRef = ref(null)
const isComposing = ref(false)

function handleCompositionEnd() {
  isComposing.value = false
}

function handleKeydown(event) {
  if (
    event.key !== 'Enter'
    || event.shiftKey
    || props.disabled
    || !props.modelValue.trim()
    || isComposing.value
    || event.isComposing
    || event.keyCode === 229
  ) return

  event.preventDefault()
  emit('submit')
}

function focus() {
  const input = inputRef.value
  if (typeof input?.focus === 'function') input.focus()
  else input?.$el?.querySelector('textarea')?.focus()
}

defineExpose({ focus, element: composerRef })
</script>

<style scoped>
.composer {
  --composer-glass: var(--lab-paper-raised, var(--consult-glass, var(--cq-glass, #F8F8F4)));
  position: relative;
  width: 100%;
  min-height: 64px;
  padding: 9px;
  border: 1px solid var(--lab-line-strong, var(--consult-line-strong, var(--cq-rule-strong, rgb(23 25 24 / 44%))));
  border-radius: 0;
  background: var(--composer-glass);
  box-shadow: none;
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 44px;
  align-items: end;
  gap: 8px;
  transition: border-color 160ms ease, box-shadow 160ms ease;
}

.composer--busy {
  border-color: var(--lab-orange, var(--consult-secondary, #F0642E));
}

.composer--busy::after {
  content: '';
  position: absolute;
  inset: auto 8px 4px;
  height: 2px;
  border-radius: 999px;
  background: linear-gradient(
    90deg,
    transparent 0 18%,
    var(--lab-orange, var(--consult-secondary, #F0642E)) 42% 58%,
    transparent 82% 100%
  );
  transform: translateX(-60%) scaleX(.45);
  transform-origin: center;
  animation: composer-turn-progress 1.1s ease-in-out infinite alternate;
  pointer-events: none;
}

.composer-turn-status {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@keyframes composer-turn-progress {
  to { transform: translateX(60%) scaleX(.45); }
}

.composer--welcome {
  min-height: 64px;
}

.composer:focus-within {
  border-color: var(--lab-orange, var(--consult-focus, #F0642E));
  box-shadow: inset 0 -2px 0 var(--lab-orange, var(--consult-focus, #F0642E));
}

.composer-menu,
.composer-send {
  position: relative;
  isolation: isolate;
  width: 44px;
  height: 44px;
  min-width: 44px;
  min-height: 44px;
  border: 0;
  border-radius: 0;
  background: transparent;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: color 120ms ease-out, transform 120ms ease-out;
}

.composer-menu::before,
.composer-send::before {
  content: '';
  position: absolute;
  z-index: -1;
  inset: 7px;
  border: 1px solid var(--lab-line, var(--consult-line-strong, rgb(23 25 24 / 20%)));
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  transition: border-color 120ms ease-out, background-color 120ms ease-out, filter 120ms ease-out;
}

.composer-menu {
  color: var(--lab-ink, var(--consult-text-muted, #171918));
}

.composer-send {
  color: var(--lab-paper-raised, var(--consult-primary-ink, #F8F8F4));
}

.composer-send::before {
  inset: 4px;
  border-color: var(--lab-ink, var(--consult-primary, #171918));
  background: var(--lab-ink, var(--consult-primary, #171918));
  box-shadow: inset 0 -2px 0 var(--lab-orange, #F0642E);
}

@media (hover: hover) and (pointer: fine) {
  .composer-menu:hover:not(:disabled)::before,
  .composer-send:hover:not(:disabled)::before {
    border-color: var(--lab-orange, var(--consult-focus, #F0642E));
  }

  .composer-menu:hover:not(:disabled) {
    color: var(--lab-ink, var(--consult-text, #171918));
  }

  .composer-menu:hover:not(:disabled)::before {
    background: rgb(240 100 46 / 8%);
  }
}

.composer-menu:active:not(:disabled),
.composer-send:active:not(:disabled) {
  transform: scale(.98);
}

.composer-menu:focus-visible,
.composer-send:focus-visible {
  outline: 2px solid var(--lab-orange, var(--consult-focus, #F0642E));
  outline-offset: 0;
}

.composer-menu:focus-visible::before,
.composer-send:focus-visible::before {
  border-color: var(--lab-orange, var(--consult-focus, #F0642E));
}

.composer-menu:disabled,
.composer-send:disabled {
  opacity: .4;
  cursor: not-allowed;
}

:deep(.el-textarea__inner) {
  min-height: 44px !important;
  padding: 10px 4px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--lab-ink, var(--consult-text, #171918));
  box-shadow: none !important;
  font-family: var(--font-chat, var(--font-family));
  font-size: 15px;
  line-height: 24px;
}

:deep(.el-textarea__inner::placeholder) {
  color: var(--lab-muted, var(--consult-text-quiet, #696D69));
  opacity: 1;
}

:deep(.el-textarea__inner:focus) {
  box-shadow: none !important;
}

@supports not (backdrop-filter: blur(1px)) {
  .composer {
    --composer-glass: var(--consult-surface, var(--cq-surface, #121613));
  }
}

@media (max-width: 767px) {
  :deep(.el-textarea__inner) { font-size: 16px; }
}

@media (prefers-reduced-motion: reduce) {
  .composer,
  .composer-menu,
  .composer-send {
    transition: none;
  }

  .composer--busy::after {
    animation: none;
    transform: none;
  }
}
</style>

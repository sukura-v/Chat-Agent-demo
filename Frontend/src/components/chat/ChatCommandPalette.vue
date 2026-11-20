<template>
  <div class="command-palette" aria-label="会诊快捷命令">
    <section class="command-section" aria-labelledby="quick-command-title">
      <div class="section-heading">
        <h3 id="quick-command-title">快捷任务</h3>
      </div>
      <div class="command-list">
        <button type="button" class="command-row" data-command="progress" @click="$emit('prefill', 'progress')">
          <span class="command-mark">PR</span>
          <span><strong>查询历史进度</strong><small>把进度问题写入输入框</small></span>
        </button>
        <button type="button" class="command-row" data-command="knowledge" @click="$emit('prefill', 'knowledge')">
          <span class="command-mark">KB</span>
          <span><strong>检索康复知识</strong><small>把知识问题写入输入框</small></span>
        </button>
        <button type="button" class="command-row command-row--quiet" data-command="clear" @click="$emit('clear')">
          <span class="command-mark">CL</span>
          <span><strong>清空当前视图</strong><small>返回会诊欢迎态</small></span>
        </button>
      </div>
    </section>

    <section v-if="suggestions.length" class="command-section" aria-labelledby="prompt-command-title">
      <div class="section-heading">
        <h3 id="prompt-command-title">可直接提问</h3>
      </div>
      <div class="prompt-list">
        <button
          v-for="prompt in suggestions"
          :key="prompt"
          type="button"
          class="prompt-command"
          @click="$emit('prefill-prompt', prompt)"
        >
          {{ prompt }}
        </button>
      </div>
    </section>
  </div>
</template>

<script setup>
defineProps({
  protocols: {
    type: Array,
    default: () => [],
  },
  suggestions: {
    type: Array,
    default: () => [],
  },
})

defineEmits(['prefill', 'prefill-prompt', 'clear'])
</script>

<style scoped>
.command-palette {
  display: grid;
  gap: 22px;
  color: var(--cq-text, var(--oc-deep-graphite, #272b28));
}

.command-section {
  display: grid;
  gap: 10px;
}

.section-heading {
  display: flex;
  align-items: baseline;
  gap: 9px;
}

.section-heading h3 {
  margin: 0;
  color: var(--cq-text-muted, var(--oc-text-muted, #70746f));
  font: 500 11px/1.2 var(--font-chat-data, var(--font-data, monospace));
  letter-spacing: .04em;
}

.command-list,
.protocol-list {
  display: grid;
  gap: 6px;
}

.prompt-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.prompt-command {
  min-height: 38px;
  padding: 8px 11px;
  border: 1px solid var(--cq-rule, var(--oc-warm-rule, #a9a79f));
  border-radius: 9px;
  background: transparent;
  color: var(--cq-text-muted, var(--oc-text-muted, #70746f));
  text-align: left;
  cursor: pointer;
}

.prompt-command:hover,
.prompt-command:focus-visible {
  border-color: var(--cq-focus, var(--oc-deep-graphite, #272b28));
  color: var(--cq-text, var(--oc-deep-graphite, #272b28));
  background: rgb(200 244 61 / 8%);
  outline: none;
}

.command-row,
.protocol-card {
  min-height: 58px;
  width: 100%;
  padding: 10px;
  border: 1px solid var(--cq-rule, color-mix(in srgb, var(--oc-warm-rule, #a9a79f) 70%, transparent));
  border-radius: 10px;
  background: var(--cq-surface-strong, rgb(244 246 240 / .72));
  color: inherit;
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  text-align: left;
  cursor: pointer;
}

.command-row:hover,
.protocol-card:hover,
.command-row:focus-visible,
.protocol-card:focus-visible {
  border-color: var(--cq-focus, var(--oc-deep-graphite, #272b28));
  background: rgb(200 244 61 / .16);
  outline: none;
}

.command-mark,
.protocol-icon {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: var(--cq-surface-raised, var(--oc-deep-graphite, #272b28));
  color: var(--cq-signal, var(--oc-signal-lime, #c8f43d));
  display: grid;
  place-items: center;
  font: 700 10px/1 var(--font-data, monospace);
}

.command-row strong,
.protocol-card strong,
.command-row small,
.protocol-card small {
  display: block;
}

.command-row strong,
.protocol-card strong {
  font-size: 13px;
}

.command-row small,
.protocol-card small {
  margin-top: 3px;
  color: var(--cq-text-muted, var(--oc-text-muted, #70746f));
  font-size: 11px;
  line-height: 1.35;
}

.command-row--quiet {
  opacity: .78;
}

.protocol-arrow {
  font-size: 17px;
}

@supports not (backdrop-filter: blur(1px)) {
  .command-row,
  .protocol-card {
    background: var(--cq-surface-strong, rgb(244 246 240 / .96));
  }
}
</style>

<template>
  <div class="occlusal-trace" :class="`trace--${mode}`">
    <OralCareMark
      v-if="mode !== 'thread'"
      class="trace-brand-mark"
      :tone="mode === 'training' ? 'light' : 'dark'"
      :calibrating="activeAgents.length > 0"
      aria-hidden="true"
    />
    <svg
      class="trace-graphic"
      viewBox="0 0 220 108"
      role="img"
      :aria-label="`OCAI 咬合轨迹，${modeLabel}`"
    >
      <path
        class="trace-guide"
        d="M20 57 C42 20 76 11 110 11 C144 11 178 20 200 57 C178 93 144 101 110 101 C76 101 42 93 20 57Z"
      />
      <path class="trace-occlusion trace-occlusion--upper" d="M42 58 C67 34 89 28 110 28 C131 28 153 34 178 58" />
      <path class="trace-occlusion trace-occlusion--lower" d="M42 58 C69 73 88 80 110 84 C132 80 151 73 178 58" />
      <path class="trace-signal" d="M67 61 C84 50 98 46 110 46 C122 46 136 50 153 61 C135 65 122 70 110 78 C98 70 85 65 67 61Z" />

      <g
        v-for="agent in agents"
        :key="agent.id"
        class="trace-agent-node"
        :class="{ 'is-active': activeAgents.includes(agent.id) }"
        :data-agent="agent.id"
      >
        <circle :cx="agent.x" :cy="agent.y" r="5" />
        <text :x="agent.x" :y="agent.y + 18" text-anchor="middle">{{ agent.id }}</text>
      </g>
    </svg>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import OralCareMark from '@/components/brand/OralCareMark.vue'

const props = defineProps({
  mode: {
    type: String,
    default: 'welcome',
    validator: value => ['welcome', 'thread', 'training'].includes(value),
  },
  activeAgents: {
    type: Array,
    default: () => [],
  },
})

const agents = [
  { id: 'C', x: 48, y: 22 },
  { id: 'A', x: 110, y: 8 },
  { id: 'B', x: 172, y: 22 },
]

const modeLabel = computed(() => ({
  welcome: '会诊就绪',
  thread: '会诊消息轨迹',
  training: '训练目标弧',
}[props.mode]))
</script>

<style scoped>
.occlusal-trace {
  --trace-ink: var(--oc-deep-graphite, #272b28);
  --trace-signal: var(--oc-signal-lime, #c8f43d);
  width: min(220px, 100%);
  color: var(--trace-ink);
  position: relative;
}

.trace-graphic {
  display: block;
  width: 100%;
  overflow: visible;
}

.trace-brand-mark {
  position: absolute;
  top: 4px;
  left: 50%;
  z-index: 1;
  width: 176px;
  transform: translateX(-50%);
}

.trace--welcome .trace-guide,
.trace--welcome .trace-occlusion,
.trace--welcome .trace-signal,
.trace--training .trace-guide,
.trace--training .trace-occlusion,
.trace--training .trace-signal {
  opacity: 0;
}

.trace-guide,
.trace-occlusion,
.trace-signal {
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.trace-guide {
  stroke: currentColor;
  stroke-width: 2.5;
  opacity: .3;
}

.trace-occlusion {
  stroke: currentColor;
  stroke-width: 3.5;
}

.trace-signal {
  stroke: var(--trace-signal);
  stroke-width: 4;
}

.trace-agent-node circle {
  fill: var(--oc-optical-white, #f4f6f0);
  stroke: currentColor;
  stroke-width: 1.5;
}

.trace-agent-node text {
  fill: currentColor;
  font: 700 8px/1 var(--font-data, monospace);
  opacity: .55;
}

.trace-agent-node.is-active circle {
  fill: var(--trace-signal);
  filter: drop-shadow(0 0 5px rgb(200 244 61 / .55));
}

.trace-agent-node.is-active text {
  opacity: 1;
}

.trace--thread {
  width: 78px;
}

.trace--thread .trace-guide,
.trace--thread .trace-agent-node {
  opacity: 0;
}

.trace--thread .trace-occlusion--upper {
  transform: translateY(10px) scaleX(.88);
  transform-origin: center;
}

.trace--thread .trace-occlusion--lower,
.trace--thread .trace-signal {
  transform: translateY(-8px) scaleX(.72);
  transform-origin: center;
}

.trace--training {
  color: var(--oc-optical-white, #f4f6f0);
}

.trace--training .trace-guide {
  stroke-dasharray: 5 8;
  opacity: .45;
}

@media (prefers-reduced-motion: no-preference) {
  .trace-guide,
  .trace-occlusion,
  .trace-signal,
  .trace-agent-node {
    transition: transform .24s ease, opacity .2s ease, stroke .2s ease;
  }
}

@media (prefers-reduced-motion: reduce) {
  .trace-guide,
  .trace-occlusion,
  .trace-signal,
  .trace-agent-node {
    transition: none;
  }
}
</style>

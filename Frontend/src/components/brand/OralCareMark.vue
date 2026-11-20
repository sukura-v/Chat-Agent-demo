<template>
  <span
    class="oralcare-mark"
    :class="[`oralcare-mark--${tone}`, { 'oralcare-mark--calibrating': calibrating }]"
    :style="{ '--mark-size': normalizedSize }"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
    role="img"
  >
    <svg viewBox="0 0 240 132" focusable="false">
      <path
        class="mark-orbit"
        d="M28 66C48 26 86 14 120 14s72 12 92 52c-20 40-58 52-92 52S48 106 28 66Z"
      />
      <path
        class="mark-motion"
        d="M62 78c25-27 69-35 112-12-22 2-42 12-57 29-20-9-38-14-55-17Z"
      />
      <path
        class="mark-scan"
        d="M62 78c25-27 69-35 112-12-22 2-42 12-57 29-20-9-38-14-55-17Z"
      />
      <path class="mark-gap" d="M194 94c10-8 17-17 22-28" />
      <path class="mark-tick mark-tick--1" d="M120 5v16" />
      <path class="mark-tick mark-tick--2" d="M53 30l11 12" />
      <path class="mark-tick mark-tick--3" d="M187 30l-11 12" />
      <path class="mark-tick mark-tick--4" d="M120 111v16" />
    </svg>
  </span>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  size: { type: [Number, String], default: 96 },
  tone: { type: String, default: 'light' },
  label: { type: String, default: '' },
  calibrating: { type: Boolean, default: false },
})

const normalizedSize = computed(() => (
  typeof props.size === 'number' ? `${props.size}px` : props.size
))
</script>

<style scoped>
.oralcare-mark {
  display: inline-flex;
  width: var(--mark-size);
  aspect-ratio: 240 / 132;
  color: var(--oc-optical-white);
  flex: 0 0 auto;
}

.oralcare-mark--dark { color: var(--oc-deep-graphite); }
.oralcare-mark--signal { color: var(--oc-signal-lime); }
.oralcare-mark svg { width: 100%; height: 100%; overflow: visible; }

.mark-orbit,
.mark-motion,
.mark-scan,
.mark-gap,
.mark-tick {
  fill: none;
  stroke: currentColor;
  stroke-linecap: square;
  stroke-linejoin: round;
}

.mark-orbit { stroke-width: 7; }
.mark-motion { stroke-width: 7; }
.mark-scan {
  stroke: var(--oc-signal-lime);
  stroke-width: 4;
  stroke-dasharray: 260;
  stroke-dashoffset: 260;
  opacity: 0;
}
.mark-gap { stroke-width: 13; }
.mark-tick { stroke-width: 4; }

.oralcare-mark--calibrating .mark-scan { animation: mark-calibration 6s cubic-bezier(.2, .8, .2, 1) infinite; }
.oralcare-mark--calibrating .mark-tick { animation: mark-tick-calibration 6s ease-in-out infinite; }
.oralcare-mark--calibrating .mark-tick--2 { animation-delay: 90ms; }
.oralcare-mark--calibrating .mark-tick--3 { animation-delay: 180ms; }
.oralcare-mark--calibrating .mark-tick--4 { animation-delay: 270ms; }

@keyframes mark-calibration {
  0%, 3% { stroke-dashoffset: 260; opacity: 0; }
  5% { opacity: 1; }
  17%, 21% { stroke-dashoffset: 0; opacity: 1; }
  27%, 100% { stroke-dashoffset: 0; opacity: 0; }
}

@keyframes mark-tick-calibration {
  0%, 4%, 24%, 100% { stroke: currentColor; opacity: 1; }
  9%, 17% { stroke: var(--oc-signal-lime); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .oralcare-mark--calibrating .mark-scan,
  .oralcare-mark--calibrating .mark-tick { animation: none; }
}
</style>

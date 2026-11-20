<template>
  <section
    :id="targetId"
    class="section-artifact consultation-rich-target"
    :data-artifact-type="artifact.action_type"
    tabindex="-1"
  >
    <header class="section-artifact__header">
      <span>结果附件</span>
      <strong>{{ artifact.title || artifactTitle }}</strong>
    </header>

    <div v-if="artifact.action_type === 'ProgressChart'" class="artifact-progress">
      <svg
        v-if="scoredPoints.length > 1"
        class="artifact-progress__chart"
        viewBox="0 0 320 112"
        role="img"
        :aria-label="`${artifact.title || '训练进展'}，共 ${scoredPoints.length} 个数据点`"
      >
        <line x1="12" y1="96" x2="308" y2="96" />
        <polyline :points="chartPoints" />
        <circle
          v-for="point in plottedPoints"
          :key="point.key"
          :cx="point.x"
          :cy="point.y"
          r="3.5"
        />
      </svg>
      <ol class="artifact-progress__points">
        <li v-for="point in scoredPoints" :key="point.key">
          <span>{{ point.label }}</span>
          <strong>{{ point.score }} 分</strong>
        </li>
      </ol>
    </div>

    <ol v-else-if="artifact.action_type === 'StepsCard'" class="artifact-steps">
      <li v-for="(step, index) in artifact.steps || []" :key="step.step_index ?? index">
        <span>{{ String(index + 1).padStart(2, '0') }}</span>
        <div>
          <strong>{{ step.title || `步骤 ${index + 1}` }}</strong>
          <p>{{ step.instruction_text || step.description || step.desc || step.text || '' }}</p>
        </div>
      </li>
    </ol>

    <dl v-else-if="artifact.action_type === 'HistorySummaryCard'" class="artifact-summary">
      <div v-for="(value, key) in artifact.summary || {}" :key="key">
        <dt>{{ fieldLabel(key) }}</dt>
        <dd>{{ value ?? '—' }}</dd>
      </div>
    </dl>

    <ol v-else-if="artifact.action_type === 'HistoryListCard'" class="artifact-records">
      <li v-for="(record, index) in artifact.records || []" :key="index">
        <strong>{{ record.action_type || `训练记录 ${index + 1}` }}</strong>
        <span>{{ record.training_time || '时间未记录' }}</span>
        <span v-if="record.overall_score != null || record.score != null">
          {{ record.overall_score ?? record.score }} 分
        </span>
      </li>
    </ol>
  </section>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  artifact: { type: Object, required: true },
  targetId: { type: String, default: '' },
})

const artifactTitle = computed(() => ({
  ProgressChart: '训练进展',
  StepsCard: '训练步骤',
  HistorySummaryCard: '训练摘要',
  HistoryListCard: '训练记录',
}[props.artifact.action_type] || '补充结果'))

const scoredPoints = computed(() => (props.artifact.points || [])
  .filter(point => Number.isFinite(Number(point?.overall_score ?? point?.score)))
  .map((point, index) => ({
    key: `${point.training_time || index}-${index}`,
    label: point.label || point.training_time || point.action_type || `第 ${index + 1} 次`,
    score: Math.max(0, Math.min(100, Number(point.overall_score ?? point.score))),
  })))

const plottedPoints = computed(() => {
  const points = scoredPoints.value
  const denominator = Math.max(1, points.length - 1)
  return points.map((point, index) => ({
    ...point,
    x: 12 + (296 * index / denominator),
    y: 96 - (80 * point.score / 100),
  }))
})

const chartPoints = computed(() => plottedPoints.value.map(point => `${point.x},${point.y}`).join(' '))

function fieldLabel(key) {
  return ({
    record_count: '记录数',
    scored_count: '已评分',
    latest_score: '最近得分',
    action_type: '训练动作',
    training_time: '训练时间',
  })[key] || key
}
</script>

<style scoped>
.section-artifact {
  margin-top: 14px;
  border: 1px solid var(--lab-line, rgb(23 25 24 / 20%));
  background: var(--lab-paper-raised, #F8F8F4);
}

.section-artifact.is-navigation-target {
  animation: artifact-target-pulse 1.5s ease-out;
}

@keyframes artifact-target-pulse {
  0%, 35% { border-color: var(--lab-orange, #F0642E); box-shadow: 0 0 0 3px rgb(240 100 46 / 20%); }
  100% { border-color: var(--lab-line, rgb(23 25 24 / 20%)); box-shadow: none; }
}

.section-artifact__header {
  min-height: 42px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--lab-line, rgb(23 25 24 / 20%));
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
}

.section-artifact__header span {
  color: var(--lab-orange, #F0642E);
  font: 500 10px/14px var(--font-chat-data, monospace);
  letter-spacing: .04em;
}

.section-artifact__header strong {
  color: var(--lab-ink, #171918);
  font: 600 13px/20px var(--font-chat, sans-serif);
}

.artifact-progress {
  padding: 12px;
}

.artifact-progress__chart {
  width: 100%;
  height: 112px;
  overflow: visible;
}

.artifact-progress__chart line {
  stroke: var(--lab-line-strong, rgb(23 25 24 / 44%));
  stroke-width: 1;
}

.artifact-progress__chart polyline {
  fill: none;
  stroke: var(--lab-orange, #F0642E);
  stroke-width: 2.5;
  vector-effect: non-scaling-stroke;
}

.artifact-progress__chart circle {
  fill: var(--lab-paper-raised, #F8F8F4);
  stroke: var(--lab-orange, #F0642E);
  stroke-width: 2;
}

.artifact-progress__points,
.artifact-steps,
.artifact-records {
  margin: 0;
  padding: 0;
  list-style: none;
}

.artifact-progress__points {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 8px;
}

.artifact-progress__points li,
.artifact-records li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  color: var(--lab-muted, #696D69);
  font: 400 11px/17px var(--font-chat-data, monospace);
}

.artifact-progress__points strong,
.artifact-records strong {
  color: var(--lab-ink, #171918);
}

.artifact-steps li {
  padding: 12px;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 10px;
  border-bottom: 1px solid var(--lab-line, rgb(23 25 24 / 20%));
}

.artifact-steps li:last-child { border-bottom: 0; }
.artifact-steps > li > span { color: var(--lab-orange, #F0642E); font: 500 10px/16px var(--font-chat-data, monospace); }
.artifact-steps strong { font: 600 13px/20px var(--font-chat, sans-serif); }
.artifact-steps p { margin-top: 3px; color: var(--lab-muted, #696D69); font: 400 12px/19px var(--font-chat, sans-serif); white-space: pre-wrap; }

.artifact-summary {
  margin: 0;
  padding: 12px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
}

.artifact-summary div { padding-bottom: 7px; border-bottom: 1px solid var(--lab-line, rgb(23 25 24 / 20%)); }
.artifact-summary dt { color: var(--lab-muted, #696D69); font: 400 10px/15px var(--font-chat-data, monospace); }
.artifact-summary dd { margin: 3px 0 0; color: var(--lab-ink, #171918); font: 600 13px/20px var(--font-chat, sans-serif); }

.artifact-records { padding: 4px 12px; }
.artifact-records li { min-height: 38px; border-bottom: 1px solid var(--lab-line, rgb(23 25 24 / 20%)); }
.artifact-records li:last-child { border-bottom: 0; }

@media (prefers-reduced-motion: reduce) {
  .section-artifact * { animation: none; transition: none; }
}
</style>

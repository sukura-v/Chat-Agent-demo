<template>
  <article :id="messageTargetId" class="chat-message message-record" :class="{
    'user-msg': message.role === 'user',
    'system-notice-msg': message.role === 'system',
    'has-rich-content': Boolean(message.richType),
    'is-stream-aborted': message.streamState === 'aborted',
    'is-latest': isLatest,
  }">
    <span class="message-record__rule" aria-hidden="true" />
    <header class="message-record__meta agent-name-bar">
      <span class="message-record__role">{{ roleLabel }}</span>
      <span v-if="isClinicianOrder" class="clinician-seal-badge" data-testid="clinician-seal-badge">
        <span class="seal-icon">★</span> 执业医师实名签署
      </span>
      <span v-else-if="message.role !== 'user' && message.role !== 'system'" class="agent-label">
        {{ message.agentName || `Agent ${message.agent || 'C'}` }}
      </span>
      <span v-if="isClinicianOrder && feedbackTypeLabel" class="feedback-type-pill">
        {{ feedbackTypeLabel }}
      </span>
      <time class="msg-time" :datetime="timestampIso">{{ formatTime(message.timestamp) }}</time>
    </header>

    <div class="message-record__body">
      <div v-if="message.role === 'system'" class="system-notice-bar">
        <span class="system-notice-icon">[!]</span>
        <span class="system-notice-text">{{ message.content }}</span>
      </div>

      <template v-else>
        <div v-if="message.statusList && message.statusList.length" class="status-feed">
          <div v-for="(status, index) in message.statusList" :key="index" class="status-item">
            {{ status }}
          </div>
        </div>

        <div v-if="message.diagnosisText" class="diagnosis-accordion">
          <details :open="!message.content">
            <summary>[!] 临床专家诊断分析</summary>
            <div class="diagnosis-content markdown-body" v-html="formatText(message.diagnosisText)" />
          </details>
        </div>

        <div v-if="hasAnswerSections || consultationTasks.length" class="consultation-result">
          <details v-if="consultationTasks.length" class="consultation-task-plan">
            <summary>
              <span>任务总进度</span>
              <strong>{{ progressLabel }}</strong>
            </summary>
            <ol class="consultation-task-list">
              <li v-for="task in consultationTasks" :key="task.task_id">
                <span class="consultation-task-list__ordinal">{{ String(task.ordinal + 1).padStart(2, '0') }}</span>
                <div>
                  <strong>{{ task.title || `任务 ${task.ordinal + 1}` }}</strong>
                  <small :data-task-status="task.status">
                    {{ isTaskCancelRequested(task.task_id) ? '正在取消' : taskStatusLabel(task.status) }}
                  </small>
                </div>
                <span v-if="isLatest" class="consultation-task-list__actions">
                  <button
                    v-if="isWaitingConfirmation(task.status) && !isTaskCancelRequested(task.task_id)"
                    type="button"
                    :disabled="isTaskActionPending(task.task_id)"
                    @click="$emit('confirm-task', { message, task })"
                  >
                    {{ isTaskActionPending(task.task_id) ? '正在确认' : '确认此项' }}
                  </button>
                  <button
                    v-if="canCancelTask(task.status) && !isTaskCancelRequested(task.task_id)"
                    type="button"
                    :disabled="isTaskActionPending(task.task_id)"
                    @click="$emit('cancel-task', { message, task })"
                  >
                    {{ isTaskActionPending(task.task_id) ? '处理中' : '取消此项' }}
                  </button>
                  <button
                    v-if="task.status === 'NEEDS_INPUT'"
                    type="button"
                    :disabled="isTaskActionPending(task.task_id)"
                    @click="$emit('clarify-task', { message, task })"
                  >
                    {{ isTaskActionPending(task.task_id) ? '处理中' : '补充此项' }}
                  </button>
                  <button
                    v-if="canRetryTask(task.status)"
                    type="button"
                    :disabled="isTaskActionPending(task.task_id)"
                    @click="$emit('retry-task', { message, task })"
                  >
                    {{ isTaskActionPending(task.task_id) ? '处理中' : '重试此项' }}
                  </button>
                </span>
              </li>
            </ol>
          </details>

          <section
            v-for="section in answerSections"
            :key="section.section_id"
            class="answer-section"
            :data-section-status="section.status"
          >
            <header class="answer-section__header">
              <span>分区 {{ String(section.ordinal + 1).padStart(2, '0') }}</span>
              <small>{{ taskStatusLabel(section.status) }}</small>
            </header>
            <h3>{{ section.question }}</h3>
            <div class="answer-section__narrative markdown-body" v-html="formatText(section.narrative)" />
            <p v-if="section.safety_notice" class="answer-section__safety">
              <strong>安全提示</strong>
              <span>{{ section.safety_notice }}</span>
            </p>
            <ConsultationArtifact
              v-for="(artifact, artifactIndex) in section.artifacts"
              :key="artifactKey(artifact)"
              :artifact="artifact"
              :target-id="artifactTargetId(artifact, artifactIndex)"
            />
          </section>
        </div>

        <p
          v-if="message.content && message.role === 'user'"
          class="msg-text message-record__copy markdown-body"
        >
          {{ message.content }}
        </p>
        <div
          v-else-if="message.content && !hasAnswerSections"
          class="msg-text message-record__copy markdown-body"
          v-html="formatText(message.content)"
        />

        <!-- AI 消息模型版本与非诊断免责声明微标 -->
        <div
          v-if="isAIResponse && message.content && !hasAnswerSections"
          class="ai-provenance-footer"
          data-testid="ai-provenance-footer"
        >
          <div class="provenance-pills">
            <span class="prov-pill prov-model" title="生成模型版本">
              <span class="pill-dot"></span>
              {{ aiModelVersion }}
            </span>
            <span v-if="aiSourcesLabel" class="prov-pill prov-source" title="知识库与临床指南检索血缘">
              <span class="pill-dot"></span>
              知识: {{ aiSourcesLabel }}
            </span>
            <span v-if="aiPromptPolicy" class="prov-pill prov-policy" title="Prompt 策略版本">
              策略: {{ aiPromptPolicy }}
            </span>
          </div>
          <div class="provenance-disclaimer">
            <span class="disclaimer-icon">🛡️</span>
            <span class="disclaimer-text">{{ aiDisclaimerText }}</span>
          </div>
        </div>

        <!-- 医生普通文本医嘱签署角标 -->
        <div
          v-if="isClinicianOrder && message.richType !== 'ClinicianFeedbackCard' && message.richType !== 'clinician_feedback'"
          class="clinician-order-seal-footer"
          data-testid="clinician-order-seal"
        >
          <div class="seal-badge-container">
            <span class="seal-stamp-circle">医师签署</span>
            <div class="seal-details">
              <div class="seal-doctor-name">执业医师：{{ clinicianDoctorName }}（实名签署）</div>
              <div class="seal-time-auth">认证时间：{{ formatTime(clinicianSignedAt) }} · 正式临床指导医嘱</div>
            </div>
          </div>
        </div>

        <div
          v-if="message.streamState === 'aborted'"
          class="stream-aborted"
          data-testid="stream-aborted"
          role="status"
        >
          <span>生成已中止</span>
          <button
            v-if="message.retryPrompt"
            type="button"
            data-testid="retry-generation"
            :disabled="message.retryRequested"
            @click="$emit('retry', message)"
          >
            {{ message.retryRequested ? '正在重新生成' : '重新生成' }}
          </button>
        </div>

        <div
          v-else-if="durableStatusLabel"
          class="stream-aborted durable-turn-state"
          data-testid="durable-turn-state"
          role="status"
        >
          <span>{{ durableStatusLabel }}</span>
          <button
            v-if="message.streamState === 'retryable_paused'"
            type="button"
            :disabled="message.retryRequested"
            @click="$emit('retry-turn', message)"
          >
            {{ message.retryRequested ? '正在恢复' : '继续本轮' }}
          </button>
          <button
            v-else-if="message.streamState === 'disconnected'"
            type="button"
            :disabled="message.retryRequested"
            @click="$emit('resume-turn', message)"
          >
            {{ message.retryRequested ? '正在重连' : '重新连接' }}
          </button>
          <button
            v-if="canCancelDurableTurn"
            type="button"
            @click="$emit('cancel-turn', message)"
          >
            取消本轮
          </button>
        </div>

        <div
          v-if="message.richType === 'card'"
          :id="legacyRichTargetId"
          class="diagnosis-card consultation-rich-target"
          tabindex="-1"
        >
          <div class="card-header">
            <div class="card-icon">[R]</div>
            <div>
              <div class="card-title">{{ message.richData?.title || '评估报告' }}</div>
              <div class="card-meta">{{ formatTime(message.timestamp) }}</div>
            </div>
          </div>
          <div class="card-body">
            <div v-if="message.richData?.scores?.length" class="scores-section">
              <div class="section-label">各维度评估</div>
              <div class="scores-grid">
                <div v-for="item in message.richData.scores" :key="item.label" class="score-item">
                  <div class="score-head">
                    <span class="score-label">{{ item.label }}</span>
                    <span class="score-status">{{ item.status }}</span>
                  </div>
                  <el-progress :percentage="item.score" :stroke-width="8" :color="item.color" :show-text="false" />
                  <span class="score-val">{{ item.score }}分</span>
                </div>
              </div>
            </div>
            <div v-if="message.richData?.suggestions?.length" class="suggestions-section">
              <div class="section-label">康复建议</div>
              <div v-for="(suggestion, index) in message.richData.suggestions" :key="index" class="suggestion-item">
                <div class="sug-num">{{ index + 1 }}</div>
                <span>{{ suggestion }}</span>
              </div>
            </div>
            <div v-if="message.richData?.knowledge_source" class="knowledge-source">
              <el-icon><Reading /></el-icon>
              {{ message.richData.knowledge_source }}
            </div>
          </div>
        </div>

        <div v-else-if="message.richType === 'steps'" :id="legacyRichTargetId" class="steps-card-msg consultation-rich-target" tabindex="-1">
          <div class="steps-header"><span>[+]</span> 训练要领步骤</div>
          <div class="steps-list">
            <div v-for="(step, index) in message.richData?.steps" :key="index" class="step-row">
              <div class="step-num-badge">{{ index + 1 }}</div>
              <div class="step-detail">
                <div class="step-title">{{ step.title }}</div>
                <div class="step-desc">{{ step.desc }}</div>
              </div>
            </div>
          </div>
          <div v-if="message.richData?.knowledge_source" class="knowledge-source">
            <el-icon><Reading /></el-icon>
            {{ message.richData.knowledge_source }}
          </div>
        </div>

        <div v-else-if="message.richType === 'history_summary'" :id="legacyRichTargetId" class="diagnosis-card consultation-rich-target" tabindex="-1">
          <div class="card-header">
            <div class="card-icon">[H]</div>
            <div class="card-title">{{ message.richData?.title || '训练记录摘要' }}</div>
          </div>
          <div class="card-body history-facts">
            <div v-for="(value, key) in message.richData?.summary" :key="key" class="history-fact">
              <span>{{ historyFieldLabel(key) }}</span>
              <strong>{{ value ?? '—' }}</strong>
            </div>
          </div>
        </div>

        <div v-else-if="message.richType === 'history_list'" :id="legacyRichTargetId" class="diagnosis-card consultation-rich-target" tabindex="-1">
          <div class="card-header">
            <div class="card-icon">[H]</div>
            <div class="card-title">{{ message.richData?.title || '训练记录' }}</div>
          </div>
          <div class="card-body history-records">
            <div v-for="(record, index) in message.richData?.records" :key="index" class="history-record">
              <strong>{{ record.action_type || `记录 ${index + 1}` }}</strong>
              <span>{{ record.training_time || '时间未记录' }}</span>
              <span v-if="record.overall_score != null">{{ record.overall_score }} 分</span>
            </div>
          </div>
        </div>

        <div v-else-if="message.richType === 'progress'" :id="legacyRichTargetId" class="progress-msg consultation-rich-target" tabindex="-1">
          <div v-if="message.richData?.show_chart || message.richData?.chartData" class="inline-chart-container">
            <div class="chart-header"><span>[I] 近期训练趋势</span></div>
            <div ref="chartContainerRef" class="echarts-box" />
          </div>
        </div>

        <div
          v-else-if="message.richType === 'ClinicianFeedbackCard' || message.richType === 'clinician_feedback'"
          :id="legacyRichTargetId"
          class="clinician-feedback-card consultation-rich-target tech-chamfer-panel"
          :class="{ 'is-highlighted-feedback': isFeedbackHighlighted }"
          tabindex="-1"
          data-testid="clinician-feedback-card"
        >
          <div class="feedback-card-header">
            <div class="header-left">
              <div class="seal-badge-stamp">★ 权威医嘱</div>
              <div>
                <div class="feedback-card-title">{{ feedbackTitle }}</div>
                <div class="feedback-card-meta">
                  <span>签署医生：{{ clinicianDoctorName }} 医师</span>
                  <span class="dot-divider">·</span>
                  <span>{{ formatTime(clinicianSignedAt) }}</span>
                </div>
              </div>
            </div>
            <span class="feedback-type-badge">{{ feedbackTypeLabel }}</span>
          </div>

          <div class="feedback-card-body">
            <div class="feedback-narrative markdown-body" v-html="formatText(feedbackContent)" />

            <div v-if="guidancePoints.length" class="feedback-points-section">
              <div class="section-title">动作纠偏与训练指导要点</div>
              <ul class="points-list">
                <li v-for="(point, idx) in guidancePoints" :key="idx" class="point-item">
                  <span class="point-num">{{ String(idx + 1).padStart(2, '0') }}</span>
                  <span class="point-text">{{ point }}</span>
                </li>
              </ul>
            </div>
          </div>

          <div class="feedback-card-footer">
            <div class="official-stamp-circle">
              <span class="stamp-top">口面肌康复</span>
              <span class="stamp-mid">{{ clinicianDoctorName }}</span>
              <span class="stamp-bot">实名已签</span>
            </div>
            <div class="stamp-legal-text">
              <strong>正式医嘱认证</strong>
              <span>本指导意见经执业医师实名签署确认，已同步更新至患儿随访与成长档案。</span>
            </div>
          </div>
        </div>
      </template>
    </div>
  </article>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { Reading } from '@element-plus/icons-vue'
import echarts from '@/utils/echarts-setup'
import { analyticsAPI } from '@/utils/request'
import { useConsultationContextStore } from '@/stores/consultationContext'
import ConsultationArtifact from './ConsultationArtifact.vue'
import { consultationTargetId, getArtifactAnchor, getMessageAnchor } from '@/utils/consultationTarget'
import { renderSafeMarkdown } from '@/utils/safeMarkdown'

// ── Props & Emits ──────────────────────────────────────────────────────────
const props = defineProps({
  message: { type: Object, required: true },
  isLatest: { type: Boolean, default: false },
  highlightedFeedbackId: { type: String, default: null },
})

defineEmits([
  'retry', 'retry-turn', 'resume-turn', 'cancel-turn',
  'cancel-task', 'confirm-task', 'clarify-task', 'retry-task',
])

// ── 数据血缘与医嘱身份计算属性 ───────────────────────────────────────────
const messageProvenance = computed(() => props.message.messageProvenance || props.message.provenance || {})

const isClinicianOrder = computed(() => {
  const prov = messageProvenance.value
  return (
    Boolean(prov.is_official_order)
    || prov.source_type === 'CLINICIAN_MESSAGE'
    || prov.source_type === 'CLINICAL_ORDER'
    || props.message.richType === 'ClinicianFeedbackCard'
    || props.message.richType === 'clinician_feedback'
    || Boolean(props.message.richData?.signed_doctor_name)
  )
})

const isAIResponse = computed(() => {
  if (isClinicianOrder.value) return false
  if (props.message.role === 'user' || props.message.role === 'system') return false
  const prov = messageProvenance.value
  return (
    props.message.role === 'agent'
    || props.message.role === 'ai'
    || prov.source_type === 'AI_RESPONSE'
    || !prov.source_type
  )
})

const clinicianDoctorName = computed(() => {
  const prov = messageProvenance.value
  return prov.signed_doctor_name || props.message.richData?.signed_doctor_name || '主治医生'
})

const clinicianSignedAt = computed(() => {
  const prov = messageProvenance.value
  return prov.signed_at || props.message.richData?.signed_at || props.message.timestamp
})

const feedbackTypeLabel = computed(() => {
  const prov = messageProvenance.value
  const type = prov.feedback_type || props.message.richData?.feedback_type
  const map = {
    TECHNIQUE_CORRECTION: '动作纠偏',
    ENCOURAGEMENT: '康复鼓励',
    TRAINING_GUIDANCE: '训练指导',
    ADHERENCE_SUPPORT: '生活执行依从支持',
    PHASE_SUMMARY: '阶段小结',
  }
  return map[type] || props.message.richData?.feedback_type_label || (isClinicianOrder.value ? '正式医嘱' : '')
})

const feedbackContent = computed(() => {
  return props.message.richData?.content || props.message.content || ''
})

const feedbackTitle = computed(() => {
  return props.message.richData?.title || '主治医生训练指导反馈'
})

const guidancePoints = computed(() => {
  const points = props.message.richData?.guidance_points || messageProvenance.value.guidance_points
  return Array.isArray(points) ? points : []
})

const isFeedbackHighlighted = computed(() => {
  const targetId = props.highlightedFeedbackId
  if (!targetId) return false
  const prov = messageProvenance.value
  return (
    prov.feedback_id === targetId
    || props.message.richData?.feedback_id === targetId
    || props.message.turnId === targetId
    || String(props.message.id) === targetId
  )
})

const aiModelVersion = computed(() => {
  const prov = messageProvenance.value
  return prov.model_version || '模型版本未记录'
})

const aiSourcesLabel = computed(() => {
  const prov = messageProvenance.value
  if (Array.isArray(prov.retrieval_source_ids) && prov.retrieval_source_ids.length > 0) {
    return prov.retrieval_source_ids.map(s => {
      if (s === 'clinical_standard') return '临床标准'
      if (s === 'knowledge_base_omes') return 'OMES指南'
      if (s === 'clinical_metrics') return '生理指标库'
      if (s === 'clinical_pathology') return '病理特征库'
      return s
    }).join(' + ')
  }
  return '本次检索来源未记录'
})

const aiPromptPolicy = computed(() => {
  const prov = messageProvenance.value
  return prov.prompt_policy_version || '策略版本未记录'
})

const aiDisclaimerText = computed(() => {
  const prov = messageProvenance.value
  return prov.disclaimer || '免责声明：本回复由多智能体临床专家系统辅助生成，仅供家庭康复指导参考，不具正式医嘱法律效力。'
})

const roleLabel = computed(() => {
  if (props.message.role === 'user') return '患者'
  if (props.message.role === 'system') return '系统'
  if (isClinicianOrder.value) return '主治医生'
  return '智能体'
})
const timestampIso = computed(() => {
  if (!props.message.timestamp) return undefined
  const date = new Date(props.message.timestamp)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
})
const durableStatusLabel = computed(() => ({
  queued: '本轮会诊已提交，正在等待处理',
  streaming: '本轮会诊正在后台处理',
  retrying: '本轮会诊正在恢复处理',
  retryable_paused: '会诊已暂停，可从断点继续',
  needs_input: '本轮会诊需要补充信息',
  failed: '本轮会诊未能完成',
  expired: '本轮会诊已过期',
  cancelled: '本轮会诊已取消',
  cancel_requested: '已请求取消，将在安全节点停止',
  disconnected: '连接已断开，后台任务仍会继续',
}[props.message.streamState] || ''))
const answerSections = computed(() => Array.isArray(props.message.answerSections)
  ? props.message.answerSections
  : [])
const hasAnswerSections = computed(() => answerSections.value.length > 0)
const messageAnchor = computed(() => getMessageAnchor(props.message))
const messageTargetId = computed(() => consultationTargetId(messageAnchor.value, 'message'))
const legacyRichTargetId = computed(() => consultationTargetId(messageAnchor.value, props.message.richType || 'rich'))
const consultationTasks = computed(() => Array.isArray(props.message.consultationTasks)
  ? props.message.consultationTasks
  : [])
const canCancelDurableTurn = computed(() => (
  Boolean(props.message.turnId)
  && ['queued', 'streaming', 'retrying', 'retryable_paused', 'disconnected'].includes(props.message.streamState)
))
const progressLabel = computed(() => {
  const completed = Number(props.message.taskProgress?.completed) || 0
  const total = Number(props.message.taskProgress?.total) || consultationTasks.value.length
  const prefix = ({
    COMPLETED: '已完成',
    PARTIAL: '部分完成',
    NEEDS_INPUT: '待补充',
    CANCELLED: '已取消',
    FAILED: '未完成',
  })[props.message.consultationResultStatus] || '处理中'
  return total ? `${prefix} ${completed}/${total}` : prefix
})

// ── 工具函数 ──────────────────────────────────────────────────────────────
function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function formatText(text) {
  return renderSafeMarkdown(text)
}

function historyFieldLabel(key) {
  return ({
    record_count: '记录数',
    scored_count: '已评分',
    latest_score: '最近得分',
    action_type: '训练动作',
    training_time: '训练时间',
  })[key] || key
}

function taskStatusLabel(status) {
  return ({
    PENDING: '等待处理',
    RUNNING: '处理中',
    WAITING_CONFIRMATION: '等待确认',
    SUCCEEDED: '已完成',
    NEEDS_INPUT: '需要补充信息',
    FAILED: '未能完成',
    CANCELLED: '已取消',
    BLOCKED_BY_DEPENDENCY: '等待前置任务',
    BLOCKED_BY_CANCELLED_DEPENDENCY: '前置任务已取消',
  })[status] || '状态更新中'
}

function canCancelTask(status) {
  return ['PENDING', 'RUNNING', 'WAITING_CONFIRMATION'].includes(status)
}

function isWaitingConfirmation(status) {
  return status === 'WAITING_CONFIRMATION'
}

function canRetryTask(status) {
  return ['FAILED', 'CANCELLED'].includes(status)
}

function isTaskActionPending(taskId) {
  return Boolean(props.message.taskActionPending?.[taskId])
}

function isTaskCancelRequested(taskId) {
  return Boolean(props.message.taskCancelRequested?.[taskId])
}

function artifactKey(artifact) {
  return JSON.stringify(artifact)
}

function artifactTargetId(artifact, index) {
  return consultationTargetId(messageAnchor.value, getArtifactAnchor(artifact, `${artifact?.action_type || 'artifact'}-${index}`))
}

// ── ECharts 进度图表（带生命周期管理）──────────────────────────────────────
const chartContainerRef = ref(null)
/** @type {echarts.EChartsInstance|null} */
let chartInstance = null
let themeObserver = null

function readChartPalette() {
  const styles = typeof window === 'undefined' || !chartContainerRef.value
    ? null
    : window.getComputedStyle(chartContainerRef.value)
  const token = (name, fallback) => styles?.getPropertyValue(name).trim() || fallback
  return {
    primary: token('--consult-primary', '#C8F43D'),
    data: token('--consult-data', '#8FA8DF'),
    surface: token('--consult-surface-raised', '#222824'),
    text: token('--consult-text', '#F1F4EE'),
    muted: token('--consult-text-muted', '#A7B0A7'),
    line: token('--consult-line', 'rgba(241, 244, 238, 0.12)'),
    lineStrong: token('--consult-line-strong', 'rgba(241, 244, 238, 0.24)'),
  }
}

function withAlpha(color, alpha) {
  const hex = color.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i)
  if (!hex) return color
  const [, red, green, blue] = hex
  return `rgba(${Number.parseInt(red, 16)}, ${Number.parseInt(green, 16)}, ${Number.parseInt(blue, 16)}, ${alpha})`
}

function observeThemeChanges() {
  if (
    themeObserver
    || typeof MutationObserver !== 'function'
    || typeof document === 'undefined'
  ) return
  themeObserver = new MutationObserver(() => nextTick(() => renderChart()))
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
}

function getOrCreateChart() {
  if (!chartContainerRef.value) return null
  if (chartInstance && !chartInstance.isDisposed()) return chartInstance
  chartInstance = echarts.init(chartContainerRef.value)
  return chartInstance
}

function disposeChart() {
  if (chartInstance && !chartInstance.isDisposed()) {
    chartInstance.dispose()
  }
  chartInstance = null
}

async function renderChart() {
  if (props.message.richType !== 'progress' || !chartContainerRef.value) return
  if (!props.message.richData?.show_chart && !props.message.richData?.chartData) return

  const myChart = getOrCreateChart()
  if (!myChart) return

  observeThemeChanges()
  const palette = readChartPalette()
  myChart.showLoading()

  try {
    let xData = []
    let seriesData = []

    if (props.message.richData?.chartData?.seriesList) {
      xData = props.message.richData.chartData.xAxis
      const sList = props.message.richData.chartData.seriesList

      seriesData = sList.map(s => {
        if (s.isMain || s.name === '总体得分') {
          return {
            name: '总体得分',
            type: 'line',
            smooth: true,
            symbolSize: 6,
            data: s.data,
            itemStyle: { color: palette.primary },
            lineStyle: { width: 4, color: palette.primary },
            zlevel: 10,
            areaStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: withAlpha(palette.primary, 0.24) },
                { offset: 1, color: withAlpha(palette.primary, 0.02) }
              ])
            }
          }
        } else {
          return {
            name: s.name,
            type: 'line',
            smooth: true,
            symbolSize: 4,
            data: s.data,
            itemStyle: { color: palette.data },
            lineStyle: { width: 2, type: 'dashed', color: palette.data }
          }
        }
      })
    } else {
      // 兜底：前端自行拉取患者大盘数据
      const patientId = useConsultationContextStore().patientId
      if (!patientId) return

      const res = await analyticsAPI.getDashboardData(patientId, '1m', '')
      const trend = res.data?.trendData || res.trendData

      if (trend) {
        xData = trend.categories
        seriesData = [{
          name: '成功率得分',
          type: 'line',
          smooth: true,
          data: trend.successRate,
          itemStyle: { color: palette.primary },
          lineStyle: { width: 4, color: palette.primary },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: withAlpha(palette.primary, 0.24) },
              { offset: 1, color: withAlpha(palette.primary, 0.02) }
            ])
          }
        }]
      }
    }

    const option = {
      tooltip: {
        trigger: 'axis',
        backgroundColor: palette.surface,
        borderColor: palette.lineStrong,
        textStyle: { color: palette.text },
      },
      legend: {
        type: 'scroll',
        bottom: 0,
        textStyle: { fontSize: 11, color: palette.muted },
        padding: [5, 10]
      },
      grid: { left: '3%', right: '4%', bottom: '15%', top: '10%', containLabel: true },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: xData,
        axisLine: { lineStyle: { color: palette.lineStrong } },
        axisLabel: { color: palette.muted, fontSize: 10 }
      },
      yAxis: {
        type: 'value',
        max: 100,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: palette.muted, fontSize: 10 },
        splitLine: { lineStyle: { type: 'dashed', color: palette.line } },
      },
      series: seriesData
    }
    myChart.hideLoading()
    myChart.setOption(option)
  } catch (error) {
    console.error('动态拉取图表失败', error)
    myChart.hideLoading()
  }
}

onMounted(() => {
  nextTick(() => { renderChart() })
})

watch(() => props.message, () => {
  nextTick(() => renderChart())
}, { deep: true })

// ✅ 修复 ECharts 内存泄漏：组件卸载时释放图表实例
onUnmounted(() => {
  themeObserver?.disconnect()
  themeObserver = null
  disposeChart()
})

// ── 暴露方法给父组件（通过 template ref） ──────────────────────────────────
defineExpose({})
</script>
<style scoped>
.message-record.is-navigation-target,
.consultation-rich-target.is-navigation-target {
  animation: message-target-pulse 1.5s ease-out;
}

@keyframes message-target-pulse {
  0%, 35% { outline: 3px solid rgb(240 100 46 / 28%); outline-offset: 3px; }
  100% { outline-color: transparent; outline-offset: 8px; }
}
.chat-message {
  position: relative;
  width: 100%;
  margin: 0;
  padding: 18px 0 24px;
  display: grid;
  grid-template-columns: minmax(96px, 1.2fr) minmax(0, 5.8fr);
  gap: 12px 24px;
  color: var(--lab-ink, var(--consult-text, var(--cq-text, #171918)));
  background: transparent;
  content-visibility: auto;
  contain-intrinsic-size: auto 112px;
}

.message-record__rule {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 1px;
  background: var(--lab-line-strong, var(--consult-line-strong, rgb(23 25 24 / 42%)));
}

.message-record.is-latest .message-record__rule {
  background: linear-gradient(
    90deg,
    var(--lab-orange, var(--consult-primary, #F0642E)) 0 42px,
    var(--lab-line-strong, var(--consult-line-strong, rgb(23 25 24 / 42%))) 42px 100%
  );
}

.msg-text,
.diagnosis-content,
.suggestion-item,
.step-detail {
  overflow-wrap: anywhere;
}

.message-record__meta {
  min-width: 0;
  display: grid;
  align-content: start;
  justify-items: start;
  gap: 3px;
}

.message-record__role,
.agent-label,
.msg-time {
  font: 500 10px/14px var(--font-chat-data, var(--font-data, monospace));
  letter-spacing: .035em;
}

.message-record__role {
  color: var(--lab-ink, var(--consult-text, #171918));
  font-weight: 600;
}

.agent-label,
.msg-time {
  color: var(--lab-muted, var(--consult-text-quiet, var(--cq-text-quiet, #696D69))) !important;
}

.message-record__body {
  min-width: 0;
}

.message-record__copy {
  margin: 0;
  color: var(--lab-ink, var(--consult-text, var(--cq-text, #171918)));
  font-size: 15px;
  line-height: 25px;
}

:deep(.markdown-body h1),
:deep(.markdown-body h2),
:deep(.markdown-body h3),
:deep(.markdown-body h4),
:deep(.markdown-body h5),
:deep(.markdown-body h6) {
  margin: 22px 0 9px;
  color: inherit;
  font-family: var(--font-chat, sans-serif);
  font-weight: 650;
  line-height: 1.35;
}

:deep(.markdown-body h1:first-child),
:deep(.markdown-body h2:first-child),
:deep(.markdown-body h3:first-child),
:deep(.markdown-body h4:first-child),
:deep(.markdown-body h5:first-child),
:deep(.markdown-body h6:first-child) {
  margin-top: 0;
}

:deep(.markdown-body h1) { font-size: 22px; }
:deep(.markdown-body h2) { font-size: 20px; }
:deep(.markdown-body h3) { font-size: 18px; }
:deep(.markdown-body h4) { font-size: 16px; }
:deep(.markdown-body h5),
:deep(.markdown-body h6) { font-size: 15px; }

:deep(.markdown-body .markdown-table-scroll) {
  width: 100%;
  margin: 12px 0;
  overflow-x: auto;
  border: 1px solid var(--lab-line-strong, var(--consult-line-strong, rgb(23 25 24 / 42%)));
}

:deep(.markdown-body table) {
  width: 100%;
  min-width: max-content;
  border-collapse: collapse;
  font-size: 13px;
  line-height: 20px;
}

:deep(.markdown-body th),
:deep(.markdown-body td) {
  padding: 8px 10px;
  border-right: 1px solid var(--lab-line, var(--consult-line, rgb(23 25 24 / 20%)));
  border-bottom: 1px solid var(--lab-line, var(--consult-line, rgb(23 25 24 / 20%)));
  vertical-align: top;
  white-space: nowrap;
}

:deep(.markdown-body th:last-child),
:deep(.markdown-body td:last-child) {
  border-right: 0;
}

:deep(.markdown-body tbody tr:last-child td) {
  border-bottom: 0;
}

:deep(.markdown-body th) {
  background: color-mix(in srgb, var(--lab-ink, #171918) 6%, transparent);
  font-weight: 650;
}

:deep(.markdown-body .markdown-align-center) { text-align: center; }
:deep(.markdown-body .markdown-align-right) { text-align: right; }

.stream-aborted {
  min-height: 34px;
  margin-top: 12px;
  padding-top: 9px;
  border-top: 1px solid var(--lab-line-strong, var(--consult-line-strong, rgb(23 25 24 / 42%)));
  color: var(--lab-muted, var(--consult-text-muted, #696D69));
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  font: 500 11px/16px var(--font-chat-data, var(--font-data, monospace));
}

.stream-aborted span::before {
  content: '[!] ';
  color: var(--lab-orange, #F0642E);
}

.stream-aborted button {
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid var(--lab-ink, var(--consult-text, #171918));
  border-radius: 0;
  background: transparent;
  color: var(--lab-ink, var(--consult-text, #171918));
  cursor: pointer;
  transition: color 120ms ease-out, transform 120ms ease-out;
}

.stream-aborted button:focus-visible {
  outline: 2px solid var(--lab-orange, #F0642E);
  outline-offset: 2px;
}

.stream-aborted button:active {
  transform: scale(.98);
}

.stream-aborted button:disabled {
  opacity: .52;
  cursor: wait;
  transform: none;
}

.history-facts,
.history-records {
  display: grid;
  gap: 8px;
}

.history-fact,
.history-record {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--consult-line, rgb(241 244 238 / 12%));
}

.history-fact:last-child,
.history-record:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.history-record {
  flex-wrap: wrap;
}

.consultation-result {
  display: grid;
  gap: 16px;
}

.consultation-task-plan {
  border-block: 1px solid var(--lab-line-strong, rgb(23 25 24 / 44%));
}

.consultation-task-plan summary {
  min-height: 42px;
  padding: 8px 0;
  color: var(--lab-ink, #171918);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  cursor: pointer;
  font: 500 11px/16px var(--font-chat-data, monospace);
}

.consultation-task-plan summary:focus-visible {
  outline: 2px solid var(--lab-orange, #F0642E);
  outline-offset: 2px;
}

.consultation-task-plan summary strong {
  color: var(--lab-orange, #F0642E);
}

.consultation-task-list {
  margin: 0;
  padding: 0 0 8px;
  list-style: none;
}

.consultation-task-list li {
  min-height: 52px;
  padding: 8px 0;
  border-top: 1px solid var(--lab-line, rgb(23 25 24 / 20%));
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
}

.consultation-task-list__ordinal {
  color: var(--lab-orange, #F0642E);
  font: 500 10px/14px var(--font-chat-data, monospace);
}

.consultation-task-list li > div {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.consultation-task-list li > div strong {
  overflow: hidden;
  color: var(--lab-ink, #171918);
  font: 600 12px/18px var(--font-chat, sans-serif);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.consultation-task-list li > div small {
  color: var(--lab-muted, #696D69);
  font: 400 10px/15px var(--font-chat-data, monospace);
}

.consultation-task-list__actions button {
  min-height: 30px;
  padding: 0 9px;
  border: 1px solid var(--lab-ink, #171918);
  border-radius: 0;
  background: transparent;
  color: var(--lab-ink, #171918);
  font: 500 10px/14px var(--font-chat-data, monospace);
  cursor: pointer;
}

.consultation-task-list__actions button:focus-visible {
  outline: 2px solid var(--lab-orange, #F0642E);
  outline-offset: 2px;
}

.consultation-task-list__actions button:disabled {
  opacity: .52;
  cursor: wait;
}

.answer-section {
  padding-top: 14px;
  border-top: 1px solid var(--lab-line-strong, rgb(23 25 24 / 44%));
}

.answer-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  color: var(--lab-muted, #696D69);
  font: 500 10px/15px var(--font-chat-data, monospace);
  letter-spacing: .03em;
}

.answer-section__header span {
  color: var(--lab-orange, #F0642E);
}

.answer-section h3 {
  margin: 7px 0 0;
  color: var(--lab-ink, #171918);
  font: 650 15px/23px var(--font-chat, sans-serif);
}

.answer-section__narrative {
  margin-top: 9px;
  color: var(--lab-ink, #171918);
  font: 400 14px/24px var(--font-chat, sans-serif);
}

.answer-section__safety {
  margin-top: 12px;
  padding: 9px 11px;
  border-left: 3px solid var(--lab-orange, #F0642E);
  background: color-mix(in srgb, var(--lab-orange, #F0642E) 7%, transparent);
  display: grid;
  gap: 3px;
}

.answer-section__safety strong {
  font: 600 11px/16px var(--font-chat-data, monospace);
}

.answer-section__safety span {
  color: var(--lab-muted, #696D69);
  font: 400 12px/19px var(--font-chat, sans-serif);
}

@media (max-width: 560px) {
  .consultation-task-list li {
    grid-template-columns: 24px minmax(0, 1fr);
  }

  .consultation-task-list__actions {
    grid-column: 2;
  }
}

.history-facts,
.history-records {
  display: grid;
  gap: 8px;
}

.history-fact,
.history-record {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--consult-line, rgb(241 244 238 / 12%));
}

.history-fact:last-child,
.history-record:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.history-record {
  flex-wrap: wrap;
}

.message-record__copy + .diagnosis-card,
.message-record__copy + .steps-card-msg,
.message-record__copy + .progress-msg,
.diagnosis-accordion + .message-record__copy,
.status-feed + .message-record__copy {
  margin-top: 12px;
}

.agent-name-bar {
  margin: 0;
}

.diagnosis-accordion,
.diagnosis-card,
.steps-card-msg,
.inline-chart-container {
  width: 100%;
  max-width: 540px;
  overflow: hidden;
  border: 1px solid var(--consult-line, var(--cq-rule, rgb(241 244 238 / 12%)));
  border-radius: 8px;
  background: var(--consult-surface, var(--cq-surface, #121613));
  color: var(--consult-text, var(--cq-text, #F1F4EE));
  box-shadow: none;
}

.has-rich-content .diagnosis-card,
.has-rich-content .steps-card-msg,
.has-rich-content .inline-chart-container {
  max-width: 100%;
}

.diagnosis-accordion {
  padding: 0;
}

.diagnosis-accordion summary {
  min-height: 44px;
  padding: 11px 14px;
  display: flex;
  align-items: center;
  cursor: pointer;
  user-select: none;
}

.diagnosis-content {
  padding: 0 14px 14px;
}

.diagnosis-accordion summary,
.diagnosis-content,
.section-label,
.score-label,
.suggestion-item,
.step-title,
.step-desc,
.chart-header,
.gate-message,
.gate-action-line {
  color: var(--consult-text, var(--cq-text, #F1F4EE));
}

:deep(details[open] summary) {
  margin-bottom: 12px;
  padding-bottom: 11px;
  border-bottom: 1px solid var(--consult-line, var(--cq-rule, rgb(241 244 238 / 12%)));
  color: var(--consult-primary, var(--cq-signal, #C8F43D));
}

.status-feed {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-bottom: 10px;
}

.status-item {
  position: relative;
  padding: 3px 0 3px 14px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--consult-text-muted, var(--cq-text-muted, #A7B0A7));
  font: 500 11px/16px var(--font-chat-data, var(--font-data, monospace));
  animation: none;
}

.status-item::before {
  content: '';
  position: absolute;
  top: 9px;
  left: 1px;
  width: 6px;
  height: 1px;
  background: var(--consult-secondary, #65C6C1);
}

.card-header,
.steps-header,
.gate-header {
  min-height: 48px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--consult-line, var(--cq-rule, rgb(241 244 238 / 12%)));
  background: var(--consult-surface-subtle, var(--cq-surface-strong, #181D1A)) !important;
  color: var(--consult-text, var(--cq-text, #F1F4EE));
  display: flex;
  align-items: center;
  gap: 10px;
}

.card-icon {
  font: 600 11px/1 var(--font-chat-data, var(--font-data, monospace));
  color: var(--consult-secondary, #65C6C1);
}

.card-title {
  font-size: 15px;
  font-weight: 600;
}

.card-meta {
  color: var(--consult-text-quiet, var(--cq-text-quiet, #788179));
  font-family: var(--font-chat-data, var(--font-data, monospace));
}

.card-body,
.steps-card-msg,
.inline-chart-container {
  background: var(--consult-surface, var(--cq-surface, #121613));
}

.card-body {
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.scores-section,
.suggestions-section {
  padding: 16px;
}

.suggestions-section:not(:first-child) {
  border-top: 1px solid var(--consult-line, var(--cq-rule, rgb(241 244 238 / 12%)));
}

.section-label {
  margin-bottom: 12px;
  color: var(--consult-text-muted, var(--cq-text-muted, #A7B0A7));
  font: 600 11px/16px var(--font-chat-data, var(--font-data, monospace));
  letter-spacing: 0;
  text-transform: none;
}

.score-item {
  padding: 4px 0;
}

.scores-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.score-head {
  margin-bottom: 5px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.score-label,
.step-title {
  color: var(--consult-text, var(--cq-text, #F1F4EE));
}

.score-status {
  padding: 0;
  border-radius: 0;
  background: transparent !important;
  color: var(--consult-text-muted, var(--cq-text-muted, #A7B0A7)) !important;
  font-size: 11px;
}

.score-val {
  color: var(--consult-primary, var(--cq-signal, #C8F43D)) !important;
  display: block;
  text-align: right;
  font-size: 12px;
  font-weight: 600;
}

:deep(.el-progress-bar__outer) {
  background: var(--consult-surface-raised, var(--cq-surface-raised, #222824));
}

:deep(.el-progress-bar__inner) {
  background: var(--consult-primary, var(--cq-signal, #C8F43D)) !important;
}

.suggestion-item {
  padding: 9px 0;
  border-bottom: 1px solid var(--consult-line, var(--cq-rule, rgb(241 244 238 / 12%)));
  color: var(--consult-text, var(--cq-text, #F1F4EE));
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  line-height: 20px;
}

.suggestion-item:last-child {
  border-bottom: 0;
}

.sug-num,
.step-num-badge {
  border-radius: 4px;
  background: var(--consult-primary, var(--cq-signal, #C8F43D)) !important;
  color: var(--consult-primary-ink, #142006);
  display: grid;
  place-items: center;
  font-family: var(--font-chat-data, var(--font-data, monospace));
}

.sug-num {
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  font-size: 11px;
}

.step-num-badge {
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  font-size: 11px;
}

.steps-list {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.step-row {
  padding: 12px 0;
  border-bottom: 1px solid var(--consult-line, var(--cq-rule, rgb(241 244 238 / 12%)));
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.step-row:first-child {
  padding-top: 0;
}

.step-row:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.step-desc {
  color: var(--consult-text-muted, var(--cq-text-muted, #A7B0A7));
  margin-top: 3px;
  font-size: 12px;
  line-height: 18px;
}

.knowledge-source,
.inline-chart-hint {
  margin: 0;
  padding: 10px 16px;
  border-top: 1px solid var(--consult-line, var(--cq-rule, rgb(241 244 238 / 12%)));
  border-radius: 0;
  background: transparent;
  color: var(--consult-text-muted, var(--cq-text-muted, #A7B0A7));
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  line-height: 16px;
}

.progress-msg {
  display: flex;
  flex-direction: column;
}

.inline-chart-container {
  padding: 0;
}

.chart-header {
  min-height: 44px;
  margin: 0;
  padding: 12px 16px;
  border-bottom: 1px solid var(--consult-line, var(--cq-rule, rgb(241 244 238 / 12%)));
  color: var(--consult-text, var(--cq-text, #F1F4EE));
  font-size: 13px;
  line-height: 20px;
  font-weight: 600;
}

.echarts-box {
  width: 100%;
  height: 280px;
  padding: 8px;
}

.gate-decision.ok {
  border: 0;
  border-top: 1px solid var(--consult-line, var(--cq-rule, rgb(241 244 238 / 12%)));
  border-radius: 0;
  background: transparent;
  color: var(--consult-primary, var(--cq-signal, #C8F43D));
}

.gate-decision.later {
  border: 0;
  border-top: 1px solid var(--consult-line, var(--cq-rule, rgb(241 244 238 / 12%)));
  border-radius: 0;
  background: transparent;
  color: var(--consult-warning, var(--cq-warning, #E2B65B));
}

.system-notice-bar {
  max-width: min(680px, 100%);
  padding: 8px 12px;
  border: 1px solid var(--consult-line, var(--cq-rule, rgb(241 244 238 / 12%)));
  border-left: 2px solid var(--consult-warning, var(--cq-warning, #E2B65B));
  border-radius: 6px;
  background: transparent;
  color: var(--consult-text-muted, var(--cq-text-muted, #A7B0A7));
  box-shadow: none;
  animation: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  line-height: 18px;
}

.system-notice-msg {
  justify-content: center;
  padding-block: 4px;
}

.system-notice-icon {
  flex: 0 0 auto;
  color: var(--consult-warning, var(--cq-warning, #E2B65B));
}

@media (max-width: 600px) {
  .user-bubble {
    max-width: 82%;
  }

  .agent-bubble .msg-text,
  .user-bubble .msg-text {
    font-size: 15px;
  }

  .agent-content {
    max-width: calc(100% - 44px);
  }

  .diagnosis-accordion,
  .diagnosis-card,
  .steps-card-msg,
  .inline-chart-container {
    max-width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .chat-message,
  .user-bubble,
  .agent-content,
  .status-item,
  .system-notice-bar {
    animation: none;
  }
}

/* ── Issue 10: 医生实名签署医嘱印章徽章与 AI 数据血缘样式 ── */
.clinician-seal-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(14, 165, 233, 0.12);
  border: 1px solid rgba(14, 165, 233, 0.35);
  color: #0284C7;
  font-family: var(--font-utility, monospace);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.dark .clinician-seal-badge {
  background: rgba(56, 189, 248, 0.15);
  border-color: rgba(56, 189, 248, 0.45);
  color: #38BDF8;
}

.seal-icon {
  color: #0284C7;
  font-size: 10px;
}

.dark .seal-icon {
  color: #38BDF8;
}

.feedback-type-pill {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 3px;
  background: rgba(16, 185, 129, 0.10);
  border: 1px solid rgba(16, 185, 129, 0.28);
  color: #059669;
  font-size: 11px;
  font-weight: 500;
}

.dark .feedback-type-pill {
  background: rgba(52, 211, 153, 0.12);
  border-color: rgba(52, 211, 153, 0.35);
  color: #34D399;
}

/* AI 数据血缘与免责声明栏 */
.ai-provenance-footer {
  margin-top: 10px;
  padding: 8px 12px;
  border-radius: 6px;
  background: rgba(245, 247, 246, 0.7);
  border: 1px solid rgba(220, 225, 222, 0.6);
  font-size: 11px;
  line-height: 1.5;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dark .ai-provenance-footer {
  background: rgba(26, 32, 28, 0.6);
  border-color: rgba(255, 255, 255, 0.08);
}

.provenance-pills {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.prov-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.04);
  color: var(--text-secondary, #64748B);
  font-family: var(--font-utility, monospace);
  font-size: 10px;
}

.dark .prov-pill {
  background: rgba(255, 255, 255, 0.06);
  color: #94A3B8;
}

.pill-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #10B981;
}

.provenance-disclaimer {
  display: flex;
  align-items: flex-start;
  gap: 5px;
  color: var(--text-muted, #94A3B8);
  font-size: 11px;
}

.disclaimer-icon {
  flex-shrink: 0;
  font-size: 12px;
}

/* 医生普通文本医嘱签章栏 */
.clinician-order-seal-footer {
  margin-top: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  background: rgba(14, 165, 233, 0.06);
  border: 1px dashed rgba(14, 165, 233, 0.3);
}

.seal-badge-container {
  display: flex;
  align-items: center;
  gap: 10px;
}

.seal-stamp-circle {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 2px solid #0284C7;
  color: #0284C7;
  display: grid;
  place-items: center;
  font-size: 9px;
  font-weight: 700;
  line-height: 1.1;
  text-align: center;
  transform: rotate(-8deg);
  background: rgba(2, 132, 199, 0.05);
}

.dark .seal-stamp-circle {
  border-color: #38BDF8;
  color: #38BDF8;
  background: rgba(56, 189, 248, 0.08);
}

.seal-details {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.seal-doctor-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary, #0F172A);
}

.seal-time-auth {
  font-size: 11px;
  color: var(--text-secondary, #64748B);
}

/* 医生指导反馈富卡片 */
.clinician-feedback-card {
  margin-top: 8px;
  padding: 16px;
  border-radius: 8px;
  background: var(--surface-primary, #FFFFFF);
  border: 1px solid rgba(14, 165, 233, 0.25);
  box-shadow: 0 4px 16px rgba(14, 165, 233, 0.06);
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: border-color 200ms ease, box-shadow 200ms ease;
}

.dark .clinician-feedback-card {
  background: rgba(20, 27, 23, 0.85);
  border-color: rgba(56, 189, 248, 0.25);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}

.clinician-feedback-card.is-highlighted-feedback {
  border-color: #0284C7;
  box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.25), 0 6px 20px rgba(14, 165, 233, 0.15);
  animation: feedback-glow 2s infinite alternate ease-in-out;
}

@keyframes feedback-glow {
  0% { box-shadow: 0 0 0 2px rgba(14, 165, 233, 0.2), 0 4px 12px rgba(14, 165, 233, 0.1); }
  100% { box-shadow: 0 0 0 4px rgba(14, 165, 233, 0.4), 0 8px 24px rgba(14, 165, 233, 0.25); }
}

.feedback-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.dark .feedback-card-header {
  border-bottom-color: rgba(255, 255, 255, 0.08);
}

.feedback-card-header .header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.seal-badge-stamp {
  padding: 2px 6px;
  border-radius: 4px;
  background: #0284C7;
  color: #FFFFFF;
  font-size: 11px;
  font-weight: 600;
}

.feedback-card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #0F172A);
}

.feedback-card-meta {
  font-size: 11px;
  color: var(--text-secondary, #64748B);
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
}

.feedback-type-badge {
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.3);
  color: #059669;
  font-size: 11px;
  font-weight: 600;
}

.dark .feedback-type-badge {
  background: rgba(52, 211, 153, 0.15);
  border-color: rgba(52, 211, 153, 0.4);
  color: #34D399;
}

.feedback-card-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.feedback-narrative {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-primary, #1E293B);
}

.feedback-points-section {
  padding: 10px 12px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.02);
  border: 1px solid rgba(0, 0, 0, 0.05);
}

.dark .feedback-points-section {
  background: rgba(255, 255, 255, 0.03);
  border-color: rgba(255, 255, 255, 0.06);
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary, #0F172A);
  margin-bottom: 6px;
}

.points-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.point-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary, #334155);
}

.point-num {
  font-family: var(--font-utility, monospace);
  font-size: 10px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(14, 165, 233, 0.12);
  color: #0284C7;
}

.dark .point-num {
  background: rgba(56, 189, 248, 0.15);
  color: #38BDF8;
}

.feedback-card-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-top: 10px;
  border-top: 1px dashed rgba(0, 0, 0, 0.08);
}

.dark .feedback-card-footer {
  border-top-color: rgba(255, 255, 255, 0.08);
}

.official-stamp-circle {
  flex-shrink: 0;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: 2px solid #DC2626;
  color: #DC2626;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-size: 8px;
  font-weight: 700;
  line-height: 1.1;
  text-align: center;
  transform: rotate(-6deg);
  background: rgba(220, 38, 38, 0.04);
}

.stamp-top {
  font-size: 7px;
}

.stamp-mid {
  font-size: 9px;
  font-weight: 800;
}

.stamp-bot {
  font-size: 7px;
  letter-spacing: 0.5px;
}

.stamp-legal-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
}

.stamp-legal-text strong {
  color: #DC2626;
  font-size: 11px;
}

.stamp-legal-text span {
  color: var(--text-muted, #64748B);
  font-size: 11px;
}
</style>

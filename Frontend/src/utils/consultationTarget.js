function targetPart(value, fallback) {
  const text = String(value ?? '').trim()
  return text || fallback
}

export function getMessageAnchor(message, fallback = 'message') {
  return targetPart(
    message?.messageAnchor || message?.turnId || message?.id,
    fallback,
  )
}

export function getArtifactAnchor(artifact, fallback = 'artifact') {
  const explicitId = artifact?.artifact_id || artifact?.artifactId || artifact?.id
  if (explicitId) return targetPart(explicitId, fallback)
  return [artifact?.section_id, artifact?.action_type, fallback]
    .map(part => String(part ?? '').trim())
    .filter(Boolean)
    .join(':') || fallback
}

export function consultationTargetId(messageAnchor, artifactAnchor) {
  return `consultation-target-${encodeURIComponent(targetPart(messageAnchor, 'message'))}-${encodeURIComponent(targetPart(artifactAnchor, 'artifact'))}`
}

export function richContentLabel(type) {
  return ({
    ProgressChart: '进度图',
    StepsCard: '步骤卡',
    HistorySummaryCard: '训练摘要',
    HistoryListCard: '训练记录',
    progress: '进度图',
    steps: '步骤卡',
    history_summary: '训练摘要',
    history_list: '训练记录',
    card: '评估卡',
  })[type] || '结果内容'
}

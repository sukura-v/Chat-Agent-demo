import {
  CANONICAL_FACE_METADATA,
  CANONICAL_FACE_TRIANGLES,
  CANONICAL_FACE_VERTICES,
} from '@/assets/nano/canonicalFaceMesh.generated'

const GOLDEN_RATIO_CONJUGATE = 0.6180339887498949
const FACE_POINT_LIMIT = 48_000

export const MODE_VALUES = Object.freeze({
  dashboard: 0,
  consultation: 1,
  analytics: 2,
})

export const NANO_QUALITY_PROFILES = Object.freeze({
  high: Object.freeze({
    name: 'high',
    count: 48_000,
    dpr: 1.5,
    minFps: 45,
  }),
  medium: Object.freeze({
    name: 'medium',
    count: 24_000,
    dpr: 1.25,
    minFps: 34,
  }),
  low: Object.freeze({
    name: 'low',
    count: 12_000,
    dpr: 1,
    minFps: 26,
  }),
})

const QUALITY_ORDER = Object.freeze(['high', 'medium', 'low'])
const pointDataCache = new Map()
let canonicalSamplingTable = null

export const NANO_FACE_SOURCE = CANONICAL_FACE_METADATA

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function fract(value) {
  return value - Math.floor(value)
}

function radicalInverseBase2(value) {
  let bits = value >>> 0
  bits = ((bits << 16) | (bits >>> 16)) >>> 0
  bits = (((bits & 0x55555555) << 1) | ((bits & 0xaaaaaaaa) >>> 1)) >>> 0
  bits = (((bits & 0x33333333) << 2) | ((bits & 0xcccccccc) >>> 2)) >>> 0
  bits = (((bits & 0x0f0f0f0f) << 4) | ((bits & 0xf0f0f0f0) >>> 4)) >>> 0
  bits = (((bits & 0x00ff00ff) << 8) | ((bits & 0xff00ff00) >>> 8)) >>> 0
  return bits * 2.3283064365386963e-10
}

function getCanonicalSamplingTable() {
  if (canonicalSamplingTable) return canonicalSamplingTable

  const cumulative = new Float64Array(CANONICAL_FACE_TRIANGLES.length / 3)
  let totalArea = 0
  for (let triangleIndex = 0; triangleIndex < CANONICAL_FACE_TRIANGLES.length; triangleIndex += 3) {
    const a = CANONICAL_FACE_TRIANGLES[triangleIndex] * 3
    const b = CANONICAL_FACE_TRIANGLES[triangleIndex + 1] * 3
    const c = CANONICAL_FACE_TRIANGLES[triangleIndex + 2] * 3
    const abx = CANONICAL_FACE_VERTICES[b] - CANONICAL_FACE_VERTICES[a]
    const aby = CANONICAL_FACE_VERTICES[b + 1] - CANONICAL_FACE_VERTICES[a + 1]
    const abz = CANONICAL_FACE_VERTICES[b + 2] - CANONICAL_FACE_VERTICES[a + 2]
    const acx = CANONICAL_FACE_VERTICES[c] - CANONICAL_FACE_VERTICES[a]
    const acy = CANONICAL_FACE_VERTICES[c + 1] - CANONICAL_FACE_VERTICES[a + 1]
    const acz = CANONICAL_FACE_VERTICES[c + 2] - CANONICAL_FACE_VERTICES[a + 2]
    const crossX = aby * acz - abz * acy
    const crossY = abz * acx - abx * acz
    const crossZ = abx * acy - aby * acx
    totalArea += Math.hypot(crossX, crossY, crossZ) * 0.5
    cumulative[triangleIndex / 3] = totalArea
  }

  canonicalSamplingTable = { cumulative, totalArea }
  return canonicalSamplingTable
}

function findCanonicalTriangle(areaTarget) {
  const { cumulative } = getCanonicalSamplingTable()
  let low = 0
  let high = cumulative.length - 1
  while (low < high) {
    const middle = (low + high) >>> 1
    if (cumulative[middle] < areaTarget) low = middle + 1
    else high = middle
  }
  return low
}

function buildFacePoint(index) {
  // 纯抽象科研仪器终端粒子波导分布（完全去除任何人脸/五官网格特征）
  const angle = fract(0.5 + index * GOLDEN_RATIO_CONJUGATE) * Math.PI * 2
  const r = Math.sqrt(radicalInverseBase2(index + 1)) * 1.35
  const jitter = fract((index + 1) * 0.7548776662466927) - 0.5
  const x = Math.cos(angle) * r
  const y = Math.sin(angle) * r * 0.72 + jitter * 0.015
  const z = Math.sin(r * 4.0 + angle * 2.0) * 0.04 - 0.08
  return [x, y, z]
}

function buildLatticePoint(index) {
  const u = fract(0.5 + index * GOLDEN_RATIO_CONJUGATE)
  const v = radicalInverseBase2(index + 1)
  const rowCount = 44
  const row = Math.min(rowCount - 1, Math.floor(v * rowCount))
  const rowProgress = row / (rowCount - 1)
  const jitter = fract(index * 0.5698402909980532) - 0.5
  const x = (u * 2 - 1) * 2.08
  const y = (rowProgress * 2 - 1) * 0.86 + jitter * 0.009
  const z = Math.sin(u * Math.PI * 8 + row * 0.31) * 0.022
  return [x, y, z - 0.12]
}

/**
 * Area-samples MediaPipe's anonymous canonical face mesh into a deterministic
 * point order. Lower LODs are stable prefixes of the 48k source artifact.
 */
export function createNanoPointData(maxPoints = FACE_POINT_LIMIT) {
  const count = clamp(Math.floor(Number(maxPoints) || FACE_POINT_LIMIT), 1, FACE_POINT_LIMIT)
  if (pointDataCache.has(count)) return pointDataCache.get(count)

  const facePositions = new Float32Array(count * 3)
  const latticePositions = new Float32Array(count * 3)
  const seeds = new Float32Array(count)
  const flow = new Float32Array(count)

  for (let index = 0; index < count; index += 1) {
    const offset = index * 3
    const face = buildFacePoint(index)
    const lattice = buildLatticePoint(index)
    facePositions[offset] = face[0]
    facePositions[offset + 1] = face[1]
    facePositions[offset + 2] = face[2]
    latticePositions[offset] = lattice[0]
    latticePositions[offset + 1] = lattice[1]
    latticePositions[offset + 2] = lattice[2]

    const seed = fract((index + 1) * 0.103149737)
    seeds[index] = seed
    flow[index] = seed < 0.2 ? 1 : 0
  }

  const data = {
    count,
    facePositions,
    latticePositions,
    seeds,
    flow,
  }
  pointDataCache.set(count, data)
  return data
}

function getProfile(value) {
  if (!value) return null
  if (typeof value === 'string') return NANO_QUALITY_PROFILES[value] || null
  return NANO_QUALITY_PROFILES[value.name] || null
}

function nextLowerProfile(profile) {
  const index = QUALITY_ORDER.indexOf(profile.name)
  if (index < 0 || index === QUALITY_ORDER.length - 1) return profile
  return NANO_QUALITY_PROFILES[QUALITY_ORDER[index + 1]]
}

export function selectNanoQuality({
  requested = 'auto',
  width = 0,
  height = 0,
  dpr = 1,
  hardwareConcurrency = 4,
  deviceMemory = 4,
  saveData = false,
  current = null,
  averageFps = null,
  mobile = false,
} = {}) {
  if (saveData) return null

  const currentProfile = getProfile(current)
  const requestedProfile = getProfile(requested)
  let candidate = requestedProfile

  if (!candidate) {
    const constrainedViewport = mobile || width < 768 || height < 620
    const constrainedHardware = hardwareConcurrency <= 2 || deviceMemory <= 2
    const capableDesktop =
      width >= 1200 && height >= 720 && hardwareConcurrency >= 8 && deviceMemory >= 6 && dpr <= 2.5
    candidate =
      constrainedViewport || constrainedHardware
        ? NANO_QUALITY_PROFILES.low
        : capableDesktop
          ? NANO_QUALITY_PROFILES.high
          : NANO_QUALITY_PROFILES.medium
  }

  if (currentProfile) {
    const currentIndex = QUALITY_ORDER.indexOf(currentProfile.name)
    const candidateIndex = QUALITY_ORDER.indexOf(candidate.name)
    if (candidateIndex < currentIndex) candidate = currentProfile

    const fps = Number(averageFps)
    if (Number.isFinite(fps) && fps > 0 && fps < currentProfile.minFps) {
      const degradedProfile = nextLowerProfile(currentProfile)
      const degradedIndex = QUALITY_ORDER.indexOf(degradedProfile.name)
      const candidateIndexAfterConstraint = QUALITY_ORDER.indexOf(candidate.name)
      if (degradedIndex > candidateIndexAfterConstraint) candidate = degradedProfile
    }
  }

  return candidate
}

export function normalizeExclusionRect(rect) {
  if (!rect || typeof rect !== 'object') return null
  const left = Number(rect.left)
  const top = Number(rect.top)
  const width = Number(rect.width)
  const height = Number(rect.height)
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return null
  }
  return { left, top, width, height }
}

export function rectToNdc(rect, viewportRect, gap = 0) {
  const normalizedRect = normalizeExclusionRect(rect)
  const viewport = normalizeExclusionRect(viewportRect)
  if (!normalizedRect || !viewport) return null

  const safeGap = Math.max(0, Number(gap) || 0)
  const viewportRight = viewport.left + viewport.width
  const viewportBottom = viewport.top + viewport.height
  const left = clamp(normalizedRect.left - safeGap, viewport.left, viewportRight)
  const right = clamp(
    normalizedRect.left + normalizedRect.width + safeGap,
    viewport.left,
    viewportRight,
  )
  const top = clamp(normalizedRect.top - safeGap, viewport.top, viewportBottom)
  const bottom = clamp(
    normalizedRect.top + normalizedRect.height + safeGap,
    viewport.top,
    viewportBottom,
  )
  if (right <= left || bottom <= top) return null

  const centerXPx = (left + right) * 0.5 - viewport.left
  const centerYPx = (top + bottom) * 0.5 - viewport.top
  const halfWidth = (right - left) / viewport.width
  const halfHeight = (bottom - top) / viewport.height
  const radiusPx = Math.min(12, (right - left) * 0.12, (bottom - top) * 0.24)

  return {
    centerX: clamp((centerXPx / viewport.width) * 2 - 1, -1, 1),
    centerY: clamp(1 - (centerYPx / viewport.height) * 2, -1, 1),
    halfWidth: clamp(halfWidth, 0, 1),
    halfHeight: clamp(halfHeight, 0, 1),
    radius: clamp((radiusPx * 2) / Math.min(viewport.width, viewport.height), 0, 0.25),
  }
}

export function modeToValue(mode) {
  return MODE_VALUES[mode] ?? MODE_VALUES.consultation
}

export function easeOutNano(progress) {
  const value = clamp(Number(progress) || 0, 0, 1)
  return 1 - Math.pow(1 - value, 4)
}

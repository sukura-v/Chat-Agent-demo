export const HEAD_SCENE_RUNTIME_MANIFEST_URL = '/head-scene-v1/head-scene.manifest.json'
export const HEAD_SCENE_RUNTIME_SCHEMA = 'oral-rehab/head-scene-runtime-manifest'
export const HEAD_SCENE_RUNTIME_SCHEMA_VERSION = 1

const FRAME_PATTERN = /^frame_(\d{3})_delay-0\.041s\.webp$/

export const DEFAULT_HEAD_SCENE_MANIFEST = Object.freeze({
  schema: HEAD_SCENE_RUNTIME_SCHEMA,
  schemaVersion: HEAD_SCENE_RUNTIME_SCHEMA_VERSION,
  assetVersion: 'head-scene-v1-maps-2026-07-26',
  canvas: Object.freeze({
    width: 1280,
    height: 720,
    coordinateSpace: 'top-left-pixels',
    backgroundColor: '#F3F6F4',
    cropSafeArea: Object.freeze({ x: 0, y: 0, width: 1280, height: 720 }),
  }),
  endpoints: Object.freeze({
    front: Object.freeze({
      frameIndex: 1,
      anchors: Object.freeze({
        leftEyeOuter: [493, 343],
        rightEyeOuter: [787, 343],
        noseTip: [640, 452],
        leftMouthCorner: [565, 530],
        rightMouthCorner: [715, 530],
        chin: [640, 638],
      }),
    }),
    profile: Object.freeze({
      frameIndex: 236,
      anchors: Object.freeze({
        leftEyeOuter: [584, 329],
        rightEyeOuter: [640, 329],
        noseTip: [653, 393],
        leftMouthCorner: [604, 460],
        rightMouthCorner: [631, 461],
        chin: [606, 554],
      }),
    }),
  }),
  sequence: Object.freeze({
    directory: 'runtime/sequence',
    pattern: 'frame_{index:03d}_delay-0.041s.webp',
    firstFrameIndex: 1,
    lastFrameIndex: 236,
    frameCount: 236,
    frameDurationSeconds: 0.007,
  }),
  maps: Object.freeze({
    high: Object.freeze({
      frontMask: 'runtime/maps/front_mask.png',
      profileMask: 'runtime/maps/profile_mask.png',
      frontDepth: 'runtime/maps/front_depth.png',
      profileDepth: 'runtime/maps/profile_depth.png',
    }),
    medium: Object.freeze({
      frontMask: 'runtime/maps/front_mask.webp',
      profileMask: 'runtime/maps/profile_mask.webp',
      frontDepth: 'runtime/maps/front_depth.webp',
      profileDepth: 'runtime/maps/profile_depth.webp',
    }),
  }),
  depth: Object.freeze({
    bitDepthHigh: 16,
    bitDepthMedium: 8,
    near: 0,
    far: 65535,
    background: 65535,
    polarity: 'black-near-white-far',
  }),
  mask: Object.freeze({
    min: 0,
    max: 255,
    semantics: 'weight',
    zero: 'no-displacement',
    full: 'full-displacement',
  }),
})

function error(code, path, message) {
  return { code, path, message }
}

function isFinitePositive(value) {
  return Number.isFinite(value) && value > 0
}

function isAnchor(value, canvas) {
  return Array.isArray(value)
    && value.length === 2
    && value.every(Number.isFinite)
    && value[0] >= 0
    && value[1] >= 0
    && value[0] <= canvas.width
    && value[1] <= canvas.height
}

export function validateHeadSceneRuntimeManifest(manifest) {
  const errors = []
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, errors: [error('MANIFEST_INVALID', '', 'Manifest must be an object.')] }
  }
  if (manifest.schema !== HEAD_SCENE_RUNTIME_SCHEMA) {
    errors.push(error('SCHEMA_UNSUPPORTED', 'schema', `Expected ${HEAD_SCENE_RUNTIME_SCHEMA}.`))
  }
  if (manifest.schemaVersion !== HEAD_SCENE_RUNTIME_SCHEMA_VERSION) {
    errors.push(error('SCHEMA_VERSION_UNSUPPORTED', 'schemaVersion', `Expected ${HEAD_SCENE_RUNTIME_SCHEMA_VERSION}.`))
  }
  if (typeof manifest.assetVersion !== 'string' || !manifest.assetVersion.trim()) {
    errors.push(error('ASSET_VERSION_INVALID', 'assetVersion', 'Asset version is required.'))
  }

  const canvas = manifest.canvas
  if (!canvas || !isFinitePositive(canvas.width) || !isFinitePositive(canvas.height)) {
    errors.push(error('CANVAS_INVALID', 'canvas', 'Canvas dimensions must be positive.'))
  } else {
    const safe = canvas.cropSafeArea
    const safeValid = safe
      && [safe.x, safe.y, safe.width, safe.height].every(Number.isFinite)
      && safe.x >= 0
      && safe.y >= 0
      && safe.width > 0
      && safe.height > 0
      && safe.x + safe.width <= canvas.width
      && safe.y + safe.height <= canvas.height
    if (!safeValid) errors.push(error('CROP_SAFE_AREA_INVALID', 'canvas.cropSafeArea', 'Crop safe area must stay inside the canvas.'))
  }

  const sequence = manifest.sequence
  if (!sequence
    || sequence.firstFrameIndex !== 1
    || sequence.lastFrameIndex !== sequence.frameCount
    || sequence.frameCount < 2
    || sequence.frameDurationSeconds <= 0
    || typeof sequence.directory !== 'string'
    || typeof sequence.pattern !== 'string') {
    errors.push(error('SEQUENCE_INVALID', 'sequence', 'A contiguous WebP sequence contract is required.'))
  }

  for (const orientation of ['front', 'profile']) {
    const endpoint = manifest.endpoints?.[orientation]
    const expectedIndex = orientation === 'front' ? sequence?.firstFrameIndex : sequence?.lastFrameIndex
    if (!endpoint || endpoint.frameIndex !== expectedIndex) {
      errors.push(error('ENDPOINT_INVALID', `endpoints.${orientation}.frameIndex`, `Expected sequence endpoint frame ${expectedIndex}.`))
    }
    for (const anchorName of ['leftEyeOuter', 'rightEyeOuter', 'noseTip', 'leftMouthCorner', 'rightMouthCorner', 'chin']) {
      if (!isAnchor(endpoint?.anchors?.[anchorName], canvas || { width: 0, height: 0 })) {
        errors.push(error('ANCHOR_INVALID', `endpoints.${orientation}.anchors.${anchorName}`, 'Anchor must be inside the canvas.'))
      }
    }
  }

  const depth = manifest.depth
  if (depth?.near !== 0 || depth?.far !== 65535 || depth?.background !== 65535 || depth?.polarity !== 'black-near-white-far') {
    errors.push(error('DEPTH_SEMANTICS_INVALID', 'depth', 'Depth must use near 0, far/background 65535 and black-near-white-far.'))
  }
  const mask = manifest.mask
  if (mask?.min !== 0 || mask?.max !== 255 || mask?.semantics !== 'weight') {
    errors.push(error('MASK_SEMANTICS_INVALID', 'mask', 'Mask must be a 0..255 displacement weight.'))
  }
  for (const tier of ['high', 'medium']) {
    for (const key of ['frontMask', 'profileMask', 'frontDepth', 'profileDepth']) {
      if (typeof manifest.maps?.[tier]?.[key] !== 'string' || !manifest.maps[tier][key]) {
        errors.push(error('MAP_MISSING', `maps.${tier}.${key}`, 'A map path is required.'))
      }
    }
  }
  return { valid: errors.length === 0, errors }
}

export function getHeadSceneFramePath(manifest, frameIndex, baseUrl = '') {
  const sequence = manifest?.sequence
  if (!sequence || !Number.isInteger(frameIndex)) return ''
  const bounded = Math.min(sequence.lastFrameIndex, Math.max(sequence.firstFrameIndex, frameIndex))
  const frame = String(bounded).padStart(3, '0')
  const fileName = sequence.pattern.replace('{index:03d}', frame)
  return `${String(baseUrl).replace(/\/$/, '')}/${sequence.directory.replace(/^\//, '')}/${fileName}`
}

export function getHeadSceneRuntimeAlignment(manifest, orientation = 'front') {
  const validation = validateHeadSceneRuntimeManifest(manifest)
  if (!validation.valid) throw new Error(`Invalid head-scene runtime manifest: ${validation.errors[0].code}`)
  const canvas = manifest.canvas
  const endpoint = manifest.endpoints[orientation === 'profile' ? 'profile' : 'front']
  const anchorValues = Object.values(endpoint.anchors)
  const anchorCenter = anchorValues.reduce((center, anchor) => [
    center[0] + anchor[0] / anchorValues.length / canvas.width,
    center[1] + anchor[1] / anchorValues.length / canvas.height,
  ], [0, 0])
  return {
    cropScale: [manifest.canvas.cropSafeArea.width / canvas.width, manifest.canvas.cropSafeArea.height / canvas.height],
    cropOffset: [manifest.canvas.cropSafeArea.x / canvas.width, manifest.canvas.cropSafeArea.y / canvas.height],
    anchorCenter,
    anchors: endpoint.anchors,
  }
}

export function getHeadSceneCoverAlignment(
  manifest,
  displayWidth,
  displayHeight,
  orientation = 'front',
) {
  const alignment = getHeadSceneRuntimeAlignment(manifest, orientation)
  if (
    !isFinitePositive(displayWidth)
    || !isFinitePositive(displayHeight)
  ) {
    return alignment
  }

  const [baseScaleX, baseScaleY] = alignment.cropScale
  const [baseOffsetX, baseOffsetY] = alignment.cropOffset
  const sourceWidth = manifest.canvas.width * baseScaleX
  const sourceHeight = manifest.canvas.height * baseScaleY
  const sourceAspect = sourceWidth / sourceHeight
  const displayAspect = displayWidth / displayHeight
  const cropScale = [baseScaleX, baseScaleY]
  const cropOffset = [baseOffsetX, baseOffsetY]

  if (displayAspect > sourceAspect) {
    // CSS equivalent: object-fit: cover; object-position: center top.
    cropScale[1] *= sourceAspect / displayAspect
  } else if (displayAspect < sourceAspect) {
    const visibleWidthRatio = displayAspect / sourceAspect
    cropScale[0] *= visibleWidthRatio
    cropOffset[0] += (baseScaleX - cropScale[0]) / 2
  }

  return {
    ...alignment,
    cropScale,
    cropOffset,
  }
}

export function resolveHeadSceneRuntimeAssets(manifest, tier = 'low', baseUrl = '', orientation = 'front') {
  const result = validateHeadSceneRuntimeManifest(manifest)
  if (!result.valid) throw new Error(`Invalid head-scene runtime manifest: ${result.errors[0].code}`)
  if (!['high', 'medium', 'low'].includes(tier)) throw new Error(`Unsupported head-scene capability tier: ${tier}`)

  return {
    tier,
    assetVersion: manifest.assetVersion,
    canvas: manifest.canvas,
    cropSafeArea: manifest.canvas.cropSafeArea,
    anchors: manifest.endpoints,
    alignment: getHeadSceneRuntimeAlignment(manifest, orientation),
    endpoints: {
      front: getHeadSceneFramePath(manifest, manifest.endpoints.front.frameIndex, baseUrl),
      profile: getHeadSceneFramePath(manifest, manifest.endpoints.profile.frameIndex, baseUrl),
    },
    dataMaps: tier === 'low'
      ? null
      : Object.fromEntries(Object.entries(manifest.maps[tier]).map(([key, path]) => [
        key,
        `${String(baseUrl).replace(/\/$/, '')}/${path.replace(/^\//, '')}`,
      ])),
    features: { depth: tier !== 'low', flow: tier !== 'low' },
  }
}

export function getSequenceFrameIndexFromFileName(fileName) {
  const match = String(fileName).match(FRAME_PATTERN)
  return match ? Number(match[1]) : null
}

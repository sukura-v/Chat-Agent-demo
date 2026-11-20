export const HEAD_SCENE_MANIFEST_SCHEMA = 'oral-rehab/head-scene-manifest'
export const HEAD_SCENE_MANIFEST_SCHEMA_VERSION = 1

const REQUIRED_ANCHORS = Object.freeze([
  'leftEyeOuter',
  'rightEyeOuter',
  'noseTip',
  'leftMouthCorner',
  'rightMouthCorner',
  'chin',
])

const REQUIRED_RESOURCE_PATHS = Object.freeze({
  'master.transition': 'masters/head_transition_master.mov',
  'master.front': 'masters/head_front_master.png',
  'master.profile': 'masters/head_profile_master.png',
  'video.transition.webm': 'runtime/head_transition.webm',
  'video.transition.mp4': 'runtime/head_transition.mp4',
  'endpoint.front': 'runtime/head_front.webp',
  'endpoint.profile': 'runtime/head_profile.webp',
  'data.high.frontMask': 'runtime/front_mask.png',
  'data.high.profileMask': 'runtime/profile_mask.png',
  'data.high.frontDepth': 'runtime/front_depth.png',
  'data.high.profileDepth': 'runtime/profile_depth.png',
  'data.medium.frontMask': 'runtime/front_mask.webp',
  'data.medium.profileMask': 'runtime/profile_mask.webp',
  'data.medium.frontDepth': 'runtime/front_depth.webp',
  'data.medium.profileDepth': 'runtime/profile_depth.webp',
})

const REQUIRED_RESOURCE_MEDIA = Object.freeze({
  'master.transition': Object.freeze({
    width: 2048, height: 2048, frameRate: 30, durationSeconds: 9.5,
    codec: 'prores_4444', pixelFormat: 'yuva444p12le', alpha: 'straight', colorSpace: 'rec709',
  }),
  'master.front': Object.freeze({
    width: 2048, height: 2048, bitDepth: 16, channels: 'rgba', alpha: 'straight', colorSpace: 'rec709',
  }),
  'master.profile': Object.freeze({
    width: 2048, height: 2048, bitDepth: 16, channels: 'rgba', alpha: 'straight', colorSpace: 'rec709',
  }),
  'video.transition.webm': Object.freeze({
    width: 1440, height: 1440, frameRate: 30, durationSeconds: 9.5,
    codec: 'vp9', pixelFormat: 'yuva420p', alpha: 'straight', colorSpace: 'rec709',
  }),
  'video.transition.mp4': Object.freeze({
    width: 1440, height: 1440, frameRate: 30, durationSeconds: 9.5,
    codec: 'h264-high', pixelFormat: 'yuv420p', alpha: 'none',
    backgroundColor: '#F3F6F4', fastStart: true, colorSpace: 'rec709',
  }),
  'endpoint.front': Object.freeze({
    width: 2048, height: 2048, codec: 'webp-lossless', bitDepth: 8,
    channels: 'rgba', alpha: 'straight', colorSpace: 'srgb',
  }),
  'endpoint.profile': Object.freeze({
    width: 2048, height: 2048, codec: 'webp-lossless', bitDepth: 8,
    channels: 'rgba', alpha: 'straight', colorSpace: 'srgb',
  }),
  'data.high.frontMask': Object.freeze({
    width: 1024, height: 1024, codec: 'png', bitDepth: 8, channels: 'gray', colorSpace: 'none',
  }),
  'data.high.profileMask': Object.freeze({
    width: 1024, height: 1024, codec: 'png', bitDepth: 8, channels: 'gray', colorSpace: 'none',
  }),
  'data.high.frontDepth': Object.freeze({
    width: 1024, height: 1024, codec: 'png', bitDepth: 16, channels: 'gray', colorSpace: 'linear',
  }),
  'data.high.profileDepth': Object.freeze({
    width: 1024, height: 1024, codec: 'png', bitDepth: 16, channels: 'gray', colorSpace: 'linear',
  }),
  'data.medium.frontMask': Object.freeze({
    width: 1024, height: 1024, codec: 'webp-lossless', bitDepth: 8, channels: 'gray', colorSpace: 'none',
  }),
  'data.medium.profileMask': Object.freeze({
    width: 1024, height: 1024, codec: 'webp-lossless', bitDepth: 8, channels: 'gray', colorSpace: 'none',
  }),
  'data.medium.frontDepth': Object.freeze({
    width: 1024, height: 1024, codec: 'webp-lossless', bitDepth: 8, channels: 'gray', colorSpace: 'linear',
  }),
  'data.medium.profileDepth': Object.freeze({
    width: 1024, height: 1024, codec: 'webp-lossless', bitDepth: 8, channels: 'gray', colorSpace: 'linear',
  }),
})

const REQUIRED_MAP_IDS = Object.freeze({
  high: Object.freeze({
    frontMask: 'data.high.frontMask',
    profileMask: 'data.high.profileMask',
    frontDepth: 'data.high.frontDepth',
    profileDepth: 'data.high.profileDepth',
  }),
  medium: Object.freeze({
    frontMask: 'data.medium.frontMask',
    profileMask: 'data.medium.profileMask',
    frontDepth: 'data.medium.frontDepth',
    profileDepth: 'data.medium.profileDepth',
  }),
})

const SHA256_PATTERN = /^[a-f0-9]{64}$/i
const MANIFEST_ROOT_KEYS = new Set([
  'schema',
  'schemaVersion',
  'assetVersion',
  'canvas',
  'endpoints',
  'dataMaps',
  'transition',
  'validation',
  'resources',
])

function validationError(code, path, message) {
  return { code, path, message }
}

function isPositiveNumber(value) {
  return Number.isFinite(value) && value > 0
}

function validateCanvas(manifest, errors) {
  const canvas = manifest?.canvas
  if (!canvas || !isPositiveNumber(canvas.width) || !isPositiveNumber(canvas.height)) {
    errors.push(validationError('CANVAS_INVALID', 'canvas', 'Canvas width and height must be positive.'))
    return
  }
  if (canvas.coordinateSpace !== 'top-left-pixels') {
    errors.push(validationError('CANVAS_COORDINATE_SPACE_INVALID', 'canvas.coordinateSpace', 'Canvas coordinates must use top-left pixels.'))
  }
  if (!/^#[0-9a-f]{6}$/i.test(canvas.backgroundColor || '')) {
    errors.push(validationError('CANVAS_BACKGROUND_INVALID', 'canvas.backgroundColor', 'Canvas background must be a six-digit hex color.'))
  }

  const safe = canvas.cropSafeArea
  const insideCanvas = safe
    && [safe.x, safe.y, safe.width, safe.height].every(Number.isFinite)
    && safe.x >= 0
    && safe.y >= 0
    && safe.width > 0
    && safe.height > 0
    && safe.x + safe.width <= canvas.width
    && safe.y + safe.height <= canvas.height
  if (!insideCanvas) {
    errors.push(validationError('CROP_SAFE_AREA_INVALID', 'canvas.cropSafeArea', 'Crop safe area must stay inside the canvas.'))
  }
}

function validateEndpoints(manifest, errors) {
  const expectedSourceTimes = { front: 0, profile: 4.5 }
  const canvasIsUsable = isPositiveNumber(manifest?.canvas?.width) && isPositiveNumber(manifest?.canvas?.height)
  for (const endpointName of ['front', 'profile']) {
    const endpoint = manifest?.endpoints?.[endpointName]
    if (endpoint?.assetId !== `endpoint.${endpointName}` || !Number.isFinite(endpoint?.sourceTimeSeconds)) {
      errors.push(validationError('ENDPOINT_INVALID', `endpoints.${endpointName}`, 'Endpoint asset and source time are required.'))
      continue
    }
    if (endpoint.sourceTimeSeconds !== expectedSourceTimes[endpointName]) {
      errors.push(validationError(
        'ENDPOINT_INVALID',
        `endpoints.${endpointName}.sourceTimeSeconds`,
        `Expected ${expectedSourceTimes[endpointName]} seconds.`,
      ))
    }
    for (const anchorName of REQUIRED_ANCHORS) {
      const anchor = endpoint.anchors?.[anchorName]
      if (!Array.isArray(anchor) || anchor.length !== 2 || !anchor.every(Number.isFinite)) {
        errors.push(validationError('ANCHOR_INVALID', `endpoints.${endpointName}.anchors.${anchorName}`, 'Anchor must be an [x, y] pixel coordinate.'))
      } else if (canvasIsUsable && (
        anchor[0] < 0
        || anchor[1] < 0
        || anchor[0] > manifest.canvas.width
        || anchor[1] > manifest.canvas.height
      )) {
        errors.push(validationError('ANCHOR_INVALID', `endpoints.${endpointName}.anchors.${anchorName}`, 'Anchor must stay inside the canvas.'))
      }
    }
  }
}

function validateDataMaps(manifest, errors) {
  for (const [tier, requiredMaps] of Object.entries(REQUIRED_MAP_IDS)) {
    for (const [mapName, resourceId] of Object.entries(requiredMaps)) {
      if (manifest?.dataMaps?.[tier]?.[mapName] !== resourceId) {
        errors.push(validationError('DATA_MAP_REFERENCE_INVALID', `dataMaps.${tier}.${mapName}`, `Expected ${resourceId}.`))
      }
    }
  }
}

function validateTransition(manifest, errors) {
  const transition = manifest?.transition
  if (transition?.sources?.webm !== 'video.transition.webm' || transition?.sources?.mp4 !== 'video.transition.mp4') {
    errors.push(validationError('TRANSITION_SOURCE_INVALID', 'transition.sources', 'Both WebM and MP4 transition sources are required.'))
  }

  const enter = transition?.segments?.enter
  const hold = transition?.segments?.hold
  const returning = transition?.segments?.return
  const ordered = [enter?.startSeconds, enter?.endSeconds, hold?.startSeconds, hold?.endSeconds, returning?.startSeconds, returning?.endSeconds]
  const requiredTimes = [0, 4.5, 4.5, 5, 5, 9.5]
  if (!ordered.every((value, index) => value === requiredTimes[index])) {
    errors.push(validationError('TRANSITION_SEGMENTS_INVALID', 'transition.segments', 'Expected enter 0–4.5s, hold 4.5–5s and return 5–9.5s.'))
  }
}

function validateResources(manifest, errors) {
  const resources = manifest?.resources
  if (!resources || typeof resources !== 'object' || Array.isArray(resources)) {
    errors.push(validationError('RESOURCES_INVALID', 'resources', 'Resources must be an object keyed by stable asset id.'))
    return
  }

  for (const [resourceId, expectedPath] of Object.entries(REQUIRED_RESOURCE_PATHS)) {
    const resource = resources[resourceId]
    if (!resource) {
      errors.push(validationError('RESOURCE_MISSING', `resources.${resourceId}`, `Missing required resource ${resourceId}.`))
      continue
    }
    if (resource.path !== expectedPath) {
      errors.push(validationError('RESOURCE_PATH_INVALID', `resources.${resourceId}.path`, `Expected ${expectedPath}.`))
    }
    if (typeof resource.role !== 'string' || !resource.role.trim()) {
      errors.push(validationError('RESOURCE_ROLE_INVALID', `resources.${resourceId}.role`, 'A non-empty resource role is required.'))
    }
    if (!isPositiveNumber(resource.media?.width) || !isPositiveNumber(resource.media?.height)) {
      errors.push(validationError('RESOURCE_MEDIA_INVALID', `resources.${resourceId}.media`, 'Media dimensions are required.'))
    }
    for (const [field, expectedValue] of Object.entries(REQUIRED_RESOURCE_MEDIA[resourceId])) {
      if (resource.media?.[field] !== expectedValue) {
        errors.push(validationError(
          'RESOURCE_MEDIA_MISMATCH',
          `resources.${resourceId}.media.${field}`,
          `Expected ${String(expectedValue)}.`,
        ))
      }
    }
    if (resource.checksum?.algorithm !== 'sha256' || !SHA256_PATTERN.test(resource.checksum?.value || '')) {
      errors.push(validationError('RESOURCE_CHECKSUM_INVALID', `resources.${resourceId}.checksum`, 'A SHA-256 checksum is required.'))
    }
  }

  for (const resourceId of Object.keys(resources)) {
    if (!(resourceId in REQUIRED_RESOURCE_PATHS)) {
      errors.push(validationError('RESOURCE_UNEXPECTED', `resources.${resourceId}`, `Unexpected resource ${resourceId}.`))
    }
  }
}

export function validateHeadSceneManifest(manifest) {
  const errors = []
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, errors: [validationError('MANIFEST_INVALID', '', 'Manifest must be a JSON object.')] }
  }
  for (const key of Object.keys(manifest)) {
    if (!MANIFEST_ROOT_KEYS.has(key)) {
      errors.push(validationError('SCHEMA_SHAPE_INVALID', key, `Unexpected manifest property ${key}.`))
    }
  }
  if (manifest.schema !== HEAD_SCENE_MANIFEST_SCHEMA) {
    errors.push(validationError('SCHEMA_UNSUPPORTED', 'schema', `Expected ${HEAD_SCENE_MANIFEST_SCHEMA}.`))
  }
  if (manifest.schemaVersion !== HEAD_SCENE_MANIFEST_SCHEMA_VERSION) {
    errors.push(validationError('SCHEMA_VERSION_UNSUPPORTED', 'schemaVersion', `Expected schema version ${HEAD_SCENE_MANIFEST_SCHEMA_VERSION}.`))
  }
  if (typeof manifest.assetVersion !== 'string' || !manifest.assetVersion.trim()) {
    errors.push(validationError('ASSET_VERSION_INVALID', 'assetVersion', 'A non-empty immutable asset version is required.'))
  }

  validateCanvas(manifest, errors)
  validateEndpoints(manifest, errors)
  validateDataMaps(manifest, errors)
  validateTransition(manifest, errors)
  validateResources(manifest, errors)

  const validation = manifest.validation
  if (
    validation?.checksumAlgorithm !== 'sha256'
    || !Number.isFinite(validation?.endpointSsimMinimum)
    || validation.endpointSsimMinimum < 0.985
    || validation.endpointSsimMinimum > 1
    || !Number.isFinite(validation?.anchorMaxDeviationPx)
    || validation.anchorMaxDeviationPx < 0
    || validation.anchorMaxDeviationPx > 2
  ) {
    errors.push(validationError('VALIDATION_POLICY_INVALID', 'validation', 'SHA-256, SSIM and anchor thresholds are required.'))
  }
  return { valid: errors.length === 0, errors }
}

function resourcePath(manifest, resourceId) {
  return manifest.resources[resourceId].path
}

export function resolveHeadSceneAssets(manifest, tier) {
  if (!['high', 'medium', 'low'].includes(tier)) {
    throw new Error(`Unsupported head-scene capability tier: ${tier}`)
  }
  const validation = validateHeadSceneManifest(manifest)
  if (!validation.valid) {
    throw new Error(`Invalid head-scene manifest: ${validation.errors[0].code}`)
  }

  const endpoints = {
    front: resourcePath(manifest, manifest.endpoints.front.assetId),
    profile: resourcePath(manifest, manifest.endpoints.profile.assetId),
  }
  if (tier === 'low') {
    return {
      tier,
      assetVersion: manifest.assetVersion,
      endpoints,
      dataMaps: null,
      transition: null,
      features: { depth: false, flow: false },
    }
  }

  const dataMaps = Object.fromEntries(
    Object.entries(manifest.dataMaps[tier]).map(([name, resourceId]) => [name, resourcePath(manifest, resourceId)]),
  )
  return {
    tier,
    assetVersion: manifest.assetVersion,
    endpoints,
    dataMaps,
    transition: {
      webm: resourcePath(manifest, manifest.transition.sources.webm),
      mp4: resourcePath(manifest, manifest.transition.sources.mp4),
      segments: manifest.transition.segments,
    },
    features: { depth: true, flow: true },
  }
}

export const HEAD_SCENE_REQUIRED_RESOURCE_PATHS = REQUIRED_RESOURCE_PATHS

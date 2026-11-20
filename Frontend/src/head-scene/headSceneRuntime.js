import {
  ClampToEdgeWrapping,
  GLSL3,
  LinearFilter,
  Mesh,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  TextureLoader,
  UnsignedByteType,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three'

import {
  DEFAULT_HEAD_SCENE_MANIFEST,
  getHeadSceneCoverAlignment,
  HEAD_SCENE_RUNTIME_MANIFEST_URL,
  resolveHeadSceneRuntimeAssets,
  validateHeadSceneRuntimeManifest,
} from './runtimeManifest.js'

export const HEAD_SCENE_POINTER_LIMIT_DEGREES = 5
export const HEAD_SCENE_TRACKING_RESPONSE = 12
export const HEAD_SCENE_RETURN_RESPONSE = 6
export const HEAD_SCENE_FLOW_SIZE = Object.freeze({ width: 160, height: 90 })
const HEAD_SCENE_MAX_FRAME_DELTA_SECONDS = 0.05
const HEAD_SCENE_DRAWABLE_TIMEOUT_MS = 2500
const HEAD_SCENE_FLOW_SIZES = Object.freeze({
  high: Object.freeze({ width: 256, height: 144 }),
  medium: Object.freeze({ width: 192, height: 108 }),
  low: Object.freeze({ width: 128, height: 72 }),
})

const FULLSCREEN_VERTEX_SHADER = /* glsl */ `
  out vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const FLOW_INITIALIZE_FRAGMENT_SHADER = /* glsl */ `
  out vec4 outColor;

  void main() {
    outColor = vec4(128.0 / 255.0);
  }
`

const FLOW_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uPrevious;
  uniform sampler2D uMask;
  uniform vec2 uBrushCurrent;
  uniform vec2 uBrushPrevious;
  uniform vec2 uBrushTangent;
  uniform vec2 uTexelSize;
  uniform vec2 uCropScale;
  uniform vec2 uCropOffset;
  uniform float uStrokeActive;
  uniform float uBrushSpeed;
  uniform float uDeltaTime;
  uniform float uAspect;
  in vec2 vUv;
  out vec4 outColor;

  const float STATE_NEUTRAL = 128.0 / 255.0;

  vec4 readState(vec2 uv) {
    return (
      texture(uPrevious, clamp(uv, uTexelSize, vec2(1.0) - uTexelSize))
      - STATE_NEUTRAL
    ) * 2.0;
  }

  void main() {
    vec2 maskUv = clamp(uCropOffset + vUv * uCropScale, 0.001, 0.999);
    float domain = smoothstep(0.04, 0.72, texture(uMask, maskUv).r);
    if (domain <= 0.0001) {
      outColor = vec4(0.5);
      return;
    }

    float dt = clamp(uDeltaTime, 0.001, 0.05);
    vec4 centerState = readState(vUv);
    vec4 neighborhood = (
      readState(vUv + vec2(uTexelSize.x, 0.0))
      + readState(vUv - vec2(uTexelSize.x, 0.0))
      + readState(vUv + vec2(0.0, uTexelSize.y))
      + readState(vUv - vec2(0.0, uTexelSize.y))
    ) * 0.25;

    vec2 lateral = mix(centerState.rg, neighborhood.rg, 1.0 - exp(-3.4 * dt));
    float height = mix(centerState.b, neighborhood.b, 1.0 - exp(-6.2 * dt));
    float wetness = mix(centerState.a, neighborhood.a, 1.0 - exp(-5.0 * dt));
    // At tau=0.50 the visible 0.008 groove threshold closes in about 2.1 seconds.
    lateral *= exp(-dt / 0.50);
    height *= exp(-dt / 0.50);
    // Sharp bank gloss is gone after roughly 0.65 seconds while height remains rounded.
    wetness *= exp(-dt / 0.26);

    if (uStrokeActive > 0.5) {
      vec2 point = vec2(vUv.x * uAspect, vUv.y);
      vec2 segmentStart = vec2(uBrushPrevious.x * uAspect, uBrushPrevious.y);
      vec2 segmentEnd = vec2(uBrushCurrent.x * uAspect, uBrushCurrent.y);
      vec2 segment = segmentEnd - segmentStart;
      float segmentLengthSquared = max(dot(segment, segment), 0.000001);
      float along = clamp(dot(point - segmentStart, segment) / segmentLengthSquared, 0.0, 1.0);
      vec2 nearestPoint = segmentStart + segment * along;
      vec2 offset = point - nearestPoint;
      float distanceFromPath = length(offset);
      vec2 nearestUv = vec2(nearestPoint.x / uAspect, nearestPoint.y);
      vec4 pathState = readState(nearestUv);
      float pathHeight = pathState.b;
      float strokeCapacity = smoothstep(-0.56, -0.42, pathHeight);

      vec2 tangentAspect = vec2(uBrushTangent.x * uAspect, uBrushTangent.y);
      vec2 tangent = length(tangentAspect) > 0.0001
        ? normalize(tangentAspect)
        : normalize(segment + vec2(0.0001, 0.0));
      vec2 normal = vec2(-tangent.y, tangent.x);
      float perpendicular = dot(offset, normal);
      float side = perpendicular >= 0.0 ? 1.0 : -1.0;

      const float grooveWidth = 0.058;
      float repetition = clamp(pathState.a, 0.0, 1.0);
      float radius = grooveWidth * 0.965 * mix(1.0, 1.24, repetition);
      float normalizedDistance = distanceFromPath / radius;
      float core = exp(-normalizedDistance * normalizedDistance * 2.4);
      float bankWidth = radius * 0.42;
      float bankOffset = radius * 0.72;
      float bankLeft = exp(-pow((perpendicular - bankOffset) / bankWidth, 2.0));
      float bankRight = exp(-pow((perpendicular + bankOffset) / bankWidth, 2.0));
      float cap = exp(-pow(max(abs(dot(offset, tangent)) - radius * 0.18, 0.0) / radius, 2.0) * 2.0);
      core *= cap;
      float banks = (bankLeft + bankRight) * cap;
      const float bankMassScale = 0.768455;
      float pressure = -core + banks * bankMassScale;

      height = clamp(height + pressure * 0.145 * strokeCapacity, -0.56, 0.34);
      vec2 lateralPush = normal * side * core * strokeCapacity * 0.026;
      vec2 directionalWake = tangent * core * strokeCapacity * uBrushSpeed * 0.006;
      lateral = clamp(
        lateral + vec2(
          (lateralPush.x + directionalWake.x) / uAspect,
          lateralPush.y + directionalWake.y
        ),
        vec2(-0.095),
        vec2(0.095)
      );
      wetness = clamp(
        wetness + max(core, banks * 0.72) * strokeCapacity * 0.34,
        0.0,
        1.0
      );
    }

    float edgeWindow = smoothstep(0.0, 0.86, domain);
    vec4 nextState = vec4(lateral, height, wetness) * edgeWindow;
    outColor = nextState * 0.5 + 0.5;
  }
`

const SURFACE_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uEndpoint;
  uniform sampler2D uFlow;
  uniform sampler2D uMask;
  uniform vec2 uCropScale;
  uniform vec2 uCropOffset;
  uniform vec2 uFlowTexel;
  in vec2 vUv;
  out vec4 outColor;

  const float STATE_NEUTRAL = 128.0 / 255.0;

  void main() {
    vec2 sourceUv = clamp(uCropOffset + vUv * uCropScale, 0.001, 0.999);
    vec4 base = texture(uEndpoint, sourceUv);
    float maskWeight = clamp(texture(uMask, sourceUv).r, 0.0, 1.0);
    vec4 liquid = (texture(uFlow, vUv) - STATE_NEUTRAL) * 2.0;
    vec2 transportedUv = clamp(sourceUv - liquid.rg * uCropScale * 1.38, 0.001, 0.999);
    vec4 transported = texture(uEndpoint, transportedUv);

    float liquidHeight = liquid.b;
    float heightLeft = (texture(uFlow, vUv - vec2(uFlowTexel.x, 0.0)).b - STATE_NEUTRAL) * 2.0;
    float heightRight = (texture(uFlow, vUv + vec2(uFlowTexel.x, 0.0)).b - STATE_NEUTRAL) * 2.0;
    float heightDown = (texture(uFlow, vUv - vec2(0.0, uFlowTexel.y)).b - STATE_NEUTRAL) * 2.0;
    float heightUp = (texture(uFlow, vUv + vec2(0.0, uFlowTexel.y)).b - STATE_NEUTRAL) * 2.0;
    vec2 heightGradient = vec2(heightRight - heightLeft, heightUp - heightDown);

    vec2 bankDirection = length(liquid.rg) > 0.0005
      ? normalize(liquid.rg)
      : (length(heightGradient) > 0.00001 ? normalize(heightGradient) : vec2(0.0, 1.0));
    float groove = smoothstep(0.008, 0.09, -liquidHeight);
    float ridge = smoothstep(0.025, 0.24, liquidHeight);
    // As the signed height closes, both banks move inward and rebuild features spatially.
    float bankSpan = mix(0.008, 0.052, sqrt(groove));
    vec4 bankMaterial = (
      texture(uEndpoint, clamp(sourceUv + bankDirection * bankSpan * uCropScale, 0.001, 0.999))
      + texture(uEndpoint, clamp(sourceUv - bankDirection * bankSpan * uCropScale, 0.001, 0.999))
    ) * 0.5;
    float bankLuma = dot(bankMaterial.rgb, vec3(0.2126, 0.7152, 0.0722));
    vec3 milkTone = vec3(max(bankLuma, 0.80)) * vec3(1.0, 0.995, 0.985);
    vec4 reconstructed = mix(bankMaterial, vec4(milkTone, bankMaterial.a), 0.82);
    vec4 material = mix(transported, reconstructed, groove * 0.98);

    float deformation = smoothstep(0.002, 0.035, length(liquid.rg) + abs(liquidHeight) * 0.38);
    float volumeShade = (
      liquidHeight * 0.14
      + dot(heightGradient, normalize(vec2(-0.55, 0.84))) * 0.62
    ) * deformation;
    material.rgb *= clamp(1.0 + volumeShade, 0.84, 1.16);
    material.rgb += ridge * liquid.a * deformation * 0.055;

    float fixedSurfaceMask = smoothstep(0.08, 0.72, maskWeight);
    outColor = linearToOutputTexel(mix(base, material, fixedSurfaceMask));
  }
`

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function nowMilliseconds() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

function hasWebGl2(canvas) {
  if (!canvas || typeof canvas.getContext !== 'function') return false
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '')) return false
  try {
    return Boolean(canvas.getContext('webgl2', { alpha: true, antialias: false }))
  } catch {
    return false
  }
}

export function detectHeadSceneCapability({
  canvas = null,
  requested = 'auto',
  width = typeof window === 'undefined' ? 0 : window.innerWidth,
  height = typeof window === 'undefined' ? 0 : window.innerHeight,
  hardwareConcurrency = typeof navigator === 'undefined' ? 4 : navigator.hardwareConcurrency || 4,
  deviceMemory = typeof navigator === 'undefined' ? 4 : navigator.deviceMemory || 4,
  saveData = typeof navigator !== 'undefined' && navigator.connection?.saveData === true,
  prefersReducedMotion = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
} = {}) {
  if (requested === 'low' || saveData || prefersReducedMotion || !hasWebGl2(canvas)) return 'low'
  if (requested === 'high') return 'high'
  if (requested === 'medium') return 'medium'
  if (width < 768 || hardwareConcurrency < 6 || deviceMemory < 4) return 'low'
  const highCapability = width >= 1200 && height >= 720 && hardwareConcurrency >= 8 && deviceMemory >= 6
  return highCapability ? 'high' : 'medium'
}

export async function loadHeadSceneRuntimeManifest({
  url = HEAD_SCENE_RUNTIME_MANIFEST_URL,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') return DEFAULT_HEAD_SCENE_MANIFEST
  const response = await fetchImpl(url, { cache: 'no-cache' })
  if (!response.ok) throw new Error(`Head-scene manifest request failed: ${response.status}`)
  const manifest = await response.json()
  const validation = validateHeadSceneRuntimeManifest(manifest)
  if (!validation.valid) throw new Error(`Invalid head-scene runtime manifest: ${validation.errors[0].code}`)
  return manifest
}

function readUint32(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
}

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft
  const leftDistance = Math.abs(estimate - left)
  const aboveDistance = Math.abs(estimate - above)
  const upperLeftDistance = Math.abs(estimate - upperLeft)
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left
  if (aboveDistance <= upperLeftDistance) return above
  return upperLeft
}

async function inflatePngData(data) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('16-bit PNG decoding requires DecompressionStream support')
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * Decode a grayscale 16-bit PNG without passing it through an 8-bit browser image decoder.
 * PNG samples are big-endian; the returned payload is native Uint16Array data.
 */
export async function decodeUint16GrayscalePng(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer)
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (!signature.every((value, index) => bytes[index] === value)) throw new Error('Invalid PNG signature')

  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlaceMethod = 0
  const idat = []
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset)
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    const chunk = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = readUint32(chunk, 0)
      height = readUint32(chunk, 4)
      bitDepth = chunk[8]
      colorType = chunk[9]
      interlaceMethod = chunk[12]
      if (chunk[10] !== 0 || chunk[11] !== 0 || ![0, 1].includes(interlaceMethod)) {
        throw new Error('Unsupported PNG compression, filter or interlace')
      }
    } else if (type === 'IDAT') {
      idat.push(chunk)
    } else if (type === 'IEND') {
      break
    }
    offset += length + 12
  }
  if (!width || !height || bitDepth !== 16 || colorType !== 0 || !idat.length) {
    throw new Error('Expected a non-interlaced 16-bit grayscale PNG')
  }

  const compressed = new Uint8Array(idat.reduce((total, chunk) => total + chunk.length, 0))
  let compressedOffset = 0
  for (const chunk of idat) {
    compressed.set(chunk, compressedOffset)
    compressedOffset += chunk.length
  }
  const inflated = await inflatePngData(compressed)
  const bytesPerPixel = 2
  const unfiltered = new Uint8Array(height * width * bytesPerPixel)
  const passes = interlaceMethod === 1
    ? [
      [0, 0, 8, 8],
      [4, 0, 8, 8],
      [0, 4, 4, 8],
      [2, 0, 4, 4],
      [0, 2, 2, 4],
      [1, 0, 2, 2],
      [0, 1, 1, 2],
    ]
    : [[0, 0, 1, 1]]
  let sourceOffset = 0
  for (const [xStart, yStart, xStep, yStep] of passes) {
    const passWidth = width > xStart ? Math.ceil((width - xStart) / xStep) : 0
    const passHeight = height > yStart ? Math.ceil((height - yStart) / yStep) : 0
    if (!passWidth || !passHeight) continue
    const rowStride = passWidth * bytesPerPixel
    const passPixels = new Uint8Array(passHeight * rowStride)
    for (let row = 0; row < passHeight; row += 1) {
      if (sourceOffset + 1 + rowStride > inflated.length) throw new Error('Truncated PNG pixel data')
      const filter = inflated[sourceOffset]
      sourceOffset += 1
      const rowOffset = row * rowStride
      const previousOffset = rowOffset - rowStride
      for (let column = 0; column < rowStride; column += 1) {
        const raw = inflated[sourceOffset + column]
        const left = column >= bytesPerPixel ? passPixels[rowOffset + column - bytesPerPixel] : 0
        const above = row > 0 ? passPixels[previousOffset + column] : 0
        const upperLeft = row > 0 && column >= bytesPerPixel
          ? passPixels[previousOffset + column - bytesPerPixel]
          : 0
        let value = raw
        if (filter === 1) value += left
        else if (filter === 2) value += above
        else if (filter === 3) value += Math.floor((left + above) / 2)
        else if (filter === 4) value += paeth(left, above, upperLeft)
        else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}`)
        passPixels[rowOffset + column] = value & 0xff
      }
      sourceOffset += rowStride
    }
    for (let row = 0; row < passHeight; row += 1) {
      for (let column = 0; column < passWidth; column += 1) {
        const targetX = xStart + column * xStep
        const targetY = yStart + row * yStep
        const sourceIndex = row * rowStride + column * bytesPerPixel
        const targetIndex = (targetY * width + targetX) * bytesPerPixel
        unfiltered[targetIndex] = passPixels[sourceIndex]
        unfiltered[targetIndex + 1] = passPixels[sourceIndex + 1]
      }
    }
  }

  const values = new Uint16Array(width * height)
  for (let index = 0; index < values.length; index += 1) {
    const byteOffset = index * 2
    values[index] = (unfiltered[byteOffset] << 8) | unfiltered[byteOffset + 1]
  }
  return { width, height, data: values }
}

export async function loadUint16GrayscalePng(url, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable for high-tier depth data')
  const response = await fetchImpl(url)
  if (!response.ok) throw new Error(`Depth map request failed: ${response.status}`)
  return decodeUint16GrayscalePng(await response.arrayBuffer())
}

function configureImageTexture(texture, colorSpace = NoColorSpace) {
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.generateMipmaps = false
  texture.colorSpace = colorSpace
  texture.needsUpdate = true
  return texture
}

function loadTexture(url, colorSpace = NoColorSpace) {
  return new Promise((resolve, reject) => {
    new TextureLoader().load(url, texture => resolve(configureImageTexture(texture, colorSpace)), undefined, reject)
  })
}

function createFlowTarget(size) {
  const target = new WebGLRenderTarget(size.width, size.height, {
    format: RGBAFormat,
    type: UnsignedByteType,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    wrapS: ClampToEdgeWrapping,
    wrapT: ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
  })
  target.texture.colorSpace = NoColorSpace
  return target
}

export class HeadSceneRuntime {
  constructor({
    canvas,
    orientation = 'front',
    capability = 'auto',
    baseUrl = '/head-scene-v1',
    manifest = null,
    onStateChange = () => {},
  } = {}) {
    this.canvas = canvas
    this.orientation = orientation
    this.requestedCapability = capability
    this.baseUrl = baseUrl
    this.manifest = manifest
    this.onStateChange = onStateChange
    this.state = 'idle'
    this.tier = 'low'
    this.flowSize = HEAD_SCENE_FLOW_SIZES.low
    this.disposed = false
    this.renderingSuspended = false
    this.pointerUv = [0.5, 0.5]
    this.pointerInitialized = false
    this.pointerTimestamp = 0
    this.pendingStroke = null
    this.renderer = null
    this.scene = null
    this.camera = null
    this.surface = null
    this.flowMaterial = null
    this.flowScene = null
    this.flowCamera = null
    this.flowTargets = []
    this.flowReadIndex = 0
    this.assetTextures = []
    this.alignment = null
    this.rafId = 0
    this.time = 0
    this.lastFrameTimestamp = null
    this.resizeObserver = null
    this.initialFrameTimer = 0
    this.initialFrameWaitResolve = null
    this.contextLostHandler = event => {
      event.preventDefault()
      this.fallback('webgl-context-lost')
    }
  }

  async init() {
    if (this.disposed) return this
    try {
      this.manifest = this.manifest || await loadHeadSceneRuntimeManifest()
      if (this.disposed) return this
      const width = this.canvas?.clientWidth || (typeof window === 'undefined' ? 0 : window.innerWidth)
      const height = this.canvas?.clientHeight || (typeof window === 'undefined' ? 0 : window.innerHeight)
      this.tier = detectHeadSceneCapability({
        canvas: this.canvas,
        requested: this.requestedCapability,
        width,
        height,
      })
      this.flowSize = HEAD_SCENE_FLOW_SIZES[this.tier]
      this.onStateChange({
        state: 'tier-selected',
        tier: this.tier,
        backend: 'webgl2',
        preferredBackend: 'webgpu',
        activeBackend: null,
      })
      if (!this.canvas || !hasWebGl2(this.canvas)) throw new Error('WebGL2 is unavailable')

      const orientation = this.orientation === 'profile' ? 'profile' : 'front'
      const assetTier = this.tier === 'low' ? 'medium' : this.tier
      const assets = resolveHeadSceneRuntimeAssets(this.manifest, assetTier, this.baseUrl, orientation)
      const endpointTexture = await loadTexture(assets.endpoints[orientation], SRGBColorSpace)
      if (this.disposed) {
        endpointTexture.dispose()
        return this
      }
      this.assetTextures.push(endpointTexture)
      const maskTexture = await loadTexture(assets.dataMaps[`${orientation}Mask`])
      if (this.disposed) {
        maskTexture.dispose()
        return this
      }
      this.assetTextures.push(maskTexture)

      this.setupRenderer(endpointTexture, maskTexture, assets.alignment)
      this.state = 'warming'
      this.onStateChange({
        state: this.state,
        tier: this.tier,
        backend: 'webgl2',
        preferredBackend: 'webgpu',
        activeBackend: null,
      })
      await this.waitForDrawableSize()
      if (this.disposed || this.state !== 'warming' || !this.renderer) return this
      if (typeof this.renderer.compileAsync === 'function') {
        await Promise.all([
          this.renderer.compileAsync(this.flowScene, this.flowCamera),
          this.renderer.compileAsync(this.scene, this.camera),
        ])
      } else {
        this.renderer.compile?.(this.flowScene, this.flowCamera)
        this.renderer.compile?.(this.scene, this.camera)
      }
      this.renderFrame(1 / 60)
      this.assertFirstFrameIsVisible()
      this.state = 'dynamic'
      this.onStateChange({
        state: this.state,
        tier: this.tier,
        backend: 'webgl2',
        preferredBackend: 'webgpu',
        activeBackend: 'webgl2',
      })
      this.startRendering()
      return this
    } catch (error) {
      this.fallback('asset-or-shader-failure', error)
      return this
    }
  }

  setupRenderer(endpointTexture, maskTexture, alignment) {
    this.alignment = alignment
    const context = this.canvas.getContext('webgl2', { alpha: true, antialias: false, powerPreference: 'high-performance' })
    this.renderer = new WebGLRenderer({ canvas: this.canvas, context, alpha: true, antialias: false, powerPreference: 'high-performance' })
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.domElement.addEventListener('webglcontextlost', this.contextLostHandler, false)
    this.scene = new Scene()
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const geometry = new PlaneGeometry(2, 2)
    const surfaceGeometry = new PlaneGeometry(2, 2)
    this.flowTargets = [createFlowTarget(this.flowSize), createFlowTarget(this.flowSize)]
    this.flowScene = new Scene()
    this.flowCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
    this.flowMaterial = new ShaderMaterial({
      glslVersion: GLSL3,
      uniforms: {
        uPrevious: { value: this.flowTargets[0].texture },
        uMask: { value: maskTexture },
        uBrushCurrent: { value: this.pointerUv },
        uBrushPrevious: { value: this.pointerUv },
        uBrushTangent: { value: [0, 0] },
        uTexelSize: { value: [1 / this.flowSize.width, 1 / this.flowSize.height] },
        uCropScale: { value: alignment.cropScale },
        uCropOffset: { value: alignment.cropOffset },
        uStrokeActive: { value: 0 },
        uBrushSpeed: { value: 0 },
        uDeltaTime: { value: 1 / 60 },
        uAspect: { value: this.flowSize.width / this.flowSize.height },
      },
      vertexShader: FULLSCREEN_VERTEX_SHADER,
      fragmentShader: FLOW_FRAGMENT_SHADER,
    })
    const flowMesh = new Mesh(geometry, this.flowMaterial)
    this.flowScene.add(flowMesh)
    const initializeFlowMaterial = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: FULLSCREEN_VERTEX_SHADER,
      fragmentShader: FLOW_INITIALIZE_FRAGMENT_SHADER,
    })
    flowMesh.material = initializeFlowMaterial
    this.flowTargets.forEach(target => {
      this.renderer.setRenderTarget(target)
      this.renderer.render(this.flowScene, this.flowCamera)
    })
    flowMesh.material = this.flowMaterial
    initializeFlowMaterial.dispose()
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.setRenderTarget(null)
    const material = new ShaderMaterial({
      glslVersion: GLSL3,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uEndpoint: { value: endpointTexture },
        uFlow: { value: this.flowTargets[0].texture },
        uMask: { value: maskTexture },
        uCropScale: { value: alignment.cropScale },
        uCropOffset: { value: alignment.cropOffset },
        uFlowTexel: { value: [1 / this.flowSize.width, 1 / this.flowSize.height] },
      },
      vertexShader: FULLSCREEN_VERTEX_SHADER,
      fragmentShader: SURFACE_FRAGMENT_SHADER,
    })
    this.surface = new Mesh(surfaceGeometry, material)
    this.scene.add(this.surface)
    this.resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => this.resize())
      : null
    this.resizeObserver?.observe(this.canvas)
    this.resize()
  }

  waitForDrawableSize() {
    if (this.resize()) return Promise.resolve()
    const deadline = nowMilliseconds() + HEAD_SCENE_DRAWABLE_TIMEOUT_MS
    return new Promise((resolve, reject) => {
      this.initialFrameWaitResolve = resolve
      const check = () => {
        this.initialFrameTimer = 0
        if (this.disposed || this.resize()) {
          this.initialFrameWaitResolve = null
          resolve()
          return
        }
        if (nowMilliseconds() >= deadline) {
          this.initialFrameWaitResolve = null
          reject(new Error(`WebGL2 head-scene canvas stayed at zero size for ${HEAD_SCENE_DRAWABLE_TIMEOUT_MS}ms`))
          return
        }
        this.initialFrameTimer = setTimeout(check, 50)
      }
      this.initialFrameTimer = setTimeout(check, 50)
    })
  }

  resize() {
    if (!this.renderer || !this.canvas) return false
    const width = Number(this.canvas.clientWidth)
    const height = Number(this.canvas.clientHeight)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false
    this.alignment = getHeadSceneCoverAlignment(
      this.manifest,
      width,
      height,
      this.orientation,
    )
    if (this.flowMaterial) {
      this.flowMaterial.uniforms.uCropScale.value = this.alignment.cropScale
      this.flowMaterial.uniforms.uCropOffset.value = this.alignment.cropOffset
    }
    if (this.surface?.material?.uniforms) {
      this.surface.material.uniforms.uCropScale.value = this.alignment.cropScale
      this.surface.material.uniforms.uCropOffset.value = this.alignment.cropOffset
    }
    this.renderer.setPixelRatio(Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 1.5))
    this.renderer.setSize(width, height, false)
    return true
  }

  startRendering() {
    if (this.rafId || this.disposed || this.state !== 'dynamic') return
    this.lastFrameTimestamp = null
    const tick = timestamp => {
      this.rafId = 0
      if (this.disposed || this.state !== 'dynamic') return
      const deltaSeconds = this.lastFrameTimestamp === null
        ? 1 / 60
        : clamp((timestamp - this.lastFrameTimestamp) / 1000, 0, HEAD_SCENE_MAX_FRAME_DELTA_SECONDS)
      this.lastFrameTimestamp = timestamp
      if (!this.renderingSuspended) {
        this.time = timestamp / 1000
        try {
          this.renderFrame(deltaSeconds)
        } catch (error) {
          this.fallback('render-failure', error)
          return
        }
      }
      this.rafId = requestAnimationFrame(tick)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  renderFrame(deltaSeconds = 1 / 60) {
    if (!this.renderer || !this.surface || !this.flowMaterial) throw new Error('Head-scene renderer is incomplete')
    const dt = clamp(deltaSeconds, 0.001, HEAD_SCENE_MAX_FRAME_DELTA_SECONDS)
    const stroke = this.pendingStroke
    this.pendingStroke = null
    const current = stroke?.end || this.pointerUv
    const previous = stroke?.start || current
    const tangent = stroke?.tangent || [0, 0]

    const writeIndex = this.flowReadIndex === 0 ? 1 : 0
    this.flowMaterial.uniforms.uPrevious.value = this.flowTargets[this.flowReadIndex].texture
    this.flowMaterial.uniforms.uBrushCurrent.value = current
    this.flowMaterial.uniforms.uBrushPrevious.value = previous
    this.flowMaterial.uniforms.uBrushTangent.value = tangent
    this.flowMaterial.uniforms.uStrokeActive.value = stroke ? 1 : 0
    this.flowMaterial.uniforms.uBrushSpeed.value = stroke?.speed || 0
    this.flowMaterial.uniforms.uDeltaTime.value = dt
    this.renderer.setRenderTarget(this.flowTargets[writeIndex])
    this.renderer.render(this.flowScene, this.flowCamera)
    this.renderer.setRenderTarget(null)
    this.flowReadIndex = writeIndex
    this.surface.material.uniforms.uFlow.value = this.flowTargets[this.flowReadIndex].texture
    this.renderer.render(this.scene, this.camera)
  }

  assertFirstFrameIsVisible() {
    const gl = this.renderer?.getContext?.()
    if (!gl || !gl.readPixels) throw new Error('Head-scene WebGL context cannot be inspected')
    const width = gl.drawingBufferWidth
    const height = gl.drawingBufferHeight
    if (!width || !height) throw new Error('Head-scene framebuffer has no drawable size')
    const samples = [
      [0.5, 0.5],
      [0.35, 0.5],
      [0.65, 0.5],
      [0.5, 0.35],
      [0.5, 0.65],
    ]
    const pixels = new Uint8Array(4)
    for (const [xRatio, yRatio] of samples) {
      pixels.fill(0)
      gl.readPixels(
        Math.min(width - 1, Math.floor(width * xRatio)),
        Math.min(height - 1, Math.floor(height * yRatio)),
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels,
      )
      if (gl.getError() !== gl.NO_ERROR) throw new Error('Head-scene first frame readback failed')
      if (pixels[3] > 0 && (pixels[0] > 0 || pixels[1] > 0 || pixels[2] > 0)) return
    }
    throw new Error('Head-scene first frame was empty')
  }

  setPointer(pointer) {
    if (this.disposed) return false
    const surfaceUv = pointer?.surfaceUv
    if (!Array.isArray(surfaceUv) || surfaceUv.length !== 2) return false
    const nextUv = [
      clamp(Number(surfaceUv[0]) || 0, 0, 1),
      clamp(Number(surfaceUv[1]) || 0, 0, 1),
    ]
    const timestamp = Number(pointer?.timestamp) || nowMilliseconds()
    if (!this.pointerInitialized) {
      this.pointerInitialized = true
      this.pointerUv = nextUv
      this.pointerTimestamp = timestamp
      return true
    }

    const dx = nextUv[0] - this.pointerUv[0]
    const dy = nextUv[1] - this.pointerUv[1]
    const distance = Math.hypot(dx, dy)
    if (distance <= 0.0001) return true
    const elapsed = clamp((timestamp - this.pointerTimestamp) / 1000, 1 / 240, 0.08)
    const start = this.pendingStroke?.start || [...this.pointerUv]
    this.pendingStroke = {
      start,
      end: nextUv,
      tangent: [dx / distance, dy / distance],
      speed: clamp(distance / elapsed / 1.8, 0, 1),
    }
    this.pointerUv = nextUv
    this.pointerTimestamp = timestamp
    return true
  }

  resetPointer() {
    if (this.disposed) return false
    this.pointerInitialized = false
    this.pointerTimestamp = 0
    this.pendingStroke = null
    return true
  }

  suspendRendering() {
    this.renderingSuspended = true
  }

  resumeRendering() {
    this.renderingSuspended = false
    if (this.state === 'dynamic') {
      try {
        this.renderFrame(1 / 60)
      } catch (error) {
        this.fallback('render-failure', error)
      }
    }
  }

  fallback(reason, error = null) {
    if (this.disposed || this.state === 'static') return
    this.disposeGraphics()
    this.state = 'static'
    this.tier = 'low'
    this.onStateChange({
      state: this.state,
      tier: this.tier,
      backend: 'unavailable',
      preferredBackend: 'webgpu',
      activeBackend: null,
      reason,
      error,
    })
  }

  disposeGraphics() {
    if (this.rafId) cancelAnimationFrame(this.rafId)
    this.rafId = 0
    if (this.initialFrameTimer) clearTimeout(this.initialFrameTimer)
    this.initialFrameTimer = 0
    this.initialFrameWaitResolve?.()
    this.initialFrameWaitResolve = null
    this.lastFrameTimestamp = null
    this.resizeObserver?.disconnect?.()
    this.resizeObserver = null
    this.renderer?.domElement?.removeEventListener?.('webglcontextlost', this.contextLostHandler)
    this.flowTargets.forEach(target => target.dispose())
    this.flowTargets = []
    const surfaceMaterial = this.surface?.material
    const textures = [
      surfaceMaterial?.uniforms?.uEndpoint?.value,
      surfaceMaterial?.uniforms?.uMask?.value,
      ...this.assetTextures,
    ]
    Array.from(new Set(textures)).forEach(texture => texture?.dispose?.())
    this.assetTextures = []
    this.surface?.geometry?.dispose?.()
    this.surface?.material?.dispose?.()
    this.flowScene?.traverse?.(object => {
      object.geometry?.dispose?.()
      object.material?.dispose?.()
    })
    this.renderer?.dispose?.()
    this.renderer = null
    this.scene = null
    this.camera = null
    this.surface = null
    this.flowMaterial = null
    this.flowScene = null
    this.flowCamera = null
    this.alignment = null
  }

  getDiagnostics() {
    return {
      state: this.state,
      tier: this.tier,
      backend: this.state === 'dynamic' ? 'webgl2' : 'unavailable',
      preferredBackend: 'webgpu',
      activeBackend: this.state === 'dynamic' ? 'webgl2' : null,
      orientation: this.orientation,
      simulationSize: { ...this.flowSize },
      continuousRendering: Boolean(this.rafId) && !this.renderingSuspended,
      materialModel: 'mass-conserving-thin-film',
      pointerMode: 'hover-stroke',
      featureRecovery: 'bank-material-return',
      recoveryUsesOpacityFade: false,
      assetVersion: this.manifest?.assetVersion || null,
      cropSafeArea: this.manifest?.canvas?.cropSafeArea || null,
      anchors: this.manifest?.endpoints?.[this.orientation]?.anchors || null,
    }
  }

  dispose() {
    if (this.disposed) return false
    this.disposed = true
    this.disposeGraphics()
    this.onStateChange({ state: 'disposed', tier: this.tier, activeBackend: null })
    return true
  }
}

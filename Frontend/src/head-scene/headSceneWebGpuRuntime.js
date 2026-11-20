/* global GPUBufferUsage, GPUMapMode, GPUShaderStage, GPUTextureUsage */

import {
  DEFAULT_HEAD_SCENE_MANIFEST,
  getHeadSceneCoverAlignment,
  HEAD_SCENE_RUNTIME_MANIFEST_URL,
  resolveHeadSceneRuntimeAssets,
  validateHeadSceneRuntimeManifest,
} from './runtimeManifest.js'

const MAX_FRAME_DELTA_SECONDS = 0.05
const FIRST_FRAME_PROBE_BYTES_PER_ROW = 256
const SIMULATION_SIZE = Object.freeze({
  high: Object.freeze({ width: 512, height: 288 }),
  medium: Object.freeze({ width: 384, height: 216 }),
  low: Object.freeze({ width: 256, height: 144 }),
})

const COMPUTE_SHADER = /* wgsl */ `
  struct SimParams {
    stroke: vec4<f32>,
    motion: vec4<f32>,
    timing: vec4<f32>,
    crop: vec4<f32>,
  }

  @group(0) @binding(0) var previousState: texture_2d<f32>;
  @group(0) @binding(1) var nextState: texture_storage_2d<rgba16float, write>;
  @group(0) @binding(2) var faceMask: texture_2d<f32>;
  @group(0) @binding(3) var<uniform> params: SimParams;

  fn readState(coord: vec2<i32>, size: vec2<i32>) -> vec4<f32> {
    return textureLoad(previousState, clamp(coord, vec2<i32>(0), size - vec2<i32>(1)), 0);
  }

  fn readMask(uv: vec2<f32>) -> f32 {
    let size = vec2<i32>(textureDimensions(faceMask));
    let coord = clamp(vec2<i32>(uv * vec2<f32>(size)), vec2<i32>(0), size - vec2<i32>(1));
    return textureLoad(faceMask, coord, 0).r;
  }

  fn readInteractionMask(uv: vec2<f32>) -> f32 {
    let base = readMask(uv);
    let bridgeHalfSpan = vec2<f32>(0.0, 0.075);
    let enclosedFeatureHole = min(
      readMask(clamp(uv - bridgeHalfSpan, vec2<f32>(0.0), vec2<f32>(1.0))),
      readMask(clamp(uv + bridgeHalfSpan, vec2<f32>(0.0), vec2<f32>(1.0)))
    );
    return max(base, enclosedFeatureHole);
  }

  @compute @workgroup_size(8, 8)
  fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let dimensionsU = textureDimensions(previousState);
    if (id.x >= dimensionsU.x || id.y >= dimensionsU.y) {
      return;
    }

    let dimensions = vec2<i32>(dimensionsU);
    let coord = vec2<i32>(id.xy);
    let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(dimensionsU);
    let sourceUv = clamp(params.crop.zw + uv * params.crop.xy, vec2<f32>(0.001), vec2<f32>(0.999));
    let mask = readInteractionMask(sourceUv);
    let domain = smoothstep(0.04, 0.72, mask);

    if (domain <= 0.0001) {
      textureStore(nextState, coord, vec4<f32>(0.0));
      return;
    }

    let center = readState(coord, dimensions);
    let neighborhood = (
      readState(coord + vec2<i32>(1, 0), dimensions)
      + readState(coord + vec2<i32>(-1, 0), dimensions)
      + readState(coord + vec2<i32>(0, 1), dimensions)
      + readState(coord + vec2<i32>(0, -1), dimensions)
    ) * 0.25;

    let dt = clamp(params.timing.x, 0.001, 0.05);
    var displacement = mix(center.xy, neighborhood.xy, 1.0 - exp(-3.4 * dt));
    var height = mix(center.z, neighborhood.z, 1.0 - exp(-6.2 * dt));
    let ridgeMemory = mix(center.w, neighborhood.w, 1.0 - exp(-5.0 * dt));

    // At tau=0.50 the visible 0.008 groove threshold closes in about 2.1 seconds.
    displacement *= exp(-dt / 0.50);
    height *= exp(-dt / 0.50);
    // Sharp bank gloss is gone after roughly 0.65 seconds while height remains rounded.
    var wetness = ridgeMemory * exp(-dt / 0.26);

    if (params.motion.z > 0.5) {
      let aspect = max(params.timing.w, 0.001);
      let point = vec2<f32>(uv.x * aspect, uv.y);
      let segmentStart = vec2<f32>(params.stroke.z * aspect, params.stroke.w);
      let segmentEnd = vec2<f32>(params.stroke.x * aspect, params.stroke.y);
      let segment = segmentEnd - segmentStart;
      let segmentLengthSquared = max(dot(segment, segment), 0.000001);
      let along = clamp(dot(point - segmentStart, segment) / segmentLengthSquared, 0.0, 1.0);
      let nearest = segmentStart + segment * along;
      let offset = point - nearest;
      let distanceFromPath = length(offset);
      let nearestUv = vec2<f32>(nearest.x / aspect, nearest.y);
      let pathCoord = clamp(
        vec2<i32>(nearestUv * vec2<f32>(dimensionsU)),
        vec2<i32>(0),
        dimensions - vec2<i32>(1)
      );
      let pathState = readState(pathCoord, dimensions);
      let pathHeight = pathState.z;
      let strokeCapacity = smoothstep(-0.56, -0.42, pathHeight);

      var tangent = vec2<f32>(params.motion.x * aspect, params.motion.y);
      if (length(tangent) < 0.0001) {
        tangent = segment + vec2<f32>(0.0001, 0.0);
      }
      tangent = normalize(tangent);
      let normal = vec2<f32>(-tangent.y, tangent.x);
      let perpendicular = dot(offset, normal);
      let side = select(-1.0, 1.0, perpendicular >= 0.0);

      let grooveWidth = 0.058;
      let repetition = clamp(pathState.w, 0.0, 1.0);
      let radius = grooveWidth * 0.965 * mix(1.0, 1.24, repetition);
      let normalizedDistance = distanceFromPath / radius;
      var core = exp(-normalizedDistance * normalizedDistance * 2.4);
      let bankWidth = radius * 0.42;
      let bankOffset = radius * 0.72;
      let bankLeft = exp(-pow((perpendicular - bankOffset) / bankWidth, 2.0));
      let bankRight = exp(-pow((perpendicular + bankOffset) / bankWidth, 2.0));
      let cap = exp(-pow(max(abs(dot(offset, tangent)) - radius * 0.18, 0.0) / radius, 2.0) * 2.0);
      core *= cap;
      let banks = (bankLeft + bankRight) * cap;
      let bankMassScale = 0.768455;
      let pressure = -core + banks * bankMassScale;

      // Contact depth is deliberately velocity-neutral. Speed only stretches the wake.
      height = clamp(height + pressure * 0.145 * strokeCapacity, -0.56, 0.34);
      let lateralPush = normal * side * core * strokeCapacity * 0.026;
      let directionalWake = tangent * core * strokeCapacity * params.motion.w * 0.006;
      displacement = clamp(displacement + vec2<f32>(
        (lateralPush.x + directionalWake.x) / aspect,
        lateralPush.y + directionalWake.y
      ), vec2<f32>(-0.095), vec2<f32>(0.095));
      wetness = clamp(
        wetness + max(core, banks * 0.72) * strokeCapacity * 0.34,
        0.0,
        1.0
      );
    }

    let edgeWindow = smoothstep(0.0, 0.86, domain);
    displacement *= edgeWindow;
    height *= edgeWindow;
    wetness *= edgeWindow;
    textureStore(nextState, coord, vec4<f32>(displacement, height, wetness));
  }
`

const RENDER_SHADER = /* wgsl */ `
  struct RenderParams {
    crop: vec4<f32>,
    state: vec4<f32>,
  }

  struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
  }

  @group(0) @binding(0) var endpointTexture: texture_2d<f32>;
  @group(0) @binding(1) var faceMask: texture_2d<f32>;
  @group(0) @binding(2) var fluidState: texture_2d<f32>;
  @group(0) @binding(3) var linearSampler: sampler;
  @group(0) @binding(4) var<uniform> params: RenderParams;

  @vertex
  fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var positions = array<vec2<f32>, 3>(
      vec2<f32>(-1.0, -1.0),
      vec2<f32>(3.0, -1.0),
      vec2<f32>(-1.0, 3.0)
    );
    var uvs = array<vec2<f32>, 3>(
      vec2<f32>(0.0, 1.0),
      vec2<f32>(2.0, 1.0),
      vec2<f32>(0.0, -1.0)
    );
    var output: VertexOutput;
    output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
    output.uv = uvs[vertexIndex];
    return output;
  }

  fn sampleEndpoint(uv: vec2<f32>) -> vec4<f32> {
    return textureSample(endpointTexture, linearSampler, clamp(uv, vec2<f32>(0.001), vec2<f32>(0.999)));
  }

  fn sampleMask(uv: vec2<f32>) -> f32 {
    return textureSample(
      faceMask,
      linearSampler,
      clamp(uv, vec2<f32>(0.001), vec2<f32>(0.999))
    ).r;
  }

  fn sampleInteractionMask(uv: vec2<f32>) -> f32 {
    let base = sampleMask(uv);
    let bridgeHalfSpan = vec2<f32>(0.0, 0.075);
    let enclosedFeatureHole = min(
      sampleMask(uv - bridgeHalfSpan),
      sampleMask(uv + bridgeHalfSpan)
    );
    return max(base, enclosedFeatureHole);
  }

  @fragment
  fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
    let uv = clamp(input.uv, vec2<f32>(0.0), vec2<f32>(1.0));
    let sourceUv = clamp(params.crop.zw + uv * params.crop.xy, vec2<f32>(0.001), vec2<f32>(0.999));
    let base = sampleEndpoint(sourceUv);
    let mask = sampleInteractionMask(sourceUv);
    let state = textureSample(fluidState, linearSampler, uv);

    let texel = params.state.xy;
    let heightLeft = textureSample(fluidState, linearSampler, uv - vec2<f32>(texel.x, 0.0)).z;
    let heightRight = textureSample(fluidState, linearSampler, uv + vec2<f32>(texel.x, 0.0)).z;
    let heightUp = textureSample(fluidState, linearSampler, uv - vec2<f32>(0.0, texel.y)).z;
    let heightDown = textureSample(fluidState, linearSampler, uv + vec2<f32>(0.0, texel.y)).z;
    let gradient = vec2<f32>(heightRight - heightLeft, heightDown - heightUp);

    let transportedUv = clamp(sourceUv - state.xy * params.crop.xy * 1.38, vec2<f32>(0.001), vec2<f32>(0.999));
    let transported = sampleEndpoint(transportedUv);

    var bankDirection = vec2<f32>(0.0, 1.0);
    if (length(state.xy) > 0.0005) {
      bankDirection = normalize(state.xy);
    } else if (length(gradient) > 0.00001) {
      bankDirection = normalize(gradient);
    }
    let groove = smoothstep(0.008, 0.09, -state.z);
    let ridge = smoothstep(0.025, 0.24, state.z);
    // As signed height closes, both banks move inward and rebuild features spatially.
    let bankSpan = mix(0.008, 0.052, sqrt(groove));
    let bankMaterial = (
      sampleEndpoint(sourceUv + bankDirection * bankSpan * params.crop.xy)
      + sampleEndpoint(sourceUv - bankDirection * bankSpan * params.crop.xy)
    ) * 0.5;
    let bankLuma = dot(bankMaterial.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
    let milkTone = vec3<f32>(max(bankLuma, 0.80)) * vec3<f32>(1.0, 0.995, 0.985);
    let reconstructedSurface = mix(bankMaterial, vec4<f32>(milkTone, bankMaterial.a), 0.82);
    var material = mix(transported, reconstructedSurface, groove * 0.98);

    let deformation = smoothstep(0.002, 0.035, length(state.xy) + abs(state.z) * 0.38);
    let volumeShade = (
      state.z * 0.14
      + dot(gradient, normalize(vec2<f32>(-0.55, 0.84))) * 0.62
    ) * deformation;
    material = vec4<f32>(
      material.rgb * clamp(1.0 + volumeShade, 0.84, 1.16),
      material.a
    );
    material = vec4<f32>(
      material.rgb + vec3<f32>(ridge * state.w * deformation * 0.055),
      material.a
    );

    let fixedSurfaceMask = smoothstep(0.08, 0.72, mask);
    return mix(base, material, fixedSurfaceMask);
  }
`

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

function nowMilliseconds() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

function formatGpuError(error) {
  if (!error) return 'Unknown WebGPU error'
  return typeof error.message === 'string' && error.message
    ? error.message
    : String(error)
}

function wrapGpuError(label, error) {
  const wrapped = new Error(`${label}: ${formatGpuError(error)}`)
  wrapped.cause = error
  return wrapped
}

function chooseTier(requested) {
  if (requested === 'low' || requested === 'medium' || requested === 'high') return requested
  const width = typeof window === 'undefined' ? 1280 : window.innerWidth
  const memory = typeof navigator === 'undefined' ? 8 : navigator.deviceMemory || 8
  if (width < 768) return 'low'
  return width >= 1200 && memory >= 6 ? 'high' : 'medium'
}

async function loadBitmap(url) {
  const response = await fetch(url, { cache: 'force-cache' })
  if (!response.ok) throw new Error(`Head-scene image request failed: ${response.status}`)
  return createImageBitmap(await response.blob())
}

function createSampledTexture(device, bitmap, { label }) {
  const texture = device.createTexture({
    label,
    size: [bitmap.width, bitmap.height, 1],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  })
  device.queue.copyExternalImageToTexture(
    { source: bitmap },
    { texture },
    [bitmap.width, bitmap.height],
  )
  return texture
}

function createStateTexture(device, size, label) {
  return device.createTexture({
    label,
    size: [size.width, size.height, 1],
    format: 'rgba16float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST,
  })
}

export async function loadHeadSceneWebGpuManifest({
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

export class HeadSceneWebGpuRuntime {
  constructor({
    canvas,
    orientation = 'front',
    capability = 'auto',
    baseUrl = '/head-scene-v1',
    manifest = null,
    adapter = null,
    onStateChange = () => {},
  } = {}) {
    this.canvas = canvas
    this.orientation = orientation === 'profile' ? 'profile' : 'front'
    this.requestedCapability = capability
    this.baseUrl = String(baseUrl).replace(/\/$/, '')
    this.manifest = manifest
    this.onStateChange = onStateChange
    this.tier = 'low'
    this.state = 'idle'
    this.disposed = false
    this.renderingSuspended = false
    this.context = null
    this.adapter = adapter
    this.device = null
    this.canvasFormat = null
    this.endpointTexture = null
    this.maskTexture = null
    this.stateTextures = []
    this.computeBindGroups = []
    this.renderBindGroups = []
    this.computePipeline = null
    this.renderPipeline = null
    this.simulationUniformBuffer = null
    this.renderUniformBuffer = null
    this.linearSampler = null
    this.stateReadIndex = 0
    this.simulationSize = SIMULATION_SIZE.low
    this.alignment = null
    this.coverDisplaySize = null
    this.pointerInitialized = false
    this.pointerUv = [0.5, 0.5]
    this.pointerTimestamp = 0
    this.pendingStroke = null
    this.rafId = 0
    this.lastFrameTimestamp = null
    this.resizeObserver = null
    this.shaderDiagnostics = []
    this.firstFrameVerified = false
    this.firstFramePixel = null
    this.lastGpuError = null
    this.uncapturedErrorHandler = null
  }

  async init() {
    if (this.disposed) return this
    this.tier = chooseTier(this.requestedCapability)
    this.simulationSize = SIMULATION_SIZE[this.tier]
    this.onStateChange({ state: 'backend-selecting', tier: this.tier, preferredBackend: 'webgpu' })

    if (!this.canvas || typeof navigator === 'undefined' || !navigator.gpu) {
      this.fallback('webgpu-unavailable')
      return this
    }

    try {
      this.adapter = this.adapter || await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
      if (!this.adapter) throw new Error('No WebGPU adapter is available')
      this.device = await this.adapter.requestDevice()
      this.installDeviceErrorHandler()
      const activeDevice = this.device
      activeDevice.lost.then(info => {
        if (!this.disposed && this.device === activeDevice) {
          this.fallback('webgpu-device-lost', info)
        }
      })
      this.context = this.canvas.getContext('webgpu')
      if (!this.context) throw new Error('The canvas cannot create a WebGPU context')
      this.canvasFormat = navigator.gpu.getPreferredCanvasFormat()

      this.manifest = this.manifest || await loadHeadSceneWebGpuManifest()
      const assets = resolveHeadSceneRuntimeAssets(
        this.manifest,
        this.tier === 'low' ? 'medium' : this.tier,
        this.baseUrl,
        this.orientation,
      )
      this.alignment = assets.alignment
      const endpointUrl = assets.endpoints[this.orientation]
      const maskUrl = assets.dataMaps[`${this.orientation}Mask`]
      const [endpointBitmap, maskBitmap] = await Promise.all([
        loadBitmap(endpointUrl),
        loadBitmap(maskUrl),
      ])
      if (this.disposed) {
        endpointBitmap.close()
        maskBitmap.close()
        return this
      }

      this.endpointTexture = createSampledTexture(this.device, endpointBitmap, { label: 'head-endpoint' })
      this.maskTexture = createSampledTexture(this.device, maskBitmap, { label: 'head-mask' })
      endpointBitmap.close()
      maskBitmap.close()
      await this.setupGpuResources()
      if (!this.resize()) throw new Error('WebGPU head-scene canvas has no drawable area')
      await this.validateFirstFrame()
      if (this.disposed) return this

      this.state = 'dynamic'
      this.onStateChange({
        state: this.state,
        tier: this.tier,
        backend: 'webgpu',
        preferredBackend: 'webgpu',
        activeBackend: 'webgpu',
      })
      this.startRendering()
    } catch (error) {
      this.fallback('webgpu-init-failed', error)
    }
    return this
  }

  installDeviceErrorHandler() {
    if (!this.device || this.uncapturedErrorHandler) return
    this.uncapturedErrorHandler = event => {
      event.preventDefault?.()
      const error = event.error || new Error('Uncaptured WebGPU error')
      this.lastGpuError = formatGpuError(error)
      if (!this.disposed && this.device) {
        this.fallback('webgpu-uncaptured-error', error)
      }
    }
    this.device.addEventListener?.('uncapturederror', this.uncapturedErrorHandler)
  }

  async withValidationScope(label, operation) {
    const device = this.device
    if (!device) throw new Error(`${label}: WebGPU device is unavailable`)
    device.pushErrorScope('validation')
    let result
    let operationError = null
    try {
      result = await operation()
    } catch (error) {
      operationError = error
    }

    let validationError = null
    try {
      validationError = await device.popErrorScope()
    } catch (error) {
      if (!operationError) operationError = error
    }
    if (operationError) throw wrapGpuError(label, operationError)
    if (validationError) throw wrapGpuError(label, validationError)
    return result
  }

  async collectShaderDiagnostics(module, label) {
    const info = await module.getCompilationInfo()
    const messages = info.messages.map(message => ({
      shader: label,
      type: message.type,
      line: message.lineNum,
      column: message.linePos,
      offset: message.offset,
      length: message.length,
      message: message.message,
    }))
    this.shaderDiagnostics.push(...messages)
    const errors = messages.filter(message => message.type === 'error')
    if (errors.length) {
      const summary = errors
        .map(message => `${label}:${message.line}:${message.column} ${message.message}`)
        .join('\n')
      throw new Error(`WGSL compilation failed\n${summary}`)
    }
  }

  async setupGpuResources() {
    const device = this.device
    this.context.configure({
      device,
      format: this.canvasFormat,
      alphaMode: 'premultiplied',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    })
    await this.withValidationScope('WebGPU resource setup', async () => {
      this.stateTextures = [
        createStateTexture(device, this.simulationSize, 'head-fluid-state-a'),
        createStateTexture(device, this.simulationSize, 'head-fluid-state-b'),
      ]
      this.simulationUniformBuffer = device.createBuffer({
        label: 'head-fluid-simulation-params',
        size: 64,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
      this.renderUniformBuffer = device.createBuffer({
        label: 'head-fluid-render-params',
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
      this.linearSampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
      })

      const computeModule = device.createShaderModule({ label: 'head-fluid-compute', code: COMPUTE_SHADER })
      const renderModule = device.createShaderModule({ label: 'head-fluid-render', code: RENDER_SHADER })
      await Promise.all([
        this.collectShaderDiagnostics(computeModule, 'head-fluid-compute'),
        this.collectShaderDiagnostics(renderModule, 'head-fluid-render'),
      ])

      const computeBindGroupLayout = device.createBindGroupLayout({
        label: 'head-fluid-compute-bindings',
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
          {
            binding: 1,
            visibility: GPUShaderStage.COMPUTE,
            storageTexture: { access: 'write-only', format: 'rgba16float' },
          },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
          { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        ],
      })
      const renderBindGroupLayout = device.createBindGroupLayout({
        label: 'head-fluid-render-bindings',
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
          { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
          { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        ],
      })

      const [computePipeline, renderPipeline] = await Promise.all([
        device.createComputePipelineAsync({
          label: 'head-fluid-compute-pipeline',
          layout: device.createPipelineLayout({ bindGroupLayouts: [computeBindGroupLayout] }),
          compute: { module: computeModule, entryPoint: 'main' },
        }),
        device.createRenderPipelineAsync({
          label: 'head-fluid-render-pipeline',
          layout: device.createPipelineLayout({ bindGroupLayouts: [renderBindGroupLayout] }),
          vertex: { module: renderModule, entryPoint: 'vertexMain' },
          fragment: {
            module: renderModule,
            entryPoint: 'fragmentMain',
            targets: [{
              format: this.canvasFormat,
              blend: {
                color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              },
            }],
          },
          primitive: { topology: 'triangle-list' },
        }),
      ])
      this.computePipeline = computePipeline
      this.renderPipeline = renderPipeline

      this.computeBindGroups = [0, 1].map(readIndex => device.createBindGroup({
        label: `head-fluid-compute-${readIndex}`,
        layout: computeBindGroupLayout,
        entries: [
          { binding: 0, resource: this.stateTextures[readIndex].createView() },
          { binding: 1, resource: this.stateTextures[1 - readIndex].createView() },
          { binding: 2, resource: this.maskTexture.createView() },
          { binding: 3, resource: { buffer: this.simulationUniformBuffer } },
        ],
      }))
      this.renderBindGroups = [0, 1].map(stateIndex => device.createBindGroup({
        label: `head-fluid-render-${stateIndex}`,
        layout: renderBindGroupLayout,
        entries: [
          { binding: 0, resource: this.endpointTexture.createView() },
          { binding: 1, resource: this.maskTexture.createView() },
          { binding: 2, resource: this.stateTextures[stateIndex].createView() },
          { binding: 3, resource: this.linearSampler },
          { binding: 4, resource: { buffer: this.renderUniformBuffer } },
        ],
      }))

      const [scaleX, scaleY] = this.alignment.cropScale
      const [offsetX, offsetY] = this.alignment.cropOffset
      device.queue.writeBuffer(this.renderUniformBuffer, 0, new Float32Array([
        scaleX, scaleY, offsetX, offsetY,
        1 / this.simulationSize.width, 1 / this.simulationSize.height, 1, 1,
      ]))
    })
  }

  async validateFirstFrame() {
    const probeBuffer = this.device.createBuffer({
      label: 'head-fluid-first-frame-probe',
      size: FIRST_FRAME_PROBE_BYTES_PER_ROW,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })
    let mapped = false
    try {
      await this.withValidationScope('WebGPU first frame', async () => {
        this.renderFrame(1 / 60, { probeBuffer })
        await this.device.queue.onSubmittedWorkDone()
        await probeBuffer.mapAsync(GPUMapMode.READ)
        mapped = true
      })
      const pixel = new Uint8Array(probeBuffer.getMappedRange(), 0, 4)
      this.firstFramePixel = Array.from(pixel)
      if (pixel[3] <= 8) {
        throw new Error(`WebGPU first frame is transparent (${this.firstFramePixel.join(',')})`)
      }
      this.firstFrameVerified = true
    } finally {
      if (mapped) probeBuffer.unmap()
      probeBuffer.destroy()
    }
  }

  resize() {
    if (!this.canvas || !this.context) return false
    const width = Number(this.canvas.clientWidth)
    const height = Number(this.canvas.clientHeight)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false
    if (
      this.coverDisplaySize?.width !== width
      || this.coverDisplaySize?.height !== height
    ) {
      this.coverDisplaySize = { width, height }
      this.alignment = getHeadSceneCoverAlignment(
        this.manifest,
        width,
        height,
        this.orientation,
      )
      if (this.device && this.renderUniformBuffer) {
        const [scaleX, scaleY] = this.alignment.cropScale
        const [offsetX, offsetY] = this.alignment.cropOffset
        this.device.queue.writeBuffer(this.renderUniformBuffer, 0, new Float32Array([
          scaleX, scaleY, offsetX, offsetY,
          1 / this.simulationSize.width, 1 / this.simulationSize.height, 1, 1,
        ]))
      }
    }
    const dpr = Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 1.5)
    const pixelWidth = Math.max(1, Math.round(width * dpr))
    const pixelHeight = Math.max(1, Math.round(height * dpr))
    if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth
    if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight
    return true
  }

  startRendering() {
    if (this.rafId || this.disposed || this.state !== 'dynamic') return
    this.resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => this.resize())
      : null
    this.resizeObserver?.observe(this.canvas)
    const tick = timestamp => {
      this.rafId = 0
      if (this.disposed || this.state !== 'dynamic') return
      const deltaSeconds = this.lastFrameTimestamp === null
        ? 1 / 60
        : clamp((timestamp - this.lastFrameTimestamp) / 1000, 0.001, MAX_FRAME_DELTA_SECONDS)
      this.lastFrameTimestamp = timestamp
      if (!this.renderingSuspended) {
        try {
          this.renderFrame(deltaSeconds)
        } catch (error) {
          this.fallback('webgpu-render-failed', error)
          return
        }
      }
      this.rafId = requestAnimationFrame(tick)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  renderFrame(deltaSeconds = 1 / 60, { probeBuffer = null } = {}) {
    if (!this.device || !this.computePipeline || !this.renderPipeline) {
      throw new Error('WebGPU head-scene runtime is incomplete')
    }
    this.resize()
    const stroke = this.pendingStroke
    this.pendingStroke = null
    const active = stroke ? 1 : 0
    const current = stroke?.end || this.pointerUv
    const previous = stroke?.start || current
    const tangent = stroke?.tangent || [0, 0]
    const speed = stroke?.speed || 0
    const [scaleX, scaleY] = this.alignment.cropScale
    const [offsetX, offsetY] = this.alignment.cropOffset
    this.device.queue.writeBuffer(this.simulationUniformBuffer, 0, new Float32Array([
      current[0], current[1], previous[0], previous[1],
      tangent[0], tangent[1], active, speed,
      clamp(deltaSeconds, 0.001, MAX_FRAME_DELTA_SECONDS),
      1 / this.simulationSize.width,
      1 / this.simulationSize.height,
      this.simulationSize.width / this.simulationSize.height,
      scaleX, scaleY, offsetX, offsetY,
    ]))

    const writeIndex = 1 - this.stateReadIndex
    const encoder = this.device.createCommandEncoder({ label: 'head-fluid-frame' })
    const computePass = encoder.beginComputePass({ label: 'head-fluid-update' })
    computePass.setPipeline(this.computePipeline)
    computePass.setBindGroup(0, this.computeBindGroups[this.stateReadIndex])
    computePass.dispatchWorkgroups(
      Math.ceil(this.simulationSize.width / 8),
      Math.ceil(this.simulationSize.height / 8),
    )
    computePass.end()

    const currentTexture = this.context.getCurrentTexture()
    const renderPass = encoder.beginRenderPass({
      label: 'head-fluid-composite',
      colorAttachments: [{
        view: currentTexture.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    })
    renderPass.setPipeline(this.renderPipeline)
    renderPass.setBindGroup(0, this.renderBindGroups[writeIndex])
    renderPass.draw(3)
    renderPass.end()
    if (probeBuffer) {
      encoder.copyTextureToBuffer(
        {
          texture: currentTexture,
          origin: {
            x: Math.floor(this.canvas.width / 2),
            y: Math.floor(this.canvas.height / 2),
          },
        },
        {
          buffer: probeBuffer,
          bytesPerRow: FIRST_FRAME_PROBE_BYTES_PER_ROW,
        },
        [1, 1, 1],
      )
    }
    this.device.queue.submit([encoder.finish()])
    this.stateReadIndex = writeIndex
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
    const tangent = [dx / distance, dy / distance]
    const normalizedSpeed = clamp(distance / elapsed / 1.8, 0, 1)
    const start = this.pendingStroke?.start || [...this.pointerUv]
    this.pendingStroke = {
      start,
      end: nextUv,
      tangent,
      speed: normalizedSpeed,
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
    this.lastFrameTimestamp = null
  }

  fallback(reason, error = null) {
    if (this.disposed) return
    this.firstFrameVerified = false
    if (error) this.lastGpuError = formatGpuError(error)
    this.disposeGpuResources()
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

  disposeGpuResources() {
    if (this.rafId) cancelAnimationFrame(this.rafId)
    this.rafId = 0
    this.resizeObserver?.disconnect?.()
    this.resizeObserver = null
    const device = this.device
    if (device && this.uncapturedErrorHandler) {
      device.removeEventListener?.('uncapturederror', this.uncapturedErrorHandler)
    }
    this.uncapturedErrorHandler = null
    this.stateTextures.forEach(texture => texture?.destroy?.())
    this.stateTextures = []
    this.endpointTexture?.destroy?.()
    this.maskTexture?.destroy?.()
    this.simulationUniformBuffer?.destroy?.()
    this.renderUniformBuffer?.destroy?.()
    this.endpointTexture = null
    this.maskTexture = null
    this.simulationUniformBuffer = null
    this.renderUniformBuffer = null
    this.linearSampler = null
    this.computePipeline = null
    this.renderPipeline = null
    this.computeBindGroups = []
    this.renderBindGroups = []
    this.context?.unconfigure?.()
    this.context = null
    this.device = null
    this.adapter = null
  }

  getDiagnostics() {
    return {
      state: this.state,
      tier: this.tier,
      backend: this.state === 'dynamic' ? 'webgpu' : 'unavailable',
      preferredBackend: 'webgpu',
      activeBackend: this.state === 'dynamic' ? 'webgpu' : null,
      orientation: this.orientation,
      simulationSize: { ...this.simulationSize },
      continuousRendering: Boolean(this.rafId) && !this.renderingSuspended,
      firstFrameVerified: this.firstFrameVerified,
      firstFramePixel: this.firstFramePixel ? [...this.firstFramePixel] : null,
      shaderDiagnostics: this.shaderDiagnostics.map(message => ({ ...message })),
      lastGpuError: this.lastGpuError,
      canvasSize: this.canvas
        ? { width: this.canvas.width, height: this.canvas.height }
        : null,
      materialModel: 'mass-conserving-thin-film',
      pointerMode: 'hover-stroke',
      featureRecovery: 'bank-material-return',
      recoveryUsesOpacityFade: false,
      assetVersion: this.manifest?.assetVersion || null,
    }
  }

  dispose() {
    if (this.disposed) return false
    this.disposed = true
    this.disposeGpuResources()
    this.state = 'disposed'
    this.onStateChange({ state: this.state, tier: this.tier, activeBackend: null })
    return true
  }
}

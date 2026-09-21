/**
 * The post stack: everything between the inks and the swap chain.
 *
 *   clear ──► inks, ribbon among them ──► history[current] ──► bright ──► down x N ──► up x N ──► composite ──► canvas
 *                                               ▲  add                                               ▲
 *                                               └── history[other], zoomed and decayed ───────────────┘
 *
 * The inks draw into one of two floating-point history textures instead of
 * the canvas, so their brightest pixels survive past 1 and the tonemap in the
 * composite has something to roll off. The feedback pass adds the other
 * history texture back over them, warped a little, and the two swap each
 * frame. A live flow offers a velocity field and the warp then reads the last
 * frame back along that current as well.
 *
 * The ribbon is an ink that happens to be drawn here, because the line wants
 * the same uniform every other pass reads. Its pass belongs to the stack and
 * is encoded by `impls/RibbonInk.ts` in ink order, which is why `prepare`
 * exists: the uniform has to be written before any ink runs, and `render`
 * only picks the frame up afterwards.
 *
 * Like the implementations, this belongs to the renderer singleton, so the
 * pipelines, the sampler and the parameters outlive every remount. The
 * textures do not: they are sized from the canvas and rebuilt whenever that
 * size changes, which a dock or popout move always does, so the trails start
 * again from black on each move while the field itself keeps running.
 */
import { F } from '../audio/FeatureExtractor'
import { levelWaveform } from '../audio/waveform'
import type { CanvasSample, Flow } from '../scenes/Scene'
import bright from '../shaders/post.bright.wgsl?raw'
import common from '../shaders/post.common.wgsl?raw'
import composite from '../shaders/post.composite.wgsl?raw'
import down from '../shaders/post.down.wgsl?raw'
import feedback from '../shaders/post.feedback.wgsl?raw'
import reduce from '../shaders/post.reduce.wgsl?raw'
import ribbon from '../shaders/post.ribbon.wgsl?raw'
import up from '../shaders/post.up.wgsl?raw'
import { bloomActiveLevels, bloomLevelCount, bloomWeights } from './bloom'
import type { FlowCover } from './params'
import {
  bloomLevelSize,
  defaultPostParams,
  fillRibbonPoints,
  freshWeight,
  holdRuns,
  measureSizes,
  mergePostParams,
  POST_UNIFORM_FLOATS,
  RIBBON_POINTS,
  RIBBON_VERTICES,
  ribbonRuns,
  stageEnabled,
  writePostUniform,
} from './params'
import type { PostParams, PostPatch } from './params'

/**
 * A scene's brightest cores run well past 1. Half floats keep that headroom
 * and are filterable, which the blur and the warp both need. The scene renders
 * into this format rather than the canvas's, so the renderer hands it to the
 * scene as well.
 */
export const SCENE_FORMAT: GPUTextureFormat = 'rgba16float'
const BLACK: GPUColor = { r: 0, g: 0, b: 0, a: 1 }

type Target = { texture: GPUTexture; view: GPUTextureView }
type Pair<T> = readonly [T, T]

/**
 * One level of the bloom chain. Level 0 is written by the bright pass, so it
 * has nothing above it to read; the last has nothing below it to add.
 */
type Level = {
  target: Target
  /** Reads the level above and halves it into this one; absent on level 0. */
  down: GPUBindGroup | null
  /** Reads the level below and adds it into this one; absent on the last. */
  up: GPUBindGroup | null
}

type Gear = {
  device: GPUDevice
  sampler: GPUSampler
  uniform: GPUBuffer
  feedback: GPURenderPipeline
  /**
   * Named rather than derived, because the feedback group is rebuilt every
   * frame and a derived layout holds only the bindings the shader happens to
   * read; see "Adding a scene" in the README for what that cost last time.
   */
  feedbackLayout: GPUBindGroupLayout
  /**
   * The bright, down and up passes' one group: the uniform, the sampler and
   * the texture to read. Named, so the three pipelines share it and every group
   * built per resize fits any of them; only the bright pass reads the uniform,
   * and a layout derived from the down shader would leave it out.
   */
  bloomLayout: GPUBindGroupLayout
  /** One zero texel, bound as the flow when the scene offers none. */
  still: GPUTextureView
  stillTexture: GPUTexture
  /** The ladder that measures the frame's mean; see post.reduce.wgsl. */
  measure: GPURenderPipeline
  measureLayout: GPUBindGroupLayout
  ribbon: GPURenderPipeline
  /** The uniform and the points, bound once: neither buffer is ever replaced. */
  ribbonGroup: GPUBindGroup
  /** The waveform's points, `RIBBON_POINTS` floats, sized once. */
  ribbonPoints: GPUBuffer
  bright: GPURenderPipeline
  /** Halves a level into the next. Replaces what is there. */
  down: GPURenderPipeline
  /**
   * The same shader, for the last level the chain runs: the blend scales it by
   * what that level is worth, since nothing is added to it to do that later.
   */
  downScaled: GPURenderPipeline
  /** Adds a level into the one above it, keeping a share of what that one held. */
  up: GPURenderPipeline
  composite: GPURenderPipeline
}

type Sized = {
  width: number
  height: number
  history: Pair<Target>
  levels: Level[]
  /** What each level is worth this frame, worked out into this array. */
  weights: Float32Array
  bright: Pair<GPUBindGroup>
  composite: Pair<GPUBindGroup>
  /**
   * The feedback group for each history texture it can read, keyed by the two
   * views that alternate under it: the flow and the measured mean. Built the
   * first frame each pairing is seen and never after, so a frame allocates
   * nothing; it is the size's, since the history views are.
   */
  feedback: Pair<WeakMap<GPUTextureView, WeakMap<GPUTextureView, GPUBindGroup>>>
  /** The measuring ladder, quartering each way until one texel is left. */
  measure: Measure
}

type Measure = {
  rungs: Target[]
  /** The first rung, one group per history texture, since which is read alternates. */
  first: Pair<GPUBindGroup>
  /** Every rung after the first, each reading the one above it. */
  rest: GPUBindGroup[]
}

export class PostStack {
  private gear: Gear | null = null
  private sized: Sized | null = null
  private current: 0 | 1 = 0
  private settings = defaultPostParams()
  private readonly uniformData = new Float32Array(POST_UNIFORM_FLOATS)
  // The points are made here, on the CPU, and only when the ribbon draws.
  private readonly ribbonData = new Float32Array(RIBBON_POINTS)
  /** The loudest recent sample, which the line is scaled against. */
  private ribbonPeak = 0

  init(device: GPUDevice, format: GPUTextureFormat) {
    const module = (code: string) => {
      const shader = device.createShaderModule({ code: common + code })
      void shader.getCompilationInfo().then((info) => {
        for (const message of info.messages) {
          if (message.type === 'error')
            console.error(`WGSL ${message.lineNum}:${message.linePos} ${message.message}`)
        }
      })

      return shader
    }

    // Every pass is one oversized triangle from `vs` in post.common.wgsl but
    // the ribbon's, which brings its own vertex entry point and a strip.
    const pipeline = (
      code: string,
      target: GPUColorTargetState,
      group?: GPUBindGroupLayout,
      shape: { vertex: string; topology: GPUPrimitiveTopology } = {
        vertex: 'vs',
        topology: 'triangle-list',
      },
    ) => {
      const shader = module(code)
      return device.createRenderPipeline({
        layout: group ? device.createPipelineLayout({ bindGroupLayouts: [group] }) : 'auto',
        vertex: { module: shader, entryPoint: shape.vertex },
        fragment: { module: shader, entryPoint: 'fs', targets: [target] },
        primitive: { topology: shape.topology },
      })
    }

    // The flow view alternates every frame, so this group cannot be built
    // once per resize the way the others are. Naming its layout means the
    // group survives the shader ever dropping a binding it reads.
    const texture = { sampleType: 'float' } as const
    const feedbackLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture },
      ],
    })

    const bloomLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture },
      ],
    })

    // The chain's weights are applied by the blend, so each pass carries the
    // constant it needs and no uniform is written for them. The last level's
    // scale is `constant * source`; every other level is scaled where it is
    // added into, `source + constant * destination`, which is the level's own
    // weight and never over 1, so the constant is always one a blend may hold.
    const replace: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'zero', operation: 'add' }
    const scaled: GPUBlendState = {
      color: { srcFactor: 'constant', dstFactor: 'zero', operation: 'add' },
      alpha: replace,
    }
    const added: GPUBlendState = {
      color: { srcFactor: 'one', dstFactor: 'constant', operation: 'add' },
      alpha: replace,
    }

    // The measuring ladder reads no uniform: a rung takes its source's size
    // from the texture itself, so one pipeline covers every rung and the two
    // history textures alike. Its layout is named for the same reason the
    // feedback one is, since the rung groups are built per resize.
    const measureLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture },
      ],
    })

    // One zero texel for the scenes that solve no field. Half floats, like
    // every flow, so one bind group layout covers both cases; zeroed by hand
    // rather than by trusting the implicit clear.
    const stillTexture = device.createTexture({
      size: { width: 1, height: 1 },
      format: SCENE_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    device.queue.writeTexture(
      { texture: stillTexture },
      new Uint8Array(8),
      { bytesPerRow: 8 },
      { width: 1, height: 1 },
    )

    // The ribbon's two buffers are made here and never again, and its bind
    // group with them, since neither buffer is ever replaced. The layout is
    // named for the reason the feedback one is. The vertex stage reads both
    // of them: the points to place the line and the uniform to size it.
    const uniform = device.createBuffer({
      size: POST_UNIFORM_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    const ribbonPoints = device.createBuffer({
      size: RIBBON_POINTS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    const ribbonLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    })

    this.gear = {
      device,
      // Linear and clamped: the warp, the downsamples and the blur all rely on
      // the hardware filtering, and a trail must not wrap at the edge.
      sampler: device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
      }),
      uniform,
      // The scene has already drawn into the target, so the history is added
      // to it rather than read back and mixed. The constant is the weight on
      // that new frame, which keeps the sum the same at any frame rate.
      feedback: pipeline(
        feedback,
        {
          format: SCENE_FORMAT,
          blend: {
            color: { srcFactor: 'one', dstFactor: 'constant', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          },
        },
        feedbackLayout,
      ),
      feedbackLayout,
      measure: pipeline(reduce, { format: SCENE_FORMAT }, measureLayout),
      measureLayout,
      still: stillTexture.createView(),
      stillTexture,
      // Light added to what the scene drew and nothing else: the alpha is
      // left where it was.
      ribbon: pipeline(
        ribbon,
        {
          format: SCENE_FORMAT,
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
          },
        },
        ribbonLayout,
        { vertex: 'strip', topology: 'triangle-strip' },
      ),
      ribbonGroup: device.createBindGroup({
        layout: ribbonLayout,
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: { buffer: ribbonPoints } },
        ],
      }),
      ribbonPoints,
      bloomLayout,
      bright: pipeline(bright, { format: SCENE_FORMAT }, bloomLayout),
      down: pipeline(down, { format: SCENE_FORMAT }, bloomLayout),
      downScaled: pipeline(down, { format: SCENE_FORMAT, blend: scaled }, bloomLayout),
      up: pipeline(up, { format: SCENE_FORMAT, blend: added }, bloomLayout),
      composite: pipeline(composite, { format }),
    }
  }

  get params(): PostParams {
    return this.settings
  }

  /** Apply a patch. The development handle sets one stage at a time this way. */
  setParams(patch: PostPatch) {
    this.settings = mergePostParams(this.settings, patch)
  }

  /**
   * Draw from this object from now on, rather than a copy of it. The renderer
   * rewrites it every frame from the preset and its audio mapping, and a
   * clone per frame would be thrown away on the next one.
   */
  useParams(params: PostParams) {
    this.settings = params
  }

  /**
   * Where the inks should draw this frame, sizing the textures first. They
   * always go through the stack, even with every stage off, because the
   * canvas is written in the composite and nowhere else.
   */
  target(width: number, height: number): GPUTextureView | null {
    if (!this.gear) return null
    this.resize(width, height)
    return this.sized?.history[this.current].view ?? null
  }

  /**
   * The shared target emptied, before any ink draws. Every ink adds light to
   * what is there, so something has to start the frame at black; it is also
   * what stops a frame in which no ink drew at all from being summed into
   * itself by the feedback pass for ever.
   */
  clear(encoder: GPUCommandEncoder, view: GPUTextureView) {
    encoder
      .beginRenderPass({
        colorAttachments: [{ view, clearValue: BLACK, loadOp: 'clear', storeOp: 'store' }],
      })
      .end()
  }

  /**
   * The uniform every pass reads, written once a frame. It cannot wait for
   * `render`, because the ribbon ink encodes its pass before that and reads
   * the same block; `cover` is the live flow's, or null when nothing carries
   * the picture.
   */
  prepare(features: Float32Array, cover: FlowCover | null = null) {
    const gear = this.gear
    const sized = this.sized
    if (!gear || !sized) return
    writePostUniform(this.settings, features, sized.width, sized.height, this.uniformData, cover)
    gear.device.queue.writeBuffer(gear.uniform, 0, this.uniformData)
  }

  /**
   * The waveform drawn as a line into the shared target, which is the ribbon
   * ink's pass. It is here rather than in the ink because the line reads the
   * stack's own uniform and its points buffer is made once at start-up; the
   * ink decides when it runs and in what order. With no samples yet, or with
   * the stage off, nothing is drawn and nothing is uploaded.
   */
  drawRibbon(
    encoder: GPUCommandEncoder,
    view: GPUTextureView,
    features: Float32Array,
    waveform: Float32Array | null,
  ) {
    const gear = this.gear
    if (!gear || !waveform || !ribbonRuns(this.settings)) return
    fillRibbonPoints(waveform, this.ribbonData)
    // Levelled against its own recent peak, so the line is as tall at a
    // tenth of the volume as at full.
    this.ribbonPeak = levelWaveform(this.ribbonData, this.ribbonPeak, features[F.dt] ?? 0)
    gear.device.queue.writeBuffer(gear.ribbonPoints, 0, this.ribbonData)
    draw(encoder, gear.ribbon, gear.ribbonGroup, view, 'load', undefined, RIBBON_VERTICES)
  }

  /** Discard the old scene's trails without reallocating its textures. */
  resetHistory() {
    this.historyReady = false
  }

  /**
   * Last frame's canvas, for an ink that wants to read the picture: the half
   * of the ping-pong the inks are NOT drawing into this frame, which is
   * exactly what the composite last wrote. Null until a frame has been
   * composited, so an ink reading it draws nothing on the first frame of a
   * scene rather than sampling an uninitialised texture.
   *
   * It is a read of the other half and never of the one in `target`, so an ink
   * binding it while drawing into the shared target is not reading the texture
   * it is writing, which no backend allows.
   *
   * The contract an ink takes on with it is in `SceneContext.canvas`: one
   * frame of latency, and a loop it has to stay out of.
   */
  get lastCanvas(): CanvasSample | null {
    const sized = this.sized
    if (!sized || !this.historyReady) return null
    const other = this.current === 0 ? 1 : 0
    const view = sized.history[other]?.view
    return view ? { view, width: sized.width, height: sized.height } : null
  }

  private historyReady = false

  /**
   * Run the stack over what the inks drew and write `view`. `prepare` has
   * already written the uniform this reads, because the ribbon ink needed it.
   * `flow` is the field the live flows left, passed in each frame rather than
   * held, since which of a ping-pong pair it names alternates.
   */
  render(
    encoder: GPUCommandEncoder,
    view: GPUTextureView,
    features: Float32Array,
    flow: Flow | null = null,
  ) {
    const gear = this.gear
    const sized = this.sized
    if (!gear || !sized) return
    const other = this.current === 0 ? 1 : 0

    if (this.historyReady && stageEnabled(this.settings, 'feedback')) {
      const into = sized.history[this.current].view
      const fresh = freshWeight(this.settings, features)
      // The frame the pass is about to read, reduced to one texel, and only
      // when a cast asks the canvas to hold a mean: with the hold off nothing
      // reads the texel, so nothing is drawn for it and a zeroed one is bound
      // in its place. It measures history[other], which is exactly what the
      // pass reads back, so the hold answers this frame and not the last.
      const measured = this.measure(encoder, sized, other)
      draw(
        encoder,
        gear.feedback,
        this.feedbackGroup(gear, sized, other, flow?.view ?? gear.still, measured),
        into,
        'load',
        fresh,
      )
    }

    if (stageEnabled(this.settings, 'bloom')) this.bloom(encoder, gear, sized)

    draw(encoder, gear.composite, sized.composite[this.current], view, 'clear')
    // The frame just drawn becomes next frame's history.
    this.current = other
    this.historyReady = true
  }

  /**
   * The feedback pass's group for this pairing of flow and measured mean. Both
   * alternate frame to frame, and the history it reads does too, so there is a
   * handful of pairings in all and each is built once, the first frame it is
   * seen. The cache holds the flow's view weakly, so a rebuilt fluid's views
   * are not kept alive here.
   */
  private feedbackGroup(
    gear: Gear,
    sized: Sized,
    which: 0 | 1,
    flow: GPUTextureView,
    measured: GPUTextureView,
  ): GPUBindGroup {
    const byFlow = sized.feedback[which]
    let byMeasured = byFlow.get(flow)
    if (!byMeasured) {
      byMeasured = new WeakMap()
      byFlow.set(flow, byMeasured)
    }

    let group = byMeasured.get(measured)
    if (!group) {
      group = gear.device.createBindGroup({
        layout: gear.feedbackLayout,
        entries: [
          { binding: 0, resource: { buffer: gear.uniform } },
          { binding: 1, resource: gear.sampler },
          { binding: 2, resource: sized.history[which].view },
          { binding: 3, resource: flow },
          { binding: 4, resource: measured },
        ],
      })
      byMeasured.set(measured, group)
    }

    return group
  }

  /**
   * The bloom chain: the bright pass into level 0, a downsample from each level
   * into the next, then an upsample from the smallest back up that adds each
   * level into the one above. What is left in level 0 is the whole glow, every
   * level already worth what `bloomWeights` says, and the composite reads only
   * that.
   *
   * The weights are applied by the blend, with no uniform. Going down, the
   * last level the chain runs is scaled as it is written. Going up, the level
   * being added into is kept at its own weight, so `up[i] = tent(up[i + 1]) +
   * weight[i] * down[i]`, with the chain's last level standing in for
   * `up[last]`. A level is only added into after it has been read downward, so
   * the same texture serves both ways and there is no second set.
   *
   * A level too small to matter is not run, so at a radius of 0 the chain is
   * the three tight levels and costs about what the bloom cost before it had
   * a radius; the wide levels are paid for only as the radius asks for them.
   */
  private bloom(encoder: GPUCommandEncoder, gear: Gear, sized: Sized) {
    const first = sized.levels[0]
    if (!first) return
    const weights = bloomWeights(this.settings.bloom, sized.weights)
    const active = bloomActiveLevels(weights)
    if (active === 0) {
      // Nothing to add, and the composite reads level 0 whatever it holds.
      this.clear(encoder, first.target.view)
      return
    }

    draw(encoder, gear.bright, sized.bright[this.current], first.target.view, 'clear')
    const last = active - 1
    for (let index = 1; index <= last; index++) {
      const level = sized.levels[index]
      if (!level?.down) continue
      if (index === last)
        draw(encoder, gear.downScaled, level.down, level.target.view, 'clear', weights[index])
      else draw(encoder, gear.down, level.down, level.target.view, 'clear')
    }

    for (let index = last - 1; index >= 0; index--) {
      const level = sized.levels[index]
      if (level?.up) draw(encoder, gear.up, level.up, level.target.view, 'load', weights[index])
    }
  }

  /**
   * The mean brightness of one history texture, on the GPU and in one texel,
   * or a zeroed texel when no cast is holding the canvas. Each rung quarters
   * the one above it, so the cost is a fraction of a bloom level and nothing
   * ever comes back to the CPU.
   */
  private measure(encoder: GPUCommandEncoder, sized: Sized, which: 0 | 1): GPUTextureView {
    const gear = this.gear
    const last = sized.measure.rungs.at(-1)
    if (!gear || !last || !holdRuns(this.settings)) return gear?.still ?? sized.history[which].view
    const first = sized.measure.rungs[0]
    if (!first) return gear.still
    draw(encoder, gear.measure, sized.measure.first[which], first.view, 'clear')
    for (const [index, group] of sized.measure.rest.entries()) {
      const into = sized.measure.rungs[index + 1]
      if (into) draw(encoder, gear.measure, group, into.view, 'clear')
    }

    return last.view
  }

  /** Rebuild every texture for a new canvas size. The trails restart. */
  private resize(width: number, height: number) {
    const gear = this.gear
    if (!gear || (this.sized?.width === width && this.sized.height === height)) return
    this.release()
    const { device } = gear
    const make = (w: number, h: number): Target => {
      const texture = device.createTexture({
        size: { width: Math.max(1, w), height: Math.max(1, h) },
        format: SCENE_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      })

      return { texture, view: texture.createView() }
    }

    const history: Pair<Target> = [make(width, height), make(width, height)]
    const count = bloomLevelCount(width, height)
    const targets: Target[] = []
    for (let index = 0; index < count; index++) {
      const size = bloomLevelSize(width, height, index)
      targets.push(make(size.width, size.height))
    }

    // Every bloom group reads one texture through the one named layout: a
    // level's down group reads the level above it, its up group the level below.
    const read = (source: GPUTextureView) =>
      device.createBindGroup({
        layout: gear.bloomLayout,
        entries: [
          { binding: 0, resource: { buffer: gear.uniform } },
          { binding: 1, resource: gear.sampler },
          { binding: 2, resource: source },
        ],
      })

    const levels: Level[] = targets.map((target, index) => ({
      target,
      down: index === 0 ? null : read((targets[index - 1] ?? target).view),
      up: index === count - 1 ? null : read((targets[index + 1] ?? target).view),
    }))

    // One bind group per history texture the scene might have drawn into.
    // The feedback pass is not among them; its group is built per frame,
    // above, because the flow it also reads alternates.
    const forHistory = (build: (drawn: Target) => GPUBindGroup): Pair<GPUBindGroup> => [
      build(history[0]),
      build(history[1]),
    ]

    // The composite reads level 0 alone: the chain has already added the rest.
    const glow = levels[0]?.target.view

    // The measuring ladder, quartering each way until a single texel is left.
    // It hangs off the history rather than off the last bloom level, which the
    // canvas plan suggested: the bloom levels hold what the bright pass let
    // through, and the thing the hold is there to catch, an even mid haze
    // under the threshold, reads as nothing there.
    const rungs = measureSizes(width, height).map((size) => make(size.width, size.height))
    const rung = (source: GPUTextureView): GPUBindGroup =>
      gear.device.createBindGroup({
        layout: gear.measureLayout,
        entries: [
          { binding: 0, resource: gear.sampler },
          { binding: 1, resource: source },
        ],
      })

    this.sized = {
      width,
      height,
      history,
      levels,
      weights: new Float32Array(count),
      feedback: [new WeakMap(), new WeakMap()],
      measure: {
        rungs,
        first: forHistory((drawn) => rung(drawn.view)),
        rest: rungs.slice(0, -1).map((source) => rung(source.view)),
      },
      bright: forHistory((drawn) => read(drawn.view)),
      composite: forHistory((drawn) =>
        gear.device.createBindGroup({
          layout: gear.composite.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: gear.uniform } },
            { binding: 1, resource: gear.sampler },
            { binding: 2, resource: drawn.view },
            ...(glow ? [{ binding: 3, resource: glow }] : []),
          ],
        }),
      ),
    }
  }

  private release() {
    this.historyReady = false
    const sized = this.sized
    if (!sized) return
    for (const target of sized.history) target.texture.destroy()
    for (const rung of sized.measure.rungs) rung.texture.destroy()
    for (const level of sized.levels) level.target.texture.destroy()
    this.sized = null
  }

  /** The device is gone or going: drop everything that belonged to it. */
  dispose() {
    this.release()
    this.gear?.uniform.destroy()
    this.gear?.ribbonPoints.destroy()
    this.gear?.stillTexture.destroy()
    this.gear = null
  }
}

function draw(
  encoder: GPUCommandEncoder,
  pipeline: GPURenderPipeline,
  group: GPUBindGroup,
  view: GPUTextureView,
  loadOp: GPULoadOp,
  blendConstant?: number,
  vertices = 3,
) {
  const pass = encoder.beginRenderPass({
    colorAttachments: [{ view, clearValue: BLACK, loadOp, storeOp: 'store' }],
  })
  pass.setPipeline(pipeline)
  if (blendConstant !== undefined)
    pass.setBlendConstant({ r: blendConstant, g: blendConstant, b: blendConstant, a: 1 })
  pass.setBindGroup(0, group)
  pass.draw(vertices)
  pass.end()
}

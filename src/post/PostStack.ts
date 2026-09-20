/**
 * The post stack: everything between the scene and the swap chain.
 *
 *   scene ──► ribbon ──► history[current] ──► bright ──► blur x3 ──► composite ──► canvas
 *                              ▲  add                                    ▲
 *                              └── history[other], zoomed and decayed ────┘
 *
 * The scene draws into one of two floating-point history textures instead of
 * the canvas, so its brightest pixels survive past 1 and the tonemap in the
 * composite has something to roll off. The ribbon, when a preset turns it on,
 * draws the sound as a line into that same texture, so it is fresh light like
 * the scene's and the trails carry it. The feedback pass adds the other
 * history texture back over both, warped a little, and the two swap each
 * frame. A scene that solves a velocity field may offer it as its `flow`, and
 * the warp then reads the last frame back along that current as well.
 *
 * Like the scene, this belongs to the renderer singleton, so the pipelines,
 * the sampler and the parameters outlive every remount. The textures do not:
 * they are sized from the canvas and rebuilt whenever that size changes,
 * which a dock or popout move always does, so the trails start again from
 * black on each move while the simulation itself keeps running.
 */
import type { Flow } from '../scenes/Scene'
import blur from '../shaders/post.blur.wgsl?raw'
import bright from '../shaders/post.bright.wgsl?raw'
import common from '../shaders/post.common.wgsl?raw'
import composite from '../shaders/post.composite.wgsl?raw'
import feedback from '../shaders/post.feedback.wgsl?raw'
import ribbon from '../shaders/post.ribbon.wgsl?raw'
import {
  BLOOM_LEVELS,
  bloomLevelSize,
  bloomSourceSize,
  defaultPostParams,
  fillRibbonPoints,
  freshWeight,
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
const BLUR_STEP_BYTES = 16
const BLACK: GPUColor = { r: 0, g: 0, b: 0, a: 1 }

type Target = { texture: GPUTexture; view: GPUTextureView }
type Pair<T> = readonly [T, T]

type Level = {
  target: Target
  temp: Target
  /** Reads the level above into this level's temp, halving it. */
  horizontal: GPUBindGroup
  /** Reads this level's temp back into the level. */
  vertical: GPUBindGroup
  steps: Pair<GPUBuffer>
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
  /** One zero texel, bound as the flow when the scene offers none. */
  still: GPUTextureView
  stillTexture: GPUTexture
  ribbon: GPURenderPipeline
  /** The uniform and the points, bound once: neither buffer is ever replaced. */
  ribbonGroup: GPUBindGroup
  /** The waveform's points, `RIBBON_POINTS` floats, sized once. */
  ribbonPoints: GPUBuffer
  bright: GPURenderPipeline
  blur: GPURenderPipeline
  composite: GPURenderPipeline
}

type Sized = {
  width: number
  height: number
  history: Pair<Target>
  levels: Level[]
  bright: Pair<GPUBindGroup>
  composite: Pair<GPUBindGroup>
}

export class PostStack {
  private gear: Gear | null = null
  private sized: Sized | null = null
  private current: 0 | 1 = 0
  private settings = defaultPostParams()
  private readonly uniformData = new Float32Array(POST_UNIFORM_FLOATS)
  // The points are made here, on the CPU, and only when the ribbon draws.
  private readonly ribbonData = new Float32Array(RIBBON_POINTS)

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
      bright: pipeline(bright, { format: SCENE_FORMAT }),
      blur: pipeline(blur, { format: SCENE_FORMAT }),
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
   * Where the scene should draw this frame, sizing the textures first. The
   * scene always goes through the stack, even with every stage off, because
   * the canvas is written in the composite and nowhere else.
   */
  target(width: number, height: number): GPUTextureView | null {
    if (!this.gear) return null
    this.resize(width, height)
    return this.sized?.history[this.current].view ?? null
  }

  /** Discard the old scene's trails without reallocating its textures. */
  resetHistory() {
    this.historyReady = false
  }

  private historyReady = false

  /**
   * Run the stack over what the scene drew and write `view`. `flow` is the
   * velocity field the scene is solving, if it solves one; it is passed in
   * each frame rather than held, since which of a ping-pong pair it names
   * alternates. `waveform` is the analyser's newest samples for the ribbon;
   * with none, or with the ribbon off, nothing is drawn and nothing uploaded.
   */
  render(
    encoder: GPUCommandEncoder,
    view: GPUTextureView,
    features: Float32Array,
    flow: Flow | null = null,
    waveform: Float32Array | null = null,
  ) {
    const gear = this.gear
    const sized = this.sized
    if (!gear || !sized) return
    const other = this.current === 0 ? 1 : 0
    const cover = flow?.cover ?? null
    writePostUniform(this.settings, features, sized.width, sized.height, this.uniformData, cover)
    gear.device.queue.writeBuffer(gear.uniform, 0, this.uniformData)

    // Before the feedback pass, into the same texture as the scene: the pass
    // adds the history to whatever is there, so the line is fresh light and
    // rides the trail from this frame on.
    if (waveform && ribbonRuns(this.settings)) {
      fillRibbonPoints(waveform, this.ribbonData)
      gear.device.queue.writeBuffer(gear.ribbonPoints, 0, this.ribbonData)
      draw(
        encoder,
        gear.ribbon,
        gear.ribbonGroup,
        sized.history[this.current].view,
        'load',
        undefined,
        RIBBON_VERTICES,
      )
    }

    if (this.historyReady && stageEnabled(this.settings, 'feedback')) {
      const into = sized.history[this.current].view
      const fresh = freshWeight(this.settings, features)
      // One bind group a frame, because the flow alternates and the history
      // it reads does too. It is four bindings and no allocation on the GPU,
      // which is well under what the pass itself costs.
      const group = gear.device.createBindGroup({
        layout: gear.feedbackLayout,
        entries: [
          { binding: 0, resource: { buffer: gear.uniform } },
          { binding: 1, resource: gear.sampler },
          { binding: 2, resource: sized.history[other].view },
          { binding: 3, resource: flow?.view ?? gear.still },
        ],
      })
      draw(encoder, gear.feedback, group, into, 'load', fresh)
    }

    if (stageEnabled(this.settings, 'bloom')) {
      const first = sized.levels[0]
      if (first) {
        draw(encoder, gear.bright, sized.bright[this.current], first.target.view, 'clear')
        for (const level of sized.levels) {
          draw(encoder, gear.blur, level.horizontal, level.temp.view, 'clear')
          draw(encoder, gear.blur, level.vertical, level.target.view, 'clear')
        }
      }
    }

    draw(encoder, gear.composite, sized.composite[this.current], view, 'clear')
    // The frame just drawn becomes next frame's history.
    this.current = other
    this.historyReady = true
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
    const levels: Level[] = []
    for (let index = 0; index < BLOOM_LEVELS; index++) {
      const size = bloomLevelSize(width, height, index)
      const target = make(size.width, size.height)
      const temp = make(size.width, size.height)
      // The horizontal pass reads the texture named by bloomSourceSize, so
      // its taps are spaced by that texture's texels; the vertical pass stays
      // inside this level.
      const from = bloomSourceSize(width, height, index)
      const steps: Pair<GPUBuffer> = [
        blurStep(device, 1 / from.width, 1 / from.height, 1, 0),
        blurStep(device, 1 / size.width, 1 / size.height, 0, 1),
      ]
      const source = index === 0 ? target : (levels[index - 1]?.target ?? target)
      levels.push({
        target,
        temp,
        horizontal: device.createBindGroup({
          layout: gear.blur.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: steps[0] } },
            { binding: 1, resource: gear.sampler },
            { binding: 2, resource: source.view },
          ],
        }),
        vertical: device.createBindGroup({
          layout: gear.blur.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: steps[1] } },
            { binding: 1, resource: gear.sampler },
            { binding: 2, resource: temp.view },
          ],
        }),
        steps,
      })
    }

    // One bind group per history texture the scene might have drawn into.
    // The feedback pass is not among them; its group is built per frame,
    // above, because the flow it also reads alternates.
    const forHistory = (build: (drawn: Target) => GPUBindGroup): Pair<GPUBindGroup> => [
      build(history[0]),
      build(history[1]),
    ]

    const bloomViews = levels.map((level, index) => ({
      binding: 3 + index,
      resource: level.target.view,
    }))

    this.sized = {
      width,
      height,
      history,
      levels,
      bright: forHistory((drawn) =>
        gear.device.createBindGroup({
          layout: gear.bright.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: gear.uniform } },
            { binding: 1, resource: gear.sampler },
            { binding: 2, resource: drawn.view },
          ],
        }),
      ),
      composite: forHistory((drawn) =>
        gear.device.createBindGroup({
          layout: gear.composite.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: gear.uniform } },
            { binding: 1, resource: gear.sampler },
            { binding: 2, resource: drawn.view },
            ...bloomViews,
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
    for (const level of sized.levels) {
      level.target.texture.destroy()
      level.temp.texture.destroy()
      for (const step of level.steps) step.destroy()
    }
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

function blurStep(device: GPUDevice, x: number, y: number, dx: number, dy: number) {
  const buffer = device.createBuffer({
    size: BLUR_STEP_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(buffer, 0, new Float32Array([x, y, dx, dy]))
  return buffer
}

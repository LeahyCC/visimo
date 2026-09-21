/**
 * One compute-simulated pool of particles, which is the implementation behind
 * every field study there is. It replaces two CPU pools of under two hundred
 * flat quads with a pool a knob takes from ten thousand to half a million,
 * living in storage buffers that nothing ever reads back.
 *
 *   clear_grid ─► bin ─► step ─► one instanced draw
 *
 * The CPU's whole part in a frame is the uniform: the knobs, the palette at
 * the key, and where in the ring buffer this frame's spawns land. Nothing is
 * allocated per frame, nothing is uploaded but that one block, and nothing
 * comes back. A study at presence 0 is not called at all, and a field with no
 * count, no light or no size encodes no pass and dispatches nothing either
 * (`fieldRuns`), so a field that is cast but has nothing to say costs a few
 * dozen multiplications.
 *
 * What makes it a field rather than a sprite pool is that it reads the live
 * flow. `SceneContext.flow` hands over whatever the flows blended to this
 * frame, and a particle takes the share of it that `flow` names, so a burst
 * bends along the current that is stirring the canvas rather than sitting on
 * top of it. With no flow in the cast the binding is one zero texel and the
 * term vanishes.
 *
 * **Name the bind group layouts.** There are two, and both are written out
 * rather than derived: the compute half wants the pool as read_write storage
 * and the vertex half wants it read-only, so they cannot even share a module,
 * and a derived layout would hold only the bindings a shader happened to read.
 * The README says what that cost the particle scene that was here before.
 *
 * Two studies are profiles over this one class (`particles.params.ts`), which
 * is what "sparks and dust are knob sets" means: the dust is a wrapping field
 * of slow pale specks on a curl, and the sparks are ring bursts thrown off the
 * treble's hits. Neither has an implementation of its own any more.
 */
import type { Tuning } from '../presets/knobs'
import { INK_BLEND } from '../scenes/Impl'
import type { InkImpl } from '../scenes/Impl'
import type { SceneContext } from '../scenes/Scene'
import common from '../shaders/particles.common.wgsl?raw'
import draw from '../shaders/particles.draw.wgsl?raw'
import simulation from '../shaders/particles.sim.wgsl?raw'
import {
  boidsRun,
  canvasCeiling,
  fieldRuns,
  GRID_CELLS,
  GRID_SLOTS,
  PARTICLE_FLOATS,
  PARTICLE_UNIFORM_FLOATS,
  PARTICLE_WORKGROUP,
  particleColours,
  particleParams,
  planSpawns,
  spawnState,
  writeParticleUniform,
} from './particles.params'
import type { ParticleParams, ParticleProfile, SpawnGroup } from './particles.params'

/** Vertices in the two triangles that make one particle's quad. */
const QUAD_VERTICES = 6

/** The steps of the simulation, in the order `render` encodes them. */
const STEPS = ['clear_grid', 'bin', 'step'] as const
type Step = (typeof STEPS)[number]

/**
 * The most slots a software rasteriser is given, whatever the knob says. It
 * has no real compute and a pool of tens of thousands there is a frozen tab
 * rather than a dim picture.
 */
const SOFTWARE_CEILING = 2_000

type Gear = {
  device: GPUDevice
  sampler: GPUSampler
  uniform: GPUBuffer
  pool: GPUBuffer
  counts: GPUBuffer
  slots: GPUBuffer
  /** One zero texel, bound as the flow when the cast carries none. */
  still: GPUTextureView
  stillTexture: GPUTexture
  simulateLayout: GPUBindGroupLayout
  drawLayout: GPUBindGroupLayout
  steps: Record<Step, GPUComputePipeline>
  pipeline: GPURenderPipeline
  /** The uniform and the pool, bound once: neither buffer is ever replaced. */
  drawGroup: GPUBindGroup
}

export class ParticleField implements InkImpl {
  private context: SceneContext | null = null
  private gear: Gear | null = null
  private width = 1
  private height = 1
  private presence = 1
  private seconds = 0
  /** Whether this frame has anything to simulate or draw at all. */
  private live = false
  private params: ParticleParams | null = null
  private groupCount = 0
  private readonly groups: SpawnGroup[] = []
  private readonly spawns = spawnState()
  private readonly uniformData = new Float32Array(PARTICLE_UNIFORM_FLOATS)
  /** Three palette stops in rgb, rewritten each frame from the key. */
  private readonly colours = new Float32Array(9)
  /** The simulate group, kept while the flow it names has not changed. */
  private simulateGroup: GPUBindGroup | null = null
  private boundFlow: GPUTextureView | null = null
  /** The slots this device will actually run, which a rasteriser cuts. */
  private ceiling: number

  constructor(private readonly profile: ParticleProfile) {
    this.ceiling = profile.capacity
  }

  /**
   * The overlay's line. A field that says nothing (the dust) leaves it empty,
   * the way its ink always did, because `data-detail` is public API and the
   * shipped casts have to keep printing what they printed.
   */
  get detail() {
    if (!this.profile.detail || !this.live || !this.params) return ''
    return `${this.params.count} ${this.profile.detail}`
  }

  init(context: SceneContext) {
    this.context = context
    const { device, format } = context
    this.ceiling = context.software
      ? Math.min(this.profile.capacity, SOFTWARE_CEILING)
      : this.profile.capacity

    const module = (code: string, label: string) => {
      const shader = device.createShaderModule({ label, code: common + code })
      void shader.getCompilationInfo().then((info) => {
        for (const message of info.messages)
          if (message.type === 'error')
            console.error(`${label} WGSL ${message.lineNum}:${message.linePos} ${message.message}`)
      })

      return shader
    }

    const uniform = device.createBuffer({
      label: 'Particle field uniform',
      size: this.uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    // Sized once, to the profile's own ceiling rather than to the knob's, so a
    // knob that moves the count moves the slots in play and never the
    // allocation. A new buffer would lose every particle in flight.
    const pool = device.createBuffer({
      label: 'Particle pool',
      size: this.profile.capacity * PARTICLE_FLOATS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })

    const counts = device.createBuffer({
      label: 'Particle grid counts',
      size: GRID_CELLS * 4,
      usage: GPUBufferUsage.STORAGE,
    })

    const slots = device.createBuffer({
      label: 'Particle grid slots',
      size: GRID_CELLS * GRID_SLOTS * 4,
      usage: GPUBufferUsage.STORAGE,
    })

    const stillTexture = device.createTexture({
      label: 'Particle still flow',
      size: { width: 1, height: 1 },
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })

    // Named rather than derived. The three compute entry points share one
    // layout so any of them can take the same six bindings, and the draw has
    // its own because the pool is read-only there.
    const simulateLayout = device.createBindGroupLayout({
      label: 'Particle simulate',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
      ],
    })

    const drawLayout = device.createBindGroupLayout({
      label: 'Particle draw',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' },
        },
      ],
    })

    const simModule = module(simulation, `${this.profile.label} field`)
    const simLayout = device.createPipelineLayout({ bindGroupLayouts: [simulateLayout] })
    const steps: Partial<Record<Step, GPUComputePipeline>> = {}
    for (const step of STEPS)
      steps[step] = device.createComputePipeline({
        label: `Particle ${step}`,
        layout: simLayout,
        compute: { module: simModule, entryPoint: step },
      })

    const drawModule = module(draw, `${this.profile.label} draw`)
    const pipeline = device.createRenderPipeline({
      label: `Particle ${this.profile.label}`,
      layout: device.createPipelineLayout({ bindGroupLayouts: [drawLayout] }),
      vertex: { module: drawModule, entryPoint: 'quad' },
      fragment: { module: drawModule, entryPoint: 'fs', targets: [{ format, blend: INK_BLEND }] },
      primitive: { topology: 'triangle-list' },
    })

    this.gear = {
      device,
      sampler: device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
      }),
      uniform,
      pool,
      counts,
      slots,
      stillTexture,
      still: stillTexture.createView(),
      simulateLayout,
      drawLayout,
      steps: steps as Record<Step, GPUComputePipeline>,
      pipeline,
      drawGroup: device.createBindGroup({
        label: 'Particle draw',
        layout: drawLayout,
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: { buffer: pool } },
        ],
      }),
    }
  }

  resize(width: number, height: number) {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
  }

  /**
   * The CPU half of a frame: the knobs, the palette and where this frame's
   * spawns land in the ring. Nothing is uploaded here, because the uniform
   * also carries the live flow's cover and the flows have not been blended
   * yet when this runs; `render` writes it.
   */
  update(features: Float32Array, dt: number, knobs: Tuning, presence: number) {
    this.presence = presence
    this.live = false
    this.groupCount = 0
    const params = particleParams(knobs, this.profile)
    // The knob asks and the canvas decides: a field never puts more than one
    // particle in a small block of pixels, which is what keeps it sparse on a
    // canvas far smaller than the one its numbers were written against.
    params.count = Math.min(params.count, this.ceiling, canvasCeiling(this.width, this.height))
    this.params = params
    // The clock runs whether or not anything is drawn, so a field that comes
    // in with the sound arrives on the swirl the noise has reached and not at
    // its start.
    this.seconds += dt
    if (!this.gear || !fieldRuns(params, presence)) return
    this.live = true
    this.groupCount = planSpawns(params, this.profile, features, dt, this.spawns, this.groups)
    particleColours(features, params.hueSpread, this.colours)
    this.frameStep = dt
  }

  /** The step the uniform carries, kept from `update` to `render`. */
  private frameStep = 0

  render(encoder: GPUCommandEncoder, view: GPUTextureView) {
    const gear = this.gear
    const params = this.params
    if (!gear || !params || !this.live) return
    const carried = this.context?.flow?.() ?? null
    writeParticleUniform(
      params,
      {
        width: this.width,
        height: this.height,
        dt: this.frameStep,
        time: this.seconds,
        colours: this.colours,
        groups: this.groups,
        groupCount: this.groupCount,
        flowCover: carried?.cover ?? null,
        wrap: this.profile.shape === 'field',
      },
      this.uniformData,
    )
    gear.device.queue.writeBuffer(gear.uniform, 0, this.uniformData)

    const flow = carried?.view ?? gear.still
    // One group a frame at most, and only when the flow it names has moved:
    // which half of a ping-pong a flow offers alternates, so this cannot be
    // built once, and a cast with no flow at all builds it once and keeps it.
    if (!this.simulateGroup || this.boundFlow !== flow) {
      this.simulateGroup = gear.device.createBindGroup({
        label: 'Particle simulate',
        layout: gear.simulateLayout,
        entries: [
          { binding: 0, resource: { buffer: gear.uniform } },
          { binding: 1, resource: { buffer: gear.pool } },
          { binding: 2, resource: { buffer: gear.counts } },
          { binding: 3, resource: { buffer: gear.slots } },
          { binding: 4, resource: flow },
          { binding: 5, resource: gear.sampler },
        ],
      })
      this.boundFlow = flow
    }

    const pass = encoder.beginComputePass({ label: `Particle ${this.profile.label}` })
    pass.setBindGroup(0, this.simulateGroup)
    // The grid is only built when something reads it. Two dispatches for a
    // steering nothing has asked for is the one cost a field with no boids
    // could pay and does not.
    if (boidsRun(params)) {
      pass.setPipeline(gear.steps.clear_grid)
      pass.dispatchWorkgroups(groups(GRID_CELLS))
      pass.setPipeline(gear.steps.bin)
      pass.dispatchWorkgroups(groups(params.count))
    }

    pass.setPipeline(gear.steps.step)
    pass.dispatchWorkgroups(groups(params.count))
    pass.end()

    const render = encoder.beginRenderPass({
      label: `Particle ${this.profile.label}`,
      colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }],
    })
    render.setPipeline(gear.pipeline)
    render.setBlendConstant({ r: this.presence, g: this.presence, b: this.presence, a: 1 })
    render.setBindGroup(0, gear.drawGroup)
    render.draw(QUAD_VERTICES, params.count)
    render.end()
  }

  dispose() {
    const gear = this.gear
    if (gear) {
      gear.uniform.destroy()
      gear.pool.destroy()
      gear.counts.destroy()
      gear.slots.destroy()
      gear.stillTexture.destroy()
    }

    this.gear = null
    this.context = null
    this.simulateGroup = null
    this.boundFlow = null
    this.live = false
    this.params = null
  }
}

/** Workgroups needed to cover this many invocations, at `PARTICLE_WORKGROUP` each. */
const groups = (invocations: number) => Math.max(1, Math.ceil(invocations / PARTICLE_WORKGROUP))

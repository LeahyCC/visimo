/**
 * The sparks' half that touches the GPU: one instance buffer, one uniform and
 * one pipeline, and a pass that draws a quad a living spark. Where a spark is
 * and when the pool throws some is `sparks.params.ts`, which this only feeds a
 * packet and reads the rows back from.
 *
 * It is sparse on purpose and the cost follows: while nothing is alive there is
 * nothing to upload and no pass is encoded, so in a silent passage this ink
 * costs the CPU a scan of 96 slots and the GPU nothing at all. While sparks are
 * flying it uploads at most 96 rows of 36 bytes and draws them in one call. The
 * uniform, the canvas in pixels, is written when the size changes and not per
 * frame.
 */
import type { Tuning } from '../presets/knobs'
import { INK_BLEND } from '../scenes/Impl'
import type { InkImpl } from '../scenes/Impl'
import type { SceneContext } from '../scenes/Scene'
import shader from '../shaders/sparks.wgsl?raw'
import {
  SPARK_BYTES,
  SPARK_FLOATS,
  SPARK_POOL,
  SPARK_UNIFORM_FLOATS,
  sparkParams,
  SparkPool,
  writeSparkUniform,
} from './sparks.params'

/** Vertices in the two triangles that make one spark's quad. */
const QUAD_VERTICES = 6

export class SparksInk implements InkImpl {
  private context: SceneContext | null = null
  private pipeline: GPURenderPipeline | null = null
  private instances: GPUBuffer | null = null
  private uniform: GPUBuffer | null = null
  private group: GPUBindGroup | null = null
  private readonly pool = new SparkPool()
  private readonly rows = new Float32Array(SPARK_POOL * SPARK_FLOATS)
  private readonly view = new Float32Array(SPARK_UNIFORM_FLOATS)
  private width = 1
  private height = 1
  /** Sparks uploaded this frame, and so drawn. Zero encodes nothing. */
  private drawn = 0
  private presence = 1

  /** Only while something is flying, so the line is empty when the hats are. */
  get detail() {
    return this.drawn > 0 ? `${this.drawn} sparks` : ''
  }

  init(context: SceneContext) {
    this.context = context
    const { device, format } = context
    const module = device.createShaderModule({ label: 'Sparks', code: shader })
    void module.getCompilationInfo().then((info) => {
      for (const message of info.messages)
        if (message.type === 'error')
          console.error(`Sparks WGSL ${message.lineNum}:${message.linePos} ${message.message}`)
    })

    this.instances = device.createBuffer({
      label: 'Sparks instances',
      size: SPARK_POOL * SPARK_BYTES,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })

    this.uniform = device.createBuffer({
      label: 'Sparks canvas',
      size: this.view.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    this.pipeline = device.createRenderPipeline({
      label: 'Sparks',
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'vs',
        // One row a spark, stepped per instance. These three are the struct in
        // the shader: place and direction, then the two half extents, then the
        // light.
        buffers: [
          {
            arrayStride: SPARK_BYTES,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x4' },
              { shaderLocation: 1, offset: 16, format: 'float32x2' },
              { shaderLocation: 2, offset: 24, format: 'float32x3' },
            ],
          },
        ],
      },
      fragment: { module, entryPoint: 'fs', targets: [{ format, blend: INK_BLEND }] },
      primitive: { topology: 'triangle-list' },
    })

    this.group = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniform } }],
    })

    this.writeView()
  }

  resize(width: number, height: number) {
    this.width = width
    this.height = Math.max(1, height)
    this.writeView()
  }

  private writeView() {
    if (!this.context || !this.uniform) return
    writeSparkUniform(this.width, this.height, this.view)
    this.context.device.queue.writeBuffer(this.uniform, 0, this.view)
  }

  update(features: Float32Array, dt: number, knobs: Tuning, presence: number) {
    this.presence = presence
    this.drawn = 0
    if (!this.context || !this.instances) return
    const params = sparkParams(knobs)
    this.pool.step(features, dt, params)
    if (this.pool.alive === 0 || !(params.intensity > 0)) return
    this.drawn = this.pool.fill(this.rows, params, this.width, this.height)
    // Nothing on screen is nothing to upload, even with sparks still alive: the
    // ones that have flown off the canvas do not come back.
    if (this.drawn === 0) return
    this.context.device.queue.writeBuffer(
      this.instances,
      0,
      this.rows,
      0,
      this.drawn * SPARK_FLOATS,
    )
  }

  render(encoder: GPUCommandEncoder, view: GPUTextureView) {
    if (this.drawn === 0 || !this.pipeline || !this.group || !this.instances) return
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }],
    })
    pass.setPipeline(this.pipeline)
    pass.setBlendConstant({ r: this.presence, g: this.presence, b: this.presence, a: 1 })
    pass.setBindGroup(0, this.group)
    pass.setVertexBuffer(0, this.instances)
    pass.draw(QUAD_VERTICES, this.drawn)
    pass.end()
  }

  dispose() {
    this.instances?.destroy()
    this.uniform?.destroy()
    this.instances = null
    this.uniform = null
    this.pipeline = null
    this.group = null
    this.context = null
    this.drawn = 0
  }
}

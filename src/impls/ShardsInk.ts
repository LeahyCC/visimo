/**
 * The shards' half that touches the GPU: one instance buffer, one uniform and
 * one pipeline, and a pass that draws a triangle per living shard. What a shard
 * is, where it is and when the pool throws some is `shards.params.ts`, which
 * this only feeds a packet and reads the rows back from.
 *
 * It is sparse on purpose and the cost follows: while nothing is alive there is
 * nothing to upload and no pass is encoded, so between drops this ink costs the
 * CPU a scan of 192 slots and the GPU nothing at all. While a burst is flying
 * it uploads at most 192 rows of 32 bytes and draws them in one call. The
 * uniform, the canvas aspect, is written when the size changes and not per
 * frame.
 */
import type { Tuning } from '../presets/knobs'
import { INK_BLEND } from '../scenes/Impl'
import type { InkImpl } from '../scenes/Impl'
import type { SceneContext } from '../scenes/Scene'
import shader from '../shaders/shards.wgsl?raw'
import {
  SHARD_BYTES,
  SHARD_FLOATS,
  SHARD_POOL,
  SHARD_UNIFORM_FLOATS,
  shardParams,
  ShardPool,
} from './shards.params'

export class ShardsInk implements InkImpl {
  private context: SceneContext | null = null
  private pipeline: GPURenderPipeline | null = null
  private instances: GPUBuffer | null = null
  private uniform: GPUBuffer | null = null
  private group: GPUBindGroup | null = null
  private readonly pool = new ShardPool()
  private readonly rows = new Float32Array(SHARD_POOL * SHARD_FLOATS)
  private readonly view = new Float32Array(SHARD_UNIFORM_FLOATS)
  private aspect = 16 / 9
  /** Shards uploaded this frame, and so drawn. Zero encodes nothing. */
  private drawn = 0
  private presence = 1

  /** Only while something is flying, so the line is empty between drops. */
  get detail() {
    return this.drawn > 0 ? `${this.drawn} shards` : ''
  }

  init(context: SceneContext) {
    this.context = context
    const { device, format } = context
    const module = device.createShaderModule({ label: 'Shards', code: shader })
    void module.getCompilationInfo().then((info) => {
      for (const message of info.messages)
        if (message.type === 'error')
          console.error(`Shards WGSL ${message.lineNum}:${message.linePos} ${message.message}`)
    })

    this.instances = device.createBuffer({
      label: 'Shards instances',
      size: SHARD_POOL * SHARD_BYTES,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })

    this.uniform = device.createBuffer({
      label: 'Shards view',
      size: this.view.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    this.pipeline = device.createRenderPipeline({
      label: 'Shards',
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'vs',
        // One row a shard, stepped per instance. These three are the struct in
        // the shader: centre, then turn and size, then colour and light.
        buffers: [
          {
            arrayStride: SHARD_BYTES,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' },
              { shaderLocation: 1, offset: 8, format: 'float32x2' },
              { shaderLocation: 2, offset: 16, format: 'float32x4' },
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
    this.aspect = width / Math.max(1, height)
    this.writeView()
  }

  private writeView() {
    if (!this.context || !this.uniform) return
    this.view[0] = this.aspect
    this.context.device.queue.writeBuffer(this.uniform, 0, this.view)
  }

  update(features: Float32Array, dt: number, knobs: Tuning, presence: number) {
    this.presence = presence
    this.drawn = 0
    if (!this.context || !this.instances) return
    const params = shardParams(knobs)
    this.pool.step(features, dt, params)
    if (this.pool.alive === 0) return
    this.drawn = this.pool.fill(this.rows, params, this.aspect)
    // Nothing on screen is nothing to upload, even with shards still alive:
    // the ones that have flown out of the frame do not come back.
    if (this.drawn === 0) return
    this.context.device.queue.writeBuffer(
      this.instances,
      0,
      this.rows,
      0,
      this.drawn * SHARD_FLOATS,
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
    pass.draw(3, this.drawn)
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

import type { Tuning } from '../presets/knobs'
import shader from '../shaders/kaleidoscope.wgsl?raw'
import { INK_BLEND } from './Impl'
import type { InkImpl } from './Impl'
import {
  KALEIDOSCOPE_UNIFORM_FLOATS,
  KaleidoscopeMotion,
  kaleidoscopeParams,
  writeKaleidoscopeUniform,
} from './kaleidoscope.params'
import type { SceneContext } from './Scene'

/**
 * A raymarched fractal with five material scales, which is the `fractal` ink.
 * Phases survive a resize. It covers most of the frame, so it is the one ink
 * the registry keeps out of a cast with the dye.
 */
export class Kaleidoscope implements InkImpl {
  private context: SceneContext | null = null
  private pipeline: GPURenderPipeline | null = null
  private uniform: GPUBuffer | null = null
  private group: GPUBindGroup | null = null
  private width = 1
  private height = 1
  private readonly motion = new KaleidoscopeMotion()
  private readonly data = new Float32Array(KALEIDOSCOPE_UNIFORM_FLOATS)
  private presence = 1
  // Every frame is a full raymarch and the motion is slow.
  readonly maxFps = 60
  // 2560x1440. A 4K canvas at full size pinned an RTX 5080.
  readonly maxPixels = 3_686_400

  get detail() {
    return `5-band 3D kaleidoscope / ${this.width}x${this.height}`
  }

  init(context: SceneContext) {
    this.context = context
    const { device, format } = context
    const module = device.createShaderModule({ label: 'Kaleidoscope', code: shader })
    void module.getCompilationInfo().then((info) => {
      for (const message of info.messages)
        if (message.type === 'error')
          console.error(
            `Kaleidoscope WGSL ${message.lineNum}:${message.linePos} ${message.message}`,
          )
    })

    this.uniform = device.createBuffer({
      size: this.data.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    this.pipeline = device.createRenderPipeline({
      label: 'Kaleidoscope',
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format, blend: INK_BLEND }] },
      primitive: { topology: 'triangle-list' },
    })

    this.group = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniform } }],
    })
  }

  resize(width: number, height: number) {
    this.width = width
    this.height = height
  }

  update(features: Float32Array, dt: number, tuning: Tuning, presence: number) {
    this.presence = presence
    if (!this.context || !this.uniform) return
    const params = kaleidoscopeParams(tuning)
    this.motion.step(params, dt, features)
    writeKaleidoscopeUniform(
      params,
      this.motion,
      this.width,
      this.height,
      this.context.software,
      this.data,
    )
    this.context.device.queue.writeBuffer(this.uniform, 0, this.data)
  }

  render(encoder: GPUCommandEncoder, view: GPUTextureView) {
    if (!this.pipeline || !this.group) return
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }],
    })
    pass.setPipeline(this.pipeline)
    pass.setBlendConstant({ r: this.presence, g: this.presence, b: this.presence, a: 1 })
    pass.setBindGroup(0, this.group)
    pass.draw(3)
    pass.end()
  }

  dispose() {
    this.uniform?.destroy()
    this.uniform = null
    this.pipeline = null
    this.group = null
    this.context = null
  }
}

import type { Tuning } from '../presets/knobs'
import shader from '../shaders/kaleidoscope.wgsl?raw'
import {
  KALEIDOSCOPE_UNIFORM_FLOATS,
  KaleidoscopeMotion,
  kaleidoscopeParams,
  writeKaleidoscopeUniform,
} from './kaleidoscope.params'
import type { Scene, SceneContext } from './Scene'

/** A raymarched fractal with five material scales. Phases survive a resize. */
export class Kaleidoscope implements Scene {
  private context: SceneContext | null = null
  private pipeline: GPURenderPipeline | null = null
  private uniform: GPUBuffer | null = null
  private group: GPUBindGroup | null = null
  private width = 1
  private height = 1
  private readonly motion = new KaleidoscopeMotion()
  private readonly data = new Float32Array(KALEIDOSCOPE_UNIFORM_FLOATS)
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
      fragment: { module, entryPoint: 'fs', targets: [{ format }] },
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

  update(features: Float32Array, dt: number, tuning: Tuning) {
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
      colorAttachments: [
        { view, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' },
      ],
    })
    pass.setPipeline(this.pipeline)
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

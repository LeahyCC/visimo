/**
 * Two flows into one field. The feedback pass reads the last frame back along
 * a single velocity texture, and the middle of a change has two flows live,
 * so this sums them into a target of its own, each weighted by its presence
 * and the weights normalised. One live flow is handed straight through and no
 * pass is encoded at all, which is every pinned cast and so the common case.
 *
 * The weights are normalised rather than added raw because this is an average
 * of fields and not a sum of them: two flows at a half each should carry the
 * picture as far as either of them alone, not half as far. How hard each flow
 * stirs at a low presence is the flow's own business and is already in the
 * field it hands over; see `fluidTuning`.
 *
 * The target follows the first live flow's grid, and the cover with it. Every
 * flow there is solves on the same grid today, and a field of another size
 * still lands correctly because the shader samples by uv.
 */
import type { Flow, SceneContext } from '../scenes/Scene'
import blend from '../shaders/flow.blend.wgsl?raw'

const FIELD_FORMAT: GPUTextureFormat = 'rgba16float'

/** One live flow: the field it wrote this frame and the fade it is at. */
export type LiveFlow = { flow: Flow; presence: number }

type Gear = {
  device: GPUDevice
  sampler: GPUSampler
  pipeline: GPURenderPipeline
}

export class FlowBlend {
  private gear: Gear | null = null
  private texture: GPUTexture | null = null
  private view: GPUTextureView | null = null
  private size = 0

  init(context: SceneContext) {
    const { device } = context
    const module = device.createShaderModule({ label: 'Flow blend', code: blend })
    void module.getCompilationInfo().then((info) => {
      for (const message of info.messages)
        if (message.type === 'error')
          console.error(`Flow blend WGSL ${message.lineNum}:${message.linePos} ${message.message}`)
    })

    this.gear = {
      device,
      sampler: device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
      }),
      pipeline: device.createRenderPipeline({
        label: 'Flow blend',
        layout: 'auto',
        vertex: { module, entryPoint: 'vs' },
        fragment: {
          module,
          entryPoint: 'fs',
          targets: [
            {
              format: FIELD_FORMAT,
              blend: {
                color: { srcFactor: 'constant', dstFactor: 'one', operation: 'add' },
                alpha: { srcFactor: 'constant', dstFactor: 'one', operation: 'add' },
              },
            },
          ],
        },
        primitive: { topology: 'triangle-list' },
      }),
    }
  }

  /** The one field the feedback pass should carry the picture along. */
  blend(encoder: GPUCommandEncoder, live: readonly LiveFlow[]): Flow | null {
    const first = live[0]
    if (!first) return null
    if (live.length === 1) return first.flow
    const gear = this.gear
    let total = 0
    for (const entry of live) total += Math.max(entry.presence, 0)
    if (!gear || total <= 0) return first.flow
    const view = this.target(gear.device, first.flow.size)
    if (!view) return first.flow

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' },
      ],
    })
    pass.setPipeline(gear.pipeline)
    for (const entry of live) {
      const weight = Math.max(entry.presence, 0) / total
      pass.setBlendConstant({ r: weight, g: weight, b: weight, a: weight })
      pass.setBindGroup(
        0,
        gear.device.createBindGroup({
          layout: gear.pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: gear.sampler },
            { binding: 1, resource: entry.flow.view },
          ],
        }),
      )
      pass.draw(3)
    }
    pass.end()

    return { view, cover: first.flow.cover, size: this.size }
  }

  private target(device: GPUDevice, size: number): GPUTextureView | null {
    if (size <= 0) return null
    if (this.view && this.size === size) return this.view
    this.release()
    const texture = device.createTexture({
      size: { width: size, height: size },
      format: FIELD_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    this.texture = texture
    this.view = texture.createView()
    this.size = size
    return this.view
  }

  private release() {
    this.texture?.destroy()
    this.texture = null
    this.view = null
    this.size = 0
  }

  dispose() {
    this.release()
    this.gear = null
  }
}

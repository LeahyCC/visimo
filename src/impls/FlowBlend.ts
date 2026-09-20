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
 * The two flows need not solve on the same grid. The analytic flow writes a
 * 128 texel field and the fluid solves on 512 or 1024, and `blendTarget`
 * below is what decides what the two land in.
 */
import type { Flow, SceneContext } from '../scenes/Scene'
import blend from '../shaders/flow.blend.wgsl?raw'

const FIELD_FORMAT: GPUTextureFormat = 'rgba16float'

/** One live flow: the field it wrote this frame and the fade it is at. */
export type LiveFlow = { flow: Flow; presence: number }

/**
 * The grid the live flows are summed into, and the cover the result carries.
 *
 * The size is the LARGEST among them, not the first's. The blend shader
 * samples by uv, so a small field lands correctly in a large target, but a
 * large one written into a small target loses detail it cannot get back: a
 * 1024 fluid crossfading with a 128 analytic field would spend the whole
 * change at a sixty-fourth of the fluid's resolution and the filaments would
 * come back at the end of it.
 *
 * The cover is the first flow's, and every flow's is the same: it comes from
 * the canvas alone (`visibleExtent`), and every flow is handed the same
 * canvas by `sizeImpls`. If one ever differed, blending by uv would be wrong
 * before this function was, since the fields would not be laid on the same
 * part of the canvas.
 */
export function blendTarget(
  live: readonly LiveFlow[],
): { size: number; cover: Flow['cover'] } | null {
  const first = live[0]
  if (!first) return null
  let size = 0
  for (const entry of live) size = Math.max(size, entry.flow.size)
  return size > 0 ? { size, cover: first.flow.cover } : null
}

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
    const wanted = blendTarget(live)
    if (!gear || total <= 0 || !wanted) return first.flow
    const view = this.target(gear.device, wanted.size)
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

    return { view, cover: wanted.cover, size: this.size }
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

/**
 * height-kit, the GPU half: the ring of rows and the view uniform on the
 * device, and the two bindings a study's shader reads them through. It is not
 * an implementation itself. A study's ink owns one, asks it to `advance` every
 * frame (which is CPU work and free while the study is dark), and calls
 * `upload` only on a frame it draws.
 *
 * Two buffers, both made once: the view uniform (`HEIGHT_VIEW_FLOATS`) and the
 * ring's rows as read-only storage, `rows * columns` floats. The ring is
 * written a row at a time as the camera flies, so a frame uploads the rows
 * that were born since the last one, which is none on most frames at a slow
 * speed, and the uniform. Nothing is allocated per frame: the row runs are
 * handed out through one closure made in the constructor.
 *
 * The bindings are the kit's to name and the study adds its own after them:
 * `heightLayoutEntries` is 0 and 1, and a study's uniform starts at 2. The
 * matching declarations are the top of `shaders/height.common.wgsl`, which
 * the study prepends to its own shader.
 */
import { HEIGHT_CAMERA, HEIGHT_VIEW_FLOATS, HeightRing, writeHeightView } from './height.params'
import type { HeightCamera, HeightProfile } from './height.params'

/** The bindings the kit declares, which the shader's first two globals match. */
export const HEIGHT_BINDINGS = { view: 0, rows: 1 } as const

/**
 * The layout entries for the kit's two bindings. Both are read by the
 * fragment stage, which is where the study marches the ground; a study that
 * reads them in another stage asks for that one instead.
 */
export const heightLayoutEntries = (
  visibility: GPUShaderStageFlags = GPUShaderStage.FRAGMENT,
): GPUBindGroupLayoutEntry[] => [
  { binding: HEIGHT_BINDINGS.view, visibility, buffer: { type: 'uniform' } },
  { binding: HEIGHT_BINDINGS.rows, visibility, buffer: { type: 'read-only-storage' } },
]

type Gear = {
  device: GPUDevice
  view: GPUBuffer
  rows: GPUBuffer
}

export class HeightField {
  readonly ring: HeightRing
  private readonly camera: HeightCamera
  private readonly view = new Float32Array(HEIGHT_VIEW_FLOATS)
  private gear: Gear | null = null
  /** Made once, so flushing the ring allocates nothing. */
  private readonly writeRows = (firstSlot: number, count: number) => {
    const gear = this.gear
    if (!gear) return
    const columns = this.ring.columns
    gear.device.queue.writeBuffer(
      gear.rows,
      firstSlot * columns * Float32Array.BYTES_PER_ELEMENT,
      this.ring.data,
      firstSlot * columns,
      count * columns,
    )
  }

  constructor(ring = new HeightRing(), camera: HeightCamera = HEIGHT_CAMERA) {
    this.ring = ring
    this.camera = camera
  }

  init(device: GPUDevice) {
    const view = device.createBuffer({
      label: 'Height view',
      size: this.view.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    const rows = device.createBuffer({
      label: 'Height rows',
      size: this.ring.data.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })

    this.gear = { device, view, rows }
    // Whatever the ring holds is not on this device yet, and a fresh buffer is
    // zeros, which is only the right thing while the ring is still flat.
    this.ring.markAllPending()
  }

  /** The kit's two entries for a bind group, for a study to add its own to. */
  bindGroupEntries(): GPUBindGroupEntry[] {
    const gear = this.gear
    if (!gear) throw new Error('HeightField: bindGroupEntries before init')
    return [
      { binding: HEIGHT_BINDINGS.view, resource: { buffer: gear.view } },
      { binding: HEIGHT_BINDINGS.rows, resource: { buffer: gear.rows } },
    ]
  }

  /** Fly `distance` further and write the rows it crossed. CPU only; see `HeightRing.advance`. */
  advance(distance: number, dt: number, features: Float32Array): number {
    return this.ring.advance(distance, dt, features)
  }

  /**
   * Puts this frame on the GPU: the rows born since the last upload, and the
   * view. Called only when the study is drawing; rows born while it was dark
   * are still pending and go up all together the first frame it is lit.
   */
  upload(profile: HeightProfile, width: number, height: number) {
    const gear = this.gear
    if (!gear) return
    this.ring.flush(this.writeRows)
    gear.device.queue.writeBuffer(
      gear.view,
      0,
      writeHeightView(this.view, this.ring, this.camera, profile, width, height),
    )
  }

  dispose() {
    this.gear?.view.destroy()
    this.gear?.rows.destroy()
    this.gear = null
  }
}

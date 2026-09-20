/**
 * The one renderer. It owns the device, the feature buffer, whichever scene
 * is chosen with its state, and the post stack, and outlives every stage. A stage
 * hands it a canvas to draw on and takes it back on unmount; the popout
 * portals a fresh stage into another document, so the canvas and its context
 * are the only things made per mount.
 *
 * The animation loop belongs to the window the canvas is in: the tab's
 * requestAnimationFrame stops when the tab is hidden, and a popout window
 * stays visible while the tab is not.
 */
import { audioGraph } from '../audio/AudioGraph'
import { FeatureClient } from '../audio/FeatureClient'
import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { Hud } from '../hud/Hud'
import { defaultPostParams, mergePostParams, postSummary } from '../post/params'
import type { PostParams, PostPatch } from '../post/params'
import { PostStack, SCENE_FORMAT } from '../post/PostStack'
import { DEFAULT_PRESET_ID, presetOrDefault } from '../presets/index'
import type { Tuning } from '../presets/knobs'
import { resolvePost, resolveScene } from '../presets/resolve'
import type { Preset } from '../presets/types'
import { DEFAULT_FLUID_SIZE, DEFAULT_SCENE } from '../scenes/catalog'
import type { SceneId } from '../scenes/catalog'
import { Fluid } from '../scenes/Fluid'
import { Kaleidoscope } from '../scenes/Kaleidoscope'
import { KaleidoscopeMotion } from '../scenes/kaleidoscope.params'
import { KaleidoscopeWebGL } from '../scenes/KaleidoscopeWebGL'
import type { Scene } from '../scenes/Scene'
import { acquireGpu, configureCanvas, onGpuLost } from './Device'
import type { Gpu, GpuInfo } from './Device'

export type AttachResult = 'ok' | 'unsupported' | 'cancelled'

const describe = (info: GpuInfo) =>
  [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(' ') ||
  'unknown adapter'

class Renderer {
  private gpu: Gpu | null = null
  private compatibility: KaleidoscopeWebGL | null = null
  private readonly compatibilityMotion = new KaleidoscopeMotion()
  private unwatchContext: (() => void) | null = null
  private scene: Scene | null = null
  private post: PostStack | null = null
  private client: FeatureClient | null = null
  private canvas: HTMLCanvasElement | null = null
  private attaching: HTMLCanvasElement | null = null
  // Effect remounts can reuse a canvas while its previous acquisition is pending.
  private attachment = 0
  private context: GPUCanvasContext | null = null
  private hud: Hud | null = null
  private hudVisible = false
  private hudCanvas: HTMLCanvasElement | null = null
  private onFailure: (() => void) | null = null
  private observer: ResizeObserver | null = null
  private unwatchVisibility: (() => void) | null = null
  private frame = 0
  private last = 0
  private time = 0
  private sceneId: SceneId = DEFAULT_SCENE
  private fluidSize = DEFAULT_FLUID_SIZE
  private readonly packet = new Float32Array(PACKET_LENGTH)
  // The preset it draws with, the object its mapping is resolved into each
  // frame, and the stack the post lanes are written into. All three belong to
  // the singleton, so the popout round trip keeps the preset.
  private preset: Preset = presetOrDefault(DEFAULT_PRESET_ID)
  private readonly tuning: Record<string, number> = {}
  private base: PostParams = defaultPostParams()
  private readonly live: PostParams = defaultPostParams()
  private frameMs = 16.7
  private drawWidth = 1
  private drawHeight = 1
  private reported = 0
  private disposed = false
  private failed = false
  private readonly unwatchGpu: () => void

  constructor() {
    this.base = mergePostParams(this.preset.postParams, {})
    this.unwatchGpu = onGpuLost(() => this.recover())
  }

  /**
   * Draw on this canvas until `detach`. Resolves once the device is ready.
   * `onFailure` is called later if the device is lost and cannot be
   * recovered, so the stage can fall back to artwork.
   */
  async attach(
    canvas: HTMLCanvasElement,
    hudCanvas: HTMLCanvasElement,
    onFailure: () => void,
  ): Promise<AttachResult> {
    if (this.disposed) return 'cancelled'
    const attachment = ++this.attachment
    this.attaching = canvas
    const gpu = await acquireGpu()
    if (this.disposed || this.attachment !== attachment) return 'cancelled'
    this.attaching = null
    if (!gpu && this.sceneId !== 'kaleidoscope') return 'unsupported'
    // Context types cannot change on an existing canvas. The stage replaces
    // a former WebGPU canvas before retrying through WebGL.
    if (!gpu && canvas.dataset.backend === 'webgpu') return 'unsupported'
    if (this.canvas) this.detach(this.canvas)
    if (gpu) {
      this.gpu = gpu
      if (!this.post) {
        this.post = new PostStack()
        this.post.init(gpu.device, gpu.format)
      }
      this.post.useParams(this.live)
      if (!this.scene) this.buildScene()
      const context = configureCanvas(gpu, canvas)
      if (!context) return 'unsupported'
      this.context = context
      canvas.dataset.adapter = describe(gpu.info)
      canvas.dataset.backend = 'webgpu'
    } else {
      this.compatibility = new KaleidoscopeWebGL(canvas, this.compatibilityMotion)
      canvas.dataset.adapter = this.compatibility.adapter
      canvas.dataset.backend = 'webgl2'
      const lost = (event: Event) => {
        event.preventDefault()
        onFailure()
      }
      canvas.addEventListener('webglcontextlost', lost)
      this.unwatchContext = () => canvas.removeEventListener('webglcontextlost', lost)
    }
    this.canvas = canvas
    this.hudCanvas = hudCanvas
    this.hud = new Hud(hudCanvas)
    this.hud.setVisible(this.hudVisible)
    this.onFailure = onFailure
    this.failed = false
    const win = canvas.ownerDocument.defaultView ?? window
    this.resize()
    this.observer = new win.ResizeObserver(() => this.resize())
    this.observer.observe(canvas)
    const doc = canvas.ownerDocument
    const onVisibility = () => {
      if (doc.visibilityState === 'visible') this.start()
      else this.stop()
    }
    doc.addEventListener('visibilitychange', onVisibility)
    this.unwatchVisibility = () => doc.removeEventListener('visibilitychange', onVisibility)
    this.start()
    return 'ok'
  }

  /** Stop drawing on this canvas. The device and the scene's state stay. */
  detach(canvas: HTMLCanvasElement) {
    if (this.attaching === canvas) {
      this.attaching = null
      this.attachment++
    }
    if (this.canvas !== canvas) return
    this.stop()
    this.observer?.disconnect()
    this.observer = null
    this.unwatchVisibility?.()
    this.unwatchVisibility = null
    this.context?.unconfigure()
    this.context = null
    this.unwatchContext?.()
    this.unwatchContext = null
    this.compatibility?.dispose()
    this.compatibility = null
    this.canvas = null
    this.hud = null
    this.hudCanvas = null
    this.onFailure = null
  }

  /** Hot replacement must release the old singleton, including pending mounts. */
  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.attachment++
    this.attaching = null
    this.unwatchGpu()
    if (this.canvas) this.detach(this.canvas)
    this.scene?.dispose()
    this.scene = null
    this.post?.dispose()
    this.post = null
    this.client?.dispose()
    this.client = null
    this.gpu = null
  }

  setHud(visible: boolean) {
    this.hudVisible = visible
    this.hud?.setVisible(visible)
  }

  /**
   * Change one or more post stages by hand, over whatever the preset asked
   * for. The development handle uses this to switch stages off while frame
   * times are measured; choosing a preset clears it, since a preset brings
   * its own stack.
   */
  setPost(patch: PostPatch) {
    this.base = mergePostParams(this.base, patch)
  }

  /** What the stack is actually drawing with: the preset, modulated. */
  get postParams(): PostParams | null {
    return this.compatibility ? this.live : (this.post?.params ?? null)
  }

  /**
   * Draw with this preset: its scene numbers, its stack, and the mapping that
   * says which feature drives which of them. The scene itself is switched by
   * `setScene`, which the stage calls with the preset's own scene.
   */
  setPreset(preset: Preset) {
    this.preset = preset
    this.base = mergePostParams(preset.postParams, {})
  }

  get presetId() {
    return this.preset.id
  }

  setFluidSize(size: number) {
    this.fluidSize = size
    if (this.scene instanceof Fluid) this.scene.setSize(size)
  }

  /** Swap the whole scene. The old one's buffers go with it. */
  setScene(id: SceneId) {
    if (id === this.sceneId) return
    this.sceneId = id
    if (this.compatibility && id !== 'kaleidoscope') {
      this.onFailure?.()
      return
    }
    if (this.gpu) this.buildScene()
  }

  // Build the chosen scene, dropping whatever was there. Scenes draw into the
  // stack's floating-point texture, not the canvas, so their pipelines are
  // built for that format.
  private buildScene() {
    const gpu = this.gpu
    if (!gpu) return
    this.scene?.dispose()
    this.post?.resetHistory()
    this.scene = this.build()

    this.scene.init({
      device: gpu.device,
      format: SCENE_FORMAT,
      software: gpu.info.software,
    })

    this.sizeScene()
  }

  // The scene and the post stack share one size, which a scene may hold below
  // the canvas. Every post stage samples by uv, so the composite scales it up.
  private sizeScene() {
    const { canvas, scene } = this
    if (!canvas || !scene) return
    const shrink = Math.min(
      1,
      Math.sqrt((scene.maxPixels ?? Infinity) / (canvas.width * canvas.height)),
    )
    this.drawWidth = Math.max(1, Math.round(canvas.width * shrink))
    this.drawHeight = Math.max(1, Math.round(canvas.height * shrink))
    scene.resize(this.drawWidth, this.drawHeight)
  }

  // Construction stays here so scenes share the device and post stack.
  private build(): Scene {
    if (this.sceneId === 'kaleidoscope') return new Kaleidoscope()
    return new Fluid(this.fluidSize)
  }

  private start() {
    if (this.failed || this.frame || !this.canvas) return
    const win = this.canvas.ownerDocument.defaultView ?? window
    // Each window has its own clock. A popout's starts near zero, so any
    // timestamp kept from the tab would be in its future.
    this.last = win.performance.now()
    this.reported = 0
    this.frame = win.requestAnimationFrame(this.tick)
  }

  private stop() {
    if (!this.frame || !this.canvas) return
    const win = this.canvas.ownerDocument.defaultView ?? window
    win.cancelAnimationFrame(this.frame)
    this.frame = 0
  }

  private resize() {
    const canvas = this.canvas
    if (!canvas) return
    const win = canvas.ownerDocument.defaultView ?? window
    const displayRatio = win.devicePixelRatio || 1
    const scale =
      this.compatibility?.pixelRatio(canvas.clientWidth, canvas.clientHeight, displayRatio) ??
      displayRatio
    const width = Math.max(1, Math.round(canvas.clientWidth * scale))
    const height = Math.max(1, Math.round(canvas.clientHeight * scale))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    // A replacement scene still needs its size when HMR or recovery keeps
    // the canvas and its existing drawing-buffer dimensions.
    this.sizeScene()
    this.hud?.resize(canvas.clientWidth, canvas.clientHeight, displayRatio)
  }

  private readonly tick = (now: number) => {
    if (this.failed) return
    try {
      this.drawFrame(now)
    } catch (error: unknown) {
      // A failed frame must not keep submitting work while React shows fallback.
      this.failed = true
      this.stop()
      console.error('Visualizer frame failed:', error)
      this.onFailure?.()
    }
  }

  private drawFrame(now: number) {
    this.frame = 0
    const { canvas, context, gpu, scene, post, compatibility } = this
    if (!canvas || (!compatibility && (!context || !gpu || !scene || !post || gpu.lost))) return
    const win = canvas.ownerDocument.defaultView ?? window
    this.frame = win.requestAnimationFrame(this.tick)
    // Skip display frames a capped scene does not want. The 0.75 lets a
    // display that is not a multiple of the cap land just above it, not far
    // below: 144 Hz draws at 72, 176 Hz at 59.
    const cap = scene?.maxFps
    if (cap && now - this.last < 750 / cap) return
    const dt = Math.min(0.1, Math.max(0.001, (now - this.last) / 1000))
    this.last = now
    this.frameMs += (dt * 1000 - this.frameMs) * 0.1
    this.time += dt

    // Features come from the library element once it has played. Before
    // that the packet is silent and the field just drifts.
    const graph = audioGraph()
    if (!this.client && graph?.attached) this.client = new FeatureClient(graph.analyser)
    if (this.client) {
      this.client.pump(dt)
      this.client.readInto(this.packet)
    }
    this.packet[F.time] = this.time
    this.packet[F.dt] = dt

    // The mapping is applied here, on the CPU, and nowhere else: the scene
    // and the stack both read numbers that have already been modulated.
    const preset = this.preset
    const tuning: Tuning = resolveScene(
      preset.sceneParams,
      preset.audioMapping,
      this.packet,
      this.tuning,
    )
    resolvePost(this.base, preset.audioMapping, this.packet, this.live)

    if (compatibility) {
      compatibility.render(this.packet, dt, tuning, this.live)
    } else if (gpu && context && scene && post) {
      scene.update(this.packet, dt, tuning)
      const encoder = gpu.device.createCommandEncoder()
      // The scene draws into the stack's texture and the stack writes the
      // canvas. With every stage off the composite is a straight copy, so the
      // path is the same either way and the scene has one pipeline.
      const offscreen = post.target(this.drawWidth, this.drawHeight)
      if (!offscreen) return
      scene.render(encoder, offscreen)
      // The flow is read after the scene has drawn, because the field it
      // names is whichever half of a ping-pong pair this frame wrote.
      post.render(encoder, context.getCurrentTexture().createView(), this.packet, scene.flow)
      gpu.device.queue.submit([encoder.finish()])
    }

    this.hud?.record(this.packet)
    this.hud?.draw(this.packet, {
      fps: 1000 / this.frameMs,
      frameMs: this.frameMs,
      scene: compatibility?.detail ?? scene?.detail ?? '',
      adapter: compatibility?.adapter ?? (gpu ? describe(gpu.info) : ''),
      post: postSummary(this.live),
      preset: preset.name,
    })
    // Timing on the element, so a screenshot or a test can read it.
    if (now - this.reported > 500) {
      this.reported = now
      canvas.dataset.frameMs = this.frameMs.toFixed(1)
      canvas.dataset.scene = this.sceneId
      canvas.dataset.detail = compatibility?.detail ?? scene?.detail ?? ''
      canvas.dataset.post = postSummary(this.live)
      canvas.dataset.preset = preset.id
    }
  }

  // The browser took the device away. Drop everything that depended on it
  // and try once to come back on the same canvas.
  private recover() {
    if (this.disposed) return
    const canvas = this.canvas
    const hudCanvas = this.hudCanvas
    const onFailure = this.onFailure
    if (canvas) this.detach(canvas)
    this.scene?.dispose()
    this.scene = null
    this.post?.dispose()
    this.post = null
    this.client?.dispose()
    this.client = null
    this.gpu = null
    if (!canvas || !hudCanvas || !onFailure) return
    void this.attach(canvas, hudCanvas, onFailure)
      .then((result) => {
        if (result === 'unsupported') onFailure()
      })
      .catch((error: unknown) => {
        console.error('WebGPU recovery failed:', error)
        if (!this.disposed) onFailure()
      })
  }
}

export const renderer = new Renderer()

if (import.meta.hot) import.meta.hot.dispose(() => renderer.dispose())

/** What the development handle below offers; nothing in the app uses it. */
export type VisualizerDevHandle = {
  setPost: (patch: PostPatch) => void
  post: () => PostParams | null
  preset: () => string
}

// A handle for driving the post stack by hand while measuring frame times,
// since nothing in the interface turns a stage off. It is behind Vite's DEV
// flag, so a production build has neither the handle nor this block.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as Window & { visimo?: VisualizerDevHandle }).visimo = {
    setPost: (patch) => renderer.setPost(patch),
    post: () => renderer.postParams,
    preset: () => renderer.presetId,
  }
}

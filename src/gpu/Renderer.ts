/**
 * The one renderer. It owns the device, the feature buffer, the post stack,
 * and one implementation per study that is live, and it outlives every stage.
 * A stage hands it a canvas to draw on and takes it back on unmount; the
 * popout portals a fresh stage into another document, so the canvas and its
 * context are the only things made per mount.
 *
 * It draws a cast rather than a scene. Every frame the studies layer turns
 * whatever is live into a set of knobs per study id and the whole post stack,
 * and this hands each implementation its own:
 *
 *   flows simulate ─► one velocity field ─► clear ─► inks, in cast order ─► post stack
 *
 * A study at presence 0 is not in the live list at all, so it is not
 * resolved, not updated, not encoded and not even constructed. What is
 * constructed is reconciled whenever what is live changes, and an
 * implementation is handed on to another study wanting the same one rather
 * than rebuilt, so Plume to Wash keeps the fluid it has already stirred.
 *
 * The animation loop belongs to the window the canvas is in: the tab's
 * requestAnimationFrame stops when the tab is hidden, and a popout window
 * stays visible while the tab is not.
 */
import { audioGraph } from '../audio/AudioGraph'
import { FeatureClient } from '../audio/FeatureClient'
import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { Hud } from '../hud/Hud'
import { FlowBlend } from '../impls/FlowBlend'
import type { LiveFlow } from '../impls/FlowBlend'
import { DyeInk, FluidFlow } from '../impls/fluid'
import { RibbonInk } from '../impls/RibbonInk'
import { mergePostPatch, patchPostParams, postSummary } from '../post/params'
import type { PostParams, PostPatch } from '../post/params'
import { PostStack, SCENE_FORMAT } from '../post/PostStack'
import type { Tuning } from '../presets/knobs'
import { DEFAULT_FLUID_SIZE } from '../scenes/catalog'
import type { FlowImpl, InkImpl } from '../scenes/Impl'
import { Kaleidoscope } from '../scenes/Kaleidoscope'
import { KaleidoscopeMotion } from '../scenes/kaleidoscope.params'
import { KaleidoscopeWebGL } from '../scenes/KaleidoscopeWebGL'
import type { SceneContext } from '../scenes/Scene'
import type { PinnedCast } from '../studies/cast'
import { castOrDefault, DEFAULT_CAST_ID } from '../studies/casts/index'
import type { ImplId } from '../studies/impls'
import { findStudy, sceneOf } from '../studies/registry'
import { castFrame, liveCast, resolveLive } from '../studies/resolve'
import type { CastFrame, LiveCast } from '../studies/resolve'
import { acquireGpu, configureCanvas, onGpuLost } from './Device'
import type { Gpu, GpuInfo } from './Device'

export type AttachResult = 'ok' | 'unsupported' | 'cancelled'

/** A study whose implementation has nothing to hand it falls back to these. */
const NO_KNOBS: Tuning = {}

/** One built implementation, and which id built it, so it can be handed on. */
type Held<T> = { impl: ImplId; object: T }

/** A live study of one kind, kept so a frame walks it without allocating. */
type LiveEntry = { id: string; impl: ImplId; presence: number }

type Buildable = { init(context: SceneContext): void; dispose(): void }

const describe = (info: GpuInfo) =>
  [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(' ') ||
  'unknown adapter'

class Renderer {
  private gpu: Gpu | null = null
  private compatibility: KaleidoscopeWebGL | null = null
  private readonly compatibilityMotion = new KaleidoscopeMotion()
  private unwatchContext: (() => void) | null = null
  /** Keyed by study id; the order a frame walks them in is the live list's. */
  private readonly flows = new Map<string, Held<FlowImpl>>()
  private readonly inks = new Map<string, Held<InkImpl>>()
  private readonly blend = new FlowBlend()
  private blendReady = false
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
  private fluidSize = DEFAULT_FLUID_SIZE
  private readonly packet = new Float32Array(PACKET_LENGTH)
  // The cast it draws with, what is live of it this frame, and the object the
  // studies layer resolves into. All three belong to the singleton, so the
  // popout round trip keeps the picture.
  private cast: PinnedCast = castOrDefault(DEFAULT_CAST_ID)
  private live: LiveCast = liveCast(this.cast)
  private readonly resolved: CastFrame = castFrame()
  /** The development handle's override, over whatever the cast resolved to. */
  private postPatch: PostPatch | null = null
  // The live list split by kind, rebuilt only when what is live changes, so a
  // frame walks studies without allocating a list per pass.
  private readonly liveFlowStudies: LiveEntry[] = []
  private readonly liveInkStudies: LiveEntry[] = []
  private readonly liveFlows: LiveFlow[] = []
  private frameMs = 16.7
  private drawWidth = 1
  private drawHeight = 1
  private reported = 0
  private disposed = false
  private failed = false
  private readonly unwatchGpu: () => void

  constructor() {
    this.setLive(this.live)
    this.unwatchGpu = onGpuLost(() => this.recover())
  }

  /**
   * What is live from now on. A pinned cast goes through here with every
   * presence at 1, and the director card will call it once a frame with the
   * fades it is running; nothing else in the renderer knows the difference.
   */
  private setLive(next: LiveCast) {
    this.live = next
    this.liveFlowStudies.length = 0
    this.liveInkStudies.length = 0
    for (const entry of next.studies) {
      // A study at presence 0 is not drawn, not resolved and not built.
      if (entry.presence <= 0) continue
      const study = findStudy(entry.id)
      if (!study) continue
      const held = { id: entry.id, impl: study.impl, presence: entry.presence }
      if (study.kind === 'flow') this.liveFlowStudies.push(held)
      else if (study.kind === 'ink') this.liveInkStudies.push(held)
    }
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
    if (!gpu && !this.fallbackDraws()) return 'unsupported'
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
      this.post.useParams(this.resolved.post)
      this.syncImpls()
      const context = configureCanvas(gpu, canvas)
      if (!context) return 'unsupported'
      this.context = context
      canvas.dataset.adapter = describe(gpu.info)
      canvas.dataset.backend = 'webgpu'
    } else {
      // WebGL2 has no compute and one program, so every study but the fractal
      // is skipped there and the cast draws with what is left.
      this.releaseImpls()
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

  /** Stop drawing on this canvas. The device and every implementation stay. */
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
    this.releaseImpls()
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
   * Change one or more post stages by hand, over whatever the cast resolved
   * to. The development handle uses this to switch stages off while frame
   * times are measured; choosing a cast clears it, since a cast brings its
   * own look.
   */
  setPost(patch: PostPatch) {
    this.postPatch = mergePostPatch(this.postPatch ?? {}, patch)
  }

  /** What the stack is actually drawing with: the cast, modulated. */
  get postParams(): PostParams | null {
    return this.compatibility ? this.resolved.post : (this.post?.params ?? null)
  }

  /**
   * Draw this pinned cast: its studies, their numbers and the canvas they
   * draw on. A director will hand over a live cast of its own instead; this
   * is that with every presence at 1.
   */
  setPreset(cast: PinnedCast) {
    this.cast = cast
    this.setLive(liveCast(cast))
    this.postPatch = null
    if (this.compatibility && !this.fallbackDraws()) {
      this.onFailure?.()
      return
    }

    this.syncImpls()
  }

  get presetId() {
    return this.cast.id
  }

  setFluidSize(size: number) {
    this.fluidSize = size
    // One control, one grid: every fluid in the cast moves together.
    for (const held of this.flows.values())
      if (held.object instanceof FluidFlow) held.object.setSize(size)
  }

  /** Whether anything in the cast can be drawn without compute. */
  private fallbackDraws() {
    return this.liveInkStudies.some((entry) => entry.impl === 'fractal')
  }

  // Construction stays here so every implementation shares one device and one
  // post stack, and so nothing in the studies layer has to import a shader.
  private buildFlow(impl: ImplId): FlowImpl | null {
    if (impl === 'fluid') return new FluidFlow(this.fluidSize)
    return null
  }

  private buildInk(impl: ImplId): InkImpl | null {
    if (impl === 'fractal') return new Kaleidoscope()
    if (impl === 'ribbon')
      return this.post ? new RibbonInk(this.post, () => this.client?.waveform ?? null) : null
    if (impl === 'dye') {
      // The dye draws the field a fluid flow is stirring, which is what the
      // study's `requires` promises is in the cast beside it.
      for (const held of this.flows.values())
        if (held.object instanceof FluidFlow) return new DyeInk(held.object)
    }

    return null
  }

  /**
   * Build what is live and release what is not. An implementation whose study
   * has left is handed to a newcomer that wants the same one rather than
   * rebuilt, so switching between two casts that draw the same way keeps the
   * field and the trails; anything genuinely built or released empties the
   * canvas, the way changing scene always has.
   */
  private syncImpls() {
    const gpu = this.gpu
    if (!gpu || this.compatibility) return
    const flows = this.reconcile(this.liveFlowStudies, this.flows, (impl) => this.buildFlow(impl))
    // A dye ink is bound to the flow it was built against, so one whose flow
    // has gone cannot be handed on and is rebuilt against a live one.
    for (const [id, held] of this.inks)
      if (held.object instanceof DyeInk && !this.holds(held.object.source)) {
        this.inks.delete(id)
        held.object.dispose()
      }

    const inks = this.reconcile(this.liveInkStudies, this.inks, (impl) => this.buildInk(impl))
    if (!this.blendReady) {
      this.blend.init({ device: gpu.device, format: SCENE_FORMAT, software: gpu.info.software })
      this.blendReady = true
    }

    if (flows || inks) this.post?.resetHistory()
    this.sizeImpls()
  }

  private holds(flow: FlowImpl) {
    for (const held of this.flows.values()) if (held.object === flow) return true
    return false
  }

  private reconcile<T extends Buildable>(
    want: readonly LiveEntry[],
    held: Map<string, Held<T>>,
    build: (impl: ImplId) => T | null,
  ): boolean {
    const gpu = this.gpu
    if (!gpu) return false
    const wanted = new Set(want.map((entry) => entry.id))
    const spare: Held<T>[] = []
    for (const [id, entry] of held)
      if (!wanted.has(id)) {
        held.delete(id)
        spare.push(entry)
      }

    let changed = false
    for (const { id, impl } of want) {
      if (held.has(id)) continue
      const at = spare.findIndex((entry) => entry.impl === impl)
      const reused = at >= 0 ? spare.splice(at, 1)[0] : undefined
      if (reused) {
        held.set(id, reused)
        continue
      }

      const object = build(impl)
      // A study whose implementation this renderer has nothing for is
      // skipped, and the cast draws with what is left.
      if (!object) continue
      object.init({ device: gpu.device, format: SCENE_FORMAT, software: gpu.info.software })
      held.set(id, { impl, object })
      changed = true
    }

    for (const entry of spare) {
      entry.object.dispose()
      changed = true
    }

    return changed
  }

  private releaseImpls() {
    for (const held of this.flows.values()) held.object.dispose()
    for (const held of this.inks.values()) held.object.dispose()
    this.flows.clear()
    this.inks.clear()
    this.blend.dispose()
    this.blendReady = false
  }

  // The inks and the post stack share one size, which an ink may hold below
  // the canvas. Every post stage samples by uv, so the composite scales it up.
  private sizeImpls() {
    const canvas = this.canvas
    if (!canvas) return
    let budget = Infinity
    for (const { id } of this.liveInkStudies)
      budget = Math.min(budget, this.inks.get(id)?.object.maxPixels ?? Infinity)
    const shrink = Math.min(1, Math.sqrt(budget / (canvas.width * canvas.height)))
    this.drawWidth = Math.max(1, Math.round(canvas.width * shrink))
    this.drawHeight = Math.max(1, Math.round(canvas.height * shrink))
    for (const held of this.flows.values()) held.object.resize(this.drawWidth, this.drawHeight)
    for (const held of this.inks.values()) held.object.resize(this.drawWidth, this.drawHeight)
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
    // A fresh implementation still needs its size when HMR or recovery keeps
    // the canvas and its existing drawing-buffer dimensions.
    this.sizeImpls()
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

  /** A study's knobs for this frame, or nothing when its implementation takes none. */
  private knobsOf(id: string): Tuning {
    return this.resolved.knobs.get(id) ?? NO_KNOBS
  }

  private drawFrame(now: number) {
    this.frame = 0
    const { canvas, context, gpu, post, compatibility } = this
    if (!canvas || (!compatibility && (!context || !gpu || !post || gpu.lost))) return
    const win = canvas.ownerDocument.defaultView ?? window
    this.frame = win.requestAnimationFrame(this.tick)
    const inks = this.liveInkStudies
    // Skip display frames a capped ink does not want. The 0.75 lets a display
    // that is not a multiple of the cap land just above it, not far below:
    // 144 Hz draws at 72, 176 Hz at 59.
    let cap = 0
    for (const { id } of inks) {
      const wanted = this.inks.get(id)?.object.maxFps
      if (wanted) cap = cap ? Math.min(cap, wanted) : wanted
    }

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

    // The mapping is applied here, on the CPU, and nowhere else: every
    // implementation and the stack read numbers already modulated.
    // Tension is packet row 47 and is read from there, for a pinned cast as
    // much as a chosen one. A pinned cast used to carry a tension of its own,
    // fixed at 0 from before the row existed, which left every study's
    // tension row dead under all five shipped casts: nothing wound up with a
    // build unless a director was choosing.
    const live = this.live
    const tension = this.packet[F.tension] ?? 0
    resolveLive(live.studies, live.canvas, this.packet, tension, this.resolved)
    if (this.postPatch) patchPostParams(this.resolved.post, this.postPatch)
    const flows = this.liveFlowStudies

    if (compatibility) {
      // One program and no compute: the fractal is the only study this path
      // draws, and the rest of the cast is skipped. Presence is not read
      // here, because nothing fades a cast until the director lands.
      const fractal = inks.find((entry) => entry.impl === 'fractal')
      if (fractal)
        compatibility.render(this.packet, dt, this.knobsOf(fractal.id), this.resolved.post)
    } else if (gpu && context && post) {
      // Flows first and inks second, because a dye ink's numbers reach the
      // solver's uniform through the flow it draws.
      for (const entry of flows)
        this.flows
          .get(entry.id)
          ?.object.update(this.packet, dt, this.knobsOf(entry.id), entry.presence)
      for (const entry of inks)
        this.inks
          .get(entry.id)
          ?.object.update(this.packet, dt, this.knobsOf(entry.id), entry.presence)
      const encoder = gpu.device.createCommandEncoder()
      const offscreen = post.target(this.drawWidth, this.drawHeight)
      if (!offscreen) return
      // The flows are stirred before the inks draw, so the picture is carried
      // along the field this frame solved rather than the last one's.
      this.liveFlows.length = 0
      for (const entry of flows) {
        const held = this.flows.get(entry.id)
        if (!held) continue
        held.object.simulate(encoder)
        // Read after simulating, because the field a flow names is whichever
        // half of a ping-pong pair this frame wrote.
        const field = held.object.flow
        if (field) this.liveFlows.push({ flow: field, presence: entry.presence })
      }

      const carried = this.blend.blend(encoder, this.liveFlows)
      // The uniform before any ink, because the ribbon ink reads it.
      post.prepare(this.packet, carried?.cover ?? null)
      post.clear(encoder, offscreen)
      for (const entry of inks) this.inks.get(entry.id)?.object.render(encoder, offscreen)
      post.render(encoder, context.getCurrentTexture().createView(), this.packet, carried)
      gpu.device.queue.submit([encoder.finish()])
    }

    const detail = compatibility?.detail ?? this.detail()
    this.hud?.record(this.packet)
    this.hud?.draw(this.packet, {
      fps: 1000 / this.frameMs,
      frameMs: this.frameMs,
      scene: detail,
      adapter: compatibility?.adapter ?? (gpu ? describe(gpu.info) : ''),
      post: postSummary(this.resolved.post),
      preset: this.cast.name,
    })
    // Timing on the element, so a screenshot or a test can read it.
    if (now - this.reported > 500) {
      this.reported = now
      canvas.dataset.frameMs = this.frameMs.toFixed(1)
      canvas.dataset.scene = sceneOf(inks.map((entry) => entry.id))
      canvas.dataset.detail = detail
      canvas.dataset.post = postSummary(this.resolved.post)
      canvas.dataset.preset = this.cast.id
      canvas.dataset.cast = live.studies
        .filter((entry) => entry.presence > 0)
        .map((entry) => entry.id)
        .join(' ')
    }
  }

  /**
   * What is drawing, inks first and then any flow with a line of its own.
   * `data-detail` is public API, so the five pinned casts read exactly as
   * their presets did: a fluid flow with a dye ink on it says nothing,
   * because the ink already names that grid.
   */
  private detail() {
    const parts: string[] = []
    for (const { id } of this.liveInkStudies) {
      const line = this.inks.get(id)?.object.detail
      if (line) parts.push(line)
    }

    for (const { id } of this.liveFlowStudies) {
      const line = this.flows.get(id)?.object.detail
      if (line) parts.push(line)
    }

    return parts.join(' + ')
  }

  // The browser took the device away. Drop everything that depended on it
  // and try once to come back on the same canvas.
  private recover() {
    if (this.disposed) return
    const canvas = this.canvas
    const hudCanvas = this.hudCanvas
    const onFailure = this.onFailure
    if (canvas) this.detach(canvas)
    this.releaseImpls()
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

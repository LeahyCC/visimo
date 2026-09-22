/**
 * The one renderer. It owns the device, the feature buffer, the post stack,
 * and one implementation per study that is live, and it outlives every stage.
 * A stage hands it a canvas to draw on and takes it back on unmount; the
 * popout portals a fresh stage into another document, so the canvas and its
 * context are the only things made per mount.
 *
 * It draws a cast rather than a scene, and the cast is either one a host has
 * pinned or one the director is choosing. It owns that director and steps it
 * once a frame with the packet and the real `dt`; what comes back is what is
 * live. Every frame the studies layer turns that into a set of knobs per
 * study id and the whole post stack, and this hands each implementation its
 * own:
 *
 *   director ─► flows simulate ─► one velocity field ─► clear ─► inks ─► post stack
 *
 * A study at presence 0 is not in the live list at all, so it is not
 * resolved, not updated, not encoded and not even constructed. What is
 * constructed is reconciled only on a frame where the set of live ids moved,
 * and an implementation nothing is asking for is held for a few seconds
 * before it is released, so a study that comes straight back is not rebuilt.
 * Two studies of one implementation, which is what a fade from lazy fluid to
 * turbulent fluid is, run as one with their knobs blended by presence.
 *
 * The animation loop belongs to the window the canvas is in: the tab's
 * requestAnimationFrame stops when the tab is hidden, and a popout window
 * stays visible while the tab is not.
 */
import { audioGraph } from '../audio/AudioGraph'
import { FeatureClient } from '../audio/FeatureClient'
import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { Director } from '../director/director'
import type { MomentWeights, Playhead } from '../director/moment'
import { Hud } from '../hud/Hud'
import { AnalyticFlow } from '../impls/analytic'
import { BlackHoleInk } from '../impls/BlackHoleInk'
import { CausticsInk } from '../impls/CausticsInk'
import { FlowBlend } from '../impls/FlowBlend'
import type { LiveFlow } from '../impls/FlowBlend'
import { DyeInk, FluidFlow } from '../impls/fluid'
import { GridInk } from '../impls/GridInk'
import { HaloInk } from '../impls/HaloInk'
import { LasersInk } from '../impls/LasersInk'
import { LightningInk } from '../impls/LightningInk'
import { MorphInk } from '../impls/MorphInk'
import { ParticleField } from '../impls/ParticleField'
import { DUST_PROFILE, SPARKS_PROFILE } from '../impls/particles.params'
import { PetalsInk } from '../impls/PetalsInk'
import { RibbonInk } from '../impls/RibbonInk'
import { RingsInk } from '../impls/RingsInk'
import { ShardsInk } from '../impls/ShardsInk'
import { SpectrumInk } from '../impls/SpectrumInk'
import { StreaksInk } from '../impls/StreaksInk'
import { setPalette } from '../palettes/active'
import { mergePostPatch, patchPostParams, postSummary } from '../post/params'
import type { PostParams, PostPatch } from '../post/params'
import { PostStack, SCENE_FORMAT } from '../post/PostStack'
import type { Tuning } from '../presets/knobs'
import { DEFAULT_FLUID_SIZE } from '../scenes/catalog'
import type { FlowImpl, InkImpl } from '../scenes/Impl'
import { Kaleidoscope } from '../scenes/Kaleidoscope'
import { KaleidoscopeMotion } from '../scenes/kaleidoscope.params'
import { KaleidoscopeWebGL } from '../scenes/KaleidoscopeWebGL'
import type { Flow, SceneContext } from '../scenes/Scene'
import { defaultCanvas } from '../studies/cast'
import type { PinnedCast } from '../studies/cast'
import { castOrDefault, CASTS, DEFAULT_CAST_ID } from '../studies/casts/index'
import type { ImplId } from '../studies/impls'
import { findStudy, sceneOf } from '../studies/registry'
import { blendKnobs, castFrame, forgetShapes, liveCast, resolveLive } from '../studies/resolve'
import type { CastFrame, KnobsAt, LiveCast, LiveStudy } from '../studies/resolve'
import type { Character } from '../studies/types'
import { acquireGpu, configureCanvas, onGpuLost } from './Device'
import type { Gpu, GpuInfo } from './Device'

export type AttachResult = 'ok' | 'unsupported' | 'cancelled'

/** What a host asks the stage to draw: a fixed cast, or the song's own choice. */
export type Live = PinnedCast | 'auto'

/**
 * Where the playhead is read from: a ref, so a host hands it over once and
 * the renderer reads it on every frame it draws. `useRef<HTMLAudioElement>`
 * is one as it stands.
 */
export type PlayheadSource = { readonly current: Playhead | null }

/**
 * What the demo's study bench hands the renderer. It is a development hook
 * and not something a host needs: a host pins a cast or lets the director
 * choose, and the bench wants to draw one study under conditions set by hand.
 * It stands over both of them for as long as it is set and gives the picture
 * back to whichever was there when it is cleared.
 */
export type Bench = {
  /** Drawn instead of the pinned cast or the director's. Presences may be moved in place. */
  live: LiveCast
  /**
   * Once per drawn frame, with the real `dt`, after the packet is written and
   * before the director or the resolver reads it. Rows written here are what
   * every study and the director see.
   */
  frame?: (packet: Float32Array, dt: number) => void
  /** Samples for the ribbon in place of the analyser's, or null to use the analyser's. */
  waveform?: () => Float32Array | null
}

/** A study whose implementation has nothing to hand it falls back to these. */
const NO_KNOBS: Tuning = {}

/** One built implementation, and which id built it, so it can be handed on. */
type Held<T> = { impl: ImplId; object: T }

/** One nothing is asking for any more, and how long it is kept for. */
type Spare<T> = Held<T> & { left: number }

/**
 * How long an implementation is held after the last study wanting it reached
 * presence 0. The change that most often asks for one straight back is a
 * novelty spike fading a cast out and the confirmed section, about six
 * seconds behind the music, settling it back again; holding for that long
 * turns the round trip into a fade of the numbers rather than a rebuild, and
 * a rebuild is where a black frame and a lost field come from.
 */
const SPARE_SECONDS = 6

/**
 * How often the character is handed to a host after it settles. The slowest
 * of its own smoothers runs over thirty seconds, so anything faster reports a
 * number that has not finished moving, and what a host does with it is save
 * one value for the next play of the track.
 */
const CHARACTER_SECONDS = 30

/**
 * How far the playhead may drift from the frame clock before it counts as a
 * seek. Well over any stutter or a slow frame, well under the shortest drag.
 */
const SEEK_SECONDS = 1.5

/**
 * Nothing on screen. What is live between a host turning the director on and
 * the first frame it steps, so the cast a host has just stopped pinning is
 * not built for one frame and torn down again.
 */
const NOTHING_LIVE: LiveCast = { studies: [], canvas: defaultCanvas(), tension: 0 }

/** The one ink the WebGL2 path has, so the only one it can draw. */
const FALLBACK_IMPL: ImplId = 'fractal'

const drawsWithoutCompute = (ids: readonly string[]) =>
  ids.some((id) => findStudy(id)?.impl === FALLBACK_IMPL)

/**
 * What the WebGL2 path stands in with when what is live holds nothing it can
 * draw: the default pinned preset, or the first shipped cast that path can
 * draw when the default is not one, which is Prism. A cast the director chose
 * may hold no fractal at all, and a song is not worth stopping for that.
 */
const FALLBACK_CAST: PinnedCast =
  (() => {
    const preset = castOrDefault(DEFAULT_CAST_ID)
    if (drawsWithoutCompute(preset.inks)) return preset
    return CASTS.find((cast) => drawsWithoutCompute(cast.inks))
  })() ?? castOrDefault(DEFAULT_CAST_ID)

/**
 * A live study of one kind, kept so a frame walks it without allocating. It
 * holds the director's own entry rather than a copy of its presence, because
 * the presence moves every frame and these lists are rebuilt only when the
 * ids do.
 */
type LiveEntry = { id: string; impl: ImplId; live: LiveStudy }

type Buildable = { init(context: SceneContext): void; dispose(): void }

/** How the two maps are keyed. See the fields they key. */
const byImpl = (entry: LiveEntry): string => entry.impl
const byId = (entry: LiveEntry): string => entry.id

/** The first one of this implementation, taken out of the list it was in. */
function take<T extends { impl: ImplId }>(held: T[], impl: ImplId): T | undefined {
  const at = held.findIndex((entry) => entry.impl === impl)
  return at >= 0 ? held.splice(at, 1)[0] : undefined
}

/** One frame of the grace, and what has run out of it released. */
function age<T extends Buildable>(spares: Spare<T>[], dt: number) {
  for (let at = spares.length - 1; at >= 0; at -= 1) {
    const spare = spares[at]
    if (!spare) continue
    spare.left -= dt
    if (spare.left > 0) continue
    spare.object.dispose()
    spares.splice(at, 1)
  }
}

const describe = (info: GpuInfo) =>
  [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(' ') ||
  'unknown adapter'

class Renderer {
  private gpu: Gpu | null = null
  private compatibility: KaleidoscopeWebGL | null = null
  private readonly compatibilityMotion = new KaleidoscopeMotion()
  private unwatchContext: (() => void) | null = null
  // Flows are keyed by implementation and inks by study id. Two live flows of
  // one implementation are one solver at two sets of numbers, so they share
  // the object and their knobs are blended; two inks of one implementation
  // would each be drawing something of their own and cannot.
  private readonly flows = new Map<string, Held<FlowImpl>>()
  private readonly inks = new Map<string, Held<InkImpl>>()
  private readonly spareFlows: Spare<FlowImpl>[] = []
  private readonly spareInks: Spare<InkImpl>[] = []
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
  // The cast a host pinned, that cast as a live one, what is live this frame
  // and the object the studies layer resolves into. All of them belong to the
  // singleton, so the popout round trip keeps the picture. With nothing
  // pinned the director's own frame is what is live.
  private pinned: PinnedCast | null = castOrDefault(DEFAULT_CAST_ID)
  private pinnedLive: LiveCast = liveCast(castOrDefault(DEFAULT_CAST_ID))
  private standIn: LiveCast | null = null
  private bench: Bench | null = null
  private live: LiveCast = this.pinnedLive
  private readonly resolved: CastFrame = castFrame()
  /**
   * The one director, stepped every frame whether or not anything is pinned.
   * It is never handed the pinned cast, though it takes one: a host pins a
   * cast object and the demo makes a fresh one on every knob drag, and
   * rebuilding the director around each of those would restart the character
   * from neutral every time a slider moved. So the renderer picks what is
   * live, and the director reads the song either way, which is what
   * `onCharacter` and a host's overlay want under a pinned preset too and
   * what leaves a cast already chosen for the track when one is turned on.
   */
  private director = new Director()
  private stepped = false
  /** The last starting character a host gave, kept for the next `newTrack`. */
  private opening: Partial<Character> | undefined
  private onCharacter: ((character: Character) => void) | null = null
  private characterDue = 0
  private playhead: PlayheadSource | null = null
  /** Where the playhead was on the last frame, to see it jump; null before the first. */
  private playheadAt: number | null = null
  /** The development handle's override, over whatever the cast resolved to. */
  private postPatch: PostPatch | null = null
  // The live list split by kind, rebuilt only when what is live changes, so a
  // frame walks studies without allocating a list per pass.
  private readonly liveFlowStudies: LiveEntry[] = []
  private readonly liveInkStudies: LiveEntry[] = []
  private readonly liveIds: string[] = []
  private readonly liveFlows: LiveFlow[] = []
  /**
   * The one field this frame's flows blended to, or null. Written once a frame
   * before any ink draws and read by an ink through the implementation
   * context, since which half of a ping-pong pair it names alternates.
   */
  private carried: Flow | null = null
  // One flow implementation's live studies and the knobs they blend to, both
  // written over every frame.
  private readonly flowParts: KnobsAt[] = []
  private readonly flowKnobs = new Map<string, Record<string, number>>()
  private readonly flowPresence = new Map<string, number>()
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
   * presence at 1 and the director hands over what it is fading; nothing else
   * in the renderer knows the difference. The lists hold the director's own
   * entries, so the presences move without this running again.
   */
  private setLive(next: LiveCast) {
    this.live = next
    this.liveFlowStudies.length = 0
    this.liveInkStudies.length = 0
    this.liveIds.length = 0
    for (const entry of next.studies) {
      // A study at presence 0 is not drawn, not resolved and not built.
      if (entry.presence <= 0) continue
      this.liveIds.push(entry.id)
      const study = findStudy(entry.id)
      if (!study) continue
      const held = { id: entry.id, impl: study.impl, live: entry }
      if (study.kind === 'flow') this.liveFlowStudies.push(held)
      else if (study.kind === 'ink') this.liveInkStudies.push(held)
    }
  }

  /**
   * Whether the set of live ids has moved since the lists were built. The
   * director hands back the same list of the same entries every frame and
   * writes the presences in place, so this is what keeps the reconcile and
   * the two list rebuilds off the frames where only a fade moved.
   */
  private moved(studies: readonly LiveStudy[]): boolean {
    let at = 0
    for (const entry of studies) {
      if (entry.presence <= 0) continue
      if (this.liveIds[at] !== entry.id) return true
      at += 1
    }

    return at !== this.liveIds.length
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
      // The context holds the device, so a fresh one has to build a fresh context.
      this.implContextCache = null
      if (!this.post) {
        this.post = new PostStack()
        this.post.init(gpu.device, gpu.format)
      }
      this.post.useParams(this.resolved.post)
      this.syncImpls(true)
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
    this.implContextCache = null
    this.carried = null
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
   * What to draw: a pinned cast, which is its studies, their numbers and the
   * canvas they draw on, or `auto`, which hands the choosing to the director
   * and is that same shape with the presences moving.
   */
  setPreset(cast: Live) {
    this.postPatch = null
    if (cast === 'auto') {
      this.pinned = null
      // Nothing is emptied and nothing is built here: the next frame takes
      // what the director has been choosing all along, and the whole point of
      // one canvas is that a change of cast morphs what is already on it.
      this.setLive(NOTHING_LIVE)
      return
    }

    this.pinned = cast
    this.pinnedLive = liveCast(cast)
    this.setLive(this.pinnedLive)
    if (this.compatibility && !this.fallbackDraws()) {
      this.onFailure?.()
      return
    }

    // A change of pinned cast is the one time the canvas is emptied.
    this.syncImpls(true)
  }

  /**
   * Draw what the study bench asks for, and let it write the packet, until it
   * is cleared with null. The director is still stepped on that packet, so its
   * reading follows the bench's sliders. A new cast empties the canvas the way
   * a change of pinned cast does, so a study is judged on its own picture and
   * not on the last one's trails; the same cast handed again is left alone.
   *
   * Leaving the bench starts the director again, as a new track does. What it
   * read in there was the sliders and a synthetic beat, not a song, and left
   * standing it would go on choosing for a character no track ever had, fully
   * settled, until the half minute smoothers drifted back.
   */
  setBench(bench: Bench | null) {
    const changed = bench !== null && bench.live !== this.bench?.live
    if (this.bench && !bench) this.newTrack()
    this.bench = bench
    if (!bench || !changed) return
    this.setLive(bench.live)
    this.syncImpls(true)
  }

  /**
   * Where the character reader opens, for a host that knows the track: a
   * genre tag, or the values it saved from the last play of this one. It is a
   * starting point and nothing else, so it is taken until the first frame is
   * drawn and ignored after that, which is also what lets a host pass a fresh
   * object on every render.
   */
  setStartCharacter(start: Partial<Character> | undefined) {
    this.opening = start
    if (this.stepped) return
    this.director = new Director({ start })
  }

  /**
   * A different track is playing. Everything the director holds is about one
   * song: how settled its character is, which cast each section had, and the
   * seed its rotation counts from. Carried into the next song, the opening
   * thirty seconds are never a guess again, a section is handed a cast that
   * another track's section of the same number had, and `startCharacter` for
   * the new track is never read. So the director starts again, from whatever
   * starting character the host last gave. The canvas is left alone: one
   * track running into the next is a change of cast like any other, and
   * should morph.
   */
  newTrack() {
    this.director = new Director({ start: this.opening })
    this.characterDue = 0
    this.client?.newTrack()
    this.playheadAt = null
    // A spring mid-ring and a total that has been climbing for three minutes
    // are both about the track that has just stopped playing.
    forgetShapes(this.resolved)
  }

  /**
   * Where the track is and how long it is, for a host that plays files. It is
   * a source read on every frame and not a value pushed to, so it costs the
   * host nothing to keep current: the element's own `currentTime` is the
   * position, and a new track brings its own `duration` without anyone
   * telling the renderer. Kept across `newTrack`, since it is the host's and
   * not the song's.
   */
  setPlayhead(source: PlayheadSource | null) {
    this.playhead = source
  }

  /**
   * A playhead that moved by much more or less than the frame did has been
   * dragged, and the extractor is told, since a seek reads to it as the
   * biggest change the track ever made. Only a host that gives a playhead can
   * be watched; without one a seek costs a dense track its sections until the
   * next track. A tab that was hidden reads as a jump too, which is harmless:
   * the scales start over and are back within half a minute.
   */
  private watchForSeek(position: number | undefined, dt: number) {
    if (position === undefined || !Number.isFinite(position)) return
    const last = this.playheadAt
    this.playheadAt = position
    if (last !== null && Math.abs(position - last - dt) > SEEK_SECONDS) {
      this.client?.seeked()
      // The shaped rows are about the seconds of music just played, which are
      // now the wrong seconds, so they start again as they do on a new track.
      forgetShapes(this.resolved)
    }
  }

  /**
   * Called with the character once it has settled and rarely after that, so a
   * host can save it for the next play of the track. A copy, because the
   * reader writes its own object in place every frame.
   */
  setOnCharacter(report: ((character: Character) => void) | null) {
    this.onCharacter = report
  }

  /** The pinned cast's id, or `auto` while the director is choosing. */
  /** A copy, since the packet is one array written over every frame. */
  get features(): Float32Array {
    return this.packet.slice()
  }

  get presetId() {
    return this.pinned?.id ?? 'auto'
  }

  /** What is on screen this frame, with the fade each study is at. */
  get liveCast(): LiveCast {
    return this.live
  }

  /** Where the song sits, how far that is to be believed, and where in it we are. */
  get character(): Character {
    return this.director.character
  }

  get settled(): number {
    return this.director.settled
  }

  get moments(): MomentWeights {
    return this.director.weights
  }

  setFluidSize(size: number) {
    this.fluidSize = size
    // One control, one grid: every fluid moves together, including one being
    // held spare, which may be drawing again a few seconds from now.
    for (const held of this.flows.values())
      if (held.object instanceof FluidFlow) held.object.setSize(size)
    for (const spare of this.spareFlows)
      if (spare.object instanceof FluidFlow) spare.object.setSize(size)
  }

  /**
   * Whether the WebGL2 path has anything to draw. A pinned cast has to hold
   * an ink it can draw itself; with the director choosing, or the bench
   * drawing, there is always the stand-in below, so it always has.
   */
  private fallbackDraws() {
    if (!this.pinned || this.bench) return true
    return this.liveInkStudies.some((entry) => entry.impl === FALLBACK_IMPL)
  }

  /**
   * What the WebGL2 path draws this frame. It has one program and no compute,
   * so the fractal is the only ink there and the rest of a cast is skipped. A
   * cast the director chose may hold no fractal at all, and a song is not
   * worth stopping for that: the stand-in draws in its place. A pinned cast
   * is left alone, so a host that pins one this path cannot draw still hears
   * about it through `onFailure`.
   */
  private withoutCompute(live: LiveCast): LiveCast {
    if (this.pinned && !this.bench) return live
    const holds = live.studies.some(
      (entry) => entry.presence > 0 && findStudy(entry.id)?.impl === FALLBACK_IMPL,
    )
    if (holds) return live
    return (this.standIn ??= liveCast(FALLBACK_CAST))
  }

  // Construction stays here so every implementation shares one device and one
  // post stack, and so nothing in the studies layer has to import a shader.
  private buildFlow(impl: ImplId): FlowImpl | null {
    if (impl === 'fluid') return new FluidFlow(this.fluidSize)
    if (impl === 'analytic') return new AnalyticFlow()
    return null
  }

  private buildInk(impl: ImplId): InkImpl | null {
    if (impl === 'fractal') return new Kaleidoscope()
    if (impl === 'shards') return new ShardsInk()
    if (impl === 'ribbon')
      return this.post
        ? new RibbonInk(this.post, () => this.bench?.waveform?.() ?? this.client?.waveform ?? null)
        : null
    if (impl === 'streaks') return new StreaksInk()
    // Two profiles over one compute-simulated pool; see `particles.params.ts`.
    if (impl === 'dust') return new ParticleField(DUST_PROFILE)
    if (impl === 'caustics') return new CausticsInk()
    if (impl === 'halo') return new HaloInk()
    if (impl === 'rings') return new RingsInk()
    if (impl === 'spectrum') return new SpectrumInk()
    if (impl === 'sparks') return new ParticleField(SPARKS_PROFILE)
    if (impl === 'lasers') return new LasersInk()
    if (impl === 'morph') return new MorphInk()
    if (impl === 'petals') return new PetalsInk()
    if (impl === 'lightning') return new LightningInk()
    if (impl === 'grid') return new GridInk()
    if (impl === 'blackhole') return new BlackHoleInk()
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
  private syncImpls(reset: boolean) {
    const gpu = this.gpu
    if (!gpu || this.compatibility) return
    const flows = this.reconcile(
      this.liveFlowStudies,
      this.flows,
      byImpl,
      (impl) => this.buildFlow(impl),
      this.spareFlows,
    )
    // A dye ink is bound to the flow it was built against, so one whose flow
    // has gone cannot be handed on and is rebuilt against a live one.
    for (const [id, held] of this.inks)
      if (held.object instanceof DyeInk && !this.holds(held.object.source)) {
        this.inks.delete(id)
        held.object.dispose()
      }

    // The same for one waiting among the spares. A flow and its dye go spare
    // on their own clocks, so the flow can be released while the dye still has
    // a second left, and a dye taken back then would draw a field that has
    // been destroyed.
    for (let at = this.spareInks.length - 1; at >= 0; at -= 1) {
      const spare = this.spareInks[at]
      if (spare?.object instanceof DyeInk && !this.holds(spare.object.source)) {
        spare.object.dispose()
        this.spareInks.splice(at, 1)
      }
    }

    const inks = this.reconcile(
      this.liveInkStudies,
      this.inks,
      byId,
      (impl) => this.buildInk(impl),
      this.spareInks,
    )
    if (!this.blendReady) {
      this.blend.init(this.implContext(gpu))
      this.blendReady = true
    }

    // Only a change of pinned cast empties the canvas, the way changing scene
    // always did. Under the director a section change would build the
    // incoming ink and, a few seconds later, release the outgoing one, so
    // every glide would black the picture out twice; the whole point of one
    // canvas is that a change of cast morphs what is already on it.
    if (reset && (flows || inks)) this.post?.resetHistory()
    this.sizeImpls()
  }

  /**
   * What every implementation is built on: the device, the format, and the two
   * things a frame offers back that an implementation may read while it
   * encodes. Both are functions and not values, because both name a half of a
   * ping-pong that alternates: the flow is whatever this frame's flows blended
   * to and only exists once the encoder does, and the canvas is the history
   * the inks are NOT drawing into. It is made once and kept, so the closures
   * an implementation holds do not change under it when the device does not.
   */
  private implContext(gpu: Gpu): SceneContext {
    return (this.implContextCache ??= {
      device: gpu.device,
      format: SCENE_FORMAT,
      software: gpu.info.software,
      flow: () => this.carried,
      canvas: () => this.post?.lastCanvas ?? null,
    })
  }

  private implContextCache: SceneContext | null = null

  private holds(flow: FlowImpl) {
    for (const held of this.flows.values()) if (held.object === flow) return true
    return false
  }

  private reconcile<T extends Buildable>(
    want: readonly LiveEntry[],
    held: Map<string, Held<T>>,
    key: (entry: LiveEntry) => string,
    build: (impl: ImplId) => T | null,
    spares: Spare<T>[],
  ): boolean {
    const gpu = this.gpu
    if (!gpu) return false
    const wanted = new Set(want.map(key))
    const leaving: Held<T>[] = []
    for (const [id, entry] of held)
      if (!wanted.has(id)) {
        held.delete(id)
        leaving.push(entry)
      }

    let changed = false
    for (const entry of want) {
      const id = key(entry)
      // Two studies of one implementation share its object, so the second of
      // them is already held under that key.
      if (held.has(id)) continue
      // What has just left first and what is being held spare second: either
      // is the same implementation with a field or a trail already going.
      const reused = take(leaving, entry.impl) ?? take(spares, entry.impl)
      if (reused) {
        held.set(id, { impl: reused.impl, object: reused.object })
        continue
      }

      const object = build(entry.impl)
      // A study whose implementation this renderer has nothing for is
      // skipped, and the cast draws with what is left.
      if (!object) continue
      object.init(this.implContext(gpu))
      held.set(id, { impl: entry.impl, object })
      changed = true
    }

    // Nothing is torn down on the frame its study left. See `SPARE_SECONDS`.
    for (const entry of leaving) {
      spares.push({ ...entry, left: SPARE_SECONDS })
      changed = true
    }

    return changed
  }

  /** One frame of the grace on the implementations nothing is asking for. */
  private ageSpares(dt: number) {
    age(this.spareFlows, dt)
    age(this.spareInks, dt)
  }

  /** The blended knobs one flow implementation is handed, kept between frames. */
  private blendedKnobs(impl: string): Record<string, number> {
    let out = this.flowKnobs.get(impl)
    if (!out) {
      out = {}
      this.flowKnobs.set(impl, out)
    }

    return out
  }

  private releaseImpls() {
    for (const held of this.flows.values()) held.object.dispose()
    for (const held of this.inks.values()) held.object.dispose()
    for (const spare of this.spareFlows) spare.object.dispose()
    for (const spare of this.spareInks) spare.object.dispose()
    this.flows.clear()
    this.inks.clear()
    this.spareFlows.length = 0
    this.spareInks.length = 0
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

  /**
   * The numbers one study was drawn with this frame, or nothing when it is not
   * live. The bench's readout reads this rather than resolving the study
   * again: a shaped row remembers where it was, so a second resolver stepping
   * the same rows at the panel's own rate would be reading a different study
   * from the one on screen.
   */
  resolvedKnobs(id: string): Readonly<Record<string, number>> | undefined {
    return this.resolved.knobs.get(id)
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
    this.bench?.frame?.(this.packet, dt)

    // The director is stepped whatever is drawing, because the character and
    // the moment are read under a pinned cast as much as under none: a host
    // saves one for the next play of the track and shows the other. What it
    // chose is what is live unless a host has pinned something.
    this.stepped = true
    const playhead = this.playhead?.current ?? undefined
    this.watchForSeek(playhead?.currentTime, dt)
    const chosen = this.director.step(this.packet, dt, playhead)
    this.reportCharacter(dt)
    const shown = this.bench?.live ?? (this.pinned ? this.pinnedLive : chosen)
    const next = compatibility ? this.withoutCompute(shown) : shown
    // The director hands back one list of one set of entries and moves the
    // presences in place, so the lists and what is built are reconciled only
    // on a frame where the ids themselves moved.
    if (next !== this.live || this.moved(next.studies)) {
      this.setLive(next)
      this.syncImpls(false)
    }

    this.ageSpares(dt)

    // The mapping is applied here, on the CPU, and nowhere else: every
    // implementation and the stack read numbers already modulated.
    // Tension is packet row 47 and is read from there, for a pinned cast as
    // much as a chosen one. A pinned cast used to carry a tension of its own,
    // fixed at 0 from before the row existed, which left every study's
    // tension row dead under all five shipped casts: nothing wound up with a
    // build unless a director was choosing.
    const live = this.live
    const tension = this.packet[F.tension] ?? 0
    resolveLive(live.studies, live.canvas, this.packet, tension, this.resolved, dt, live.palette)
    // Before any flow or ink updates, since they read the shared palette: the
    // fluid to write its lookup table and the inks for their colours.
    setPalette(this.resolved.palette, this.packet[F.keyHue] ?? 0)
    if (this.postPatch) patchPostParams(this.resolved.post, this.postPatch)
    const flows = this.liveFlowStudies

    if (compatibility) {
      // One program and no compute: the fractal is the only study this path
      // draws, and the rest of the cast is skipped. It draws the fractal
      // whole rather than at its fade, since one ink alone at half presence
      // is a dim picture rather than a picture halfway to another.
      const fractal = inks.find((entry) => entry.impl === 'fractal')
      if (fractal)
        compatibility.render(this.packet, dt, this.knobsOf(fractal.id), this.resolved.post)
    } else if (gpu && context && post) {
      // Flows first and inks second, because a dye ink's numbers reach the
      // solver's uniform through the flow it draws. Two live flows of one
      // implementation are one solver at two sets of numbers, so it is
      // stepped once with their knobs blended by presence and their fades
      // summed: a crossfade between them never eases the stirring off, and
      // the field and the dye in it carry across untouched.
      for (const [impl, held] of this.flows) {
        let count = 0
        let total = 0
        for (const entry of flows) {
          if (entry.impl !== impl) continue
          const part = (this.flowParts[count] ??= { knobs: NO_KNOBS, presence: 0 })
          part.knobs = this.knobsOf(entry.id)
          part.presence = entry.live.presence
          total += part.presence
          count += 1
        }

        if (count === 0) continue
        total = Math.min(1, total)
        this.flowPresence.set(impl, total)
        const knobs =
          count === 1
            ? (this.flowParts[0]?.knobs ?? NO_KNOBS)
            : blendKnobs(this.flowParts, count, this.blendedKnobs(impl))
        held.object.update(this.packet, dt, knobs, total)
      }

      for (const entry of inks)
        this.inks
          .get(entry.id)
          ?.object.update(this.packet, dt, this.knobsOf(entry.id), entry.live.presence)
      const encoder = gpu.device.createCommandEncoder()
      const offscreen = post.target(this.drawWidth, this.drawHeight)
      if (!offscreen) return
      // The flows are stirred before the inks draw, so the picture is carried
      // along the field this frame solved rather than the last one's.
      this.liveFlows.length = 0
      for (const [impl, held] of this.flows) {
        held.object.simulate(encoder)
        // Read after simulating, because the field a flow names is whichever
        // half of a ping-pong pair this frame wrote.
        const field = held.object.flow
        if (field) this.liveFlows.push({ flow: field, presence: this.flowPresence.get(impl) ?? 1 })
      }

      // Held on the renderer, not just in this scope, because an ink reads it
      // through the implementation context while it encodes.
      const carried = this.blend.blend(encoder, this.liveFlows)
      this.carried = carried
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
      preset: this.pinned?.name ?? 'Auto',
    })
    // Timing on the element, so a screenshot or a test can read it.
    if (now - this.reported > 500) {
      this.reported = now
      canvas.dataset.frameMs = this.frameMs.toFixed(1)
      canvas.dataset.scene = sceneOf(inks.map((entry) => entry.id))
      canvas.dataset.detail = detail
      canvas.dataset.post = postSummary(this.resolved.post)
      canvas.dataset.preset = this.presetId
      canvas.dataset.cast = this.liveIds.join(' ')
    }
  }

  /**
   * The character handed to a host: once, when the reading has settled, and
   * rarely after that. A copy, because the reader writes one object in place
   * every frame and what a host does with this is keep it.
   */
  private reportCharacter(dt: number) {
    const report = this.onCharacter
    if (!report || this.director.settled < 1) return
    this.characterDue -= dt
    if (this.characterDue > 0) return
    this.characterDue = CHARACTER_SECONDS
    report({ ...this.director.character })
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

    for (const held of this.flows.values()) {
      const line = held.object.detail
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
    this.implContextCache = null
    this.carried = null
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
  /** A copy of the latest packet, for reading what the director is reading. */
  features: () => Float32Array
}

// A handle for driving the post stack by hand while measuring frame times,
// since nothing in the interface turns a stage off. It is behind Vite's DEV
// flag, so a production build has neither the handle nor this block.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as Window & { visimo?: VisualizerDevHandle }).visimo = {
    setPost: (patch) => renderer.setPost(patch),
    post: () => renderer.postParams,
    preset: () => renderer.presetId,
    features: () => renderer.features,
  }
}

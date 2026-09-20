import { describe, expect, it } from 'vitest'

import { DEFAULT_POST_PARAMS, postSummary } from '../post/params'
import { SCENE_IDS } from '../scenes/catalog'
import drift from './drift.json'
import { needsFlowSolver } from './flow'
import { DEFAULT_PRESET_ID, findPreset, firstPresetOf, PRESETS, stepPreset } from './index'
import { FLUID_KNOBS, SCENE_KNOBS } from './knobs'
import melt from './melt.json'
import { parsePreset } from './parse'
import prism from './prism.json'
import type { Preset } from './types'

const fluidParams = (): Record<string, number> =>
  Object.fromEntries(FLUID_KNOBS.map((knob) => [knob, 1]))

const good = () => ({
  id: 'test',
  name: 'Test',
  scene: 'fluid',
  sceneParams: fluidParams(),
  postParams: { bloom: { intensity: 0.5 } },
  audioMapping: [{ from: 'treble', to: 'vorticity', gain: 2 }],
})

describe('parsePreset', () => {
  it('accepts kaleidoscope knobs and rejects fluid knobs on that scene', () => {
    expect(parsePreset(prism, 'prism').scene).toBe('kaleidoscope')
    expect(() =>
      parsePreset({ ...prism, sceneParams: { ...prism.sceneParams, vorticity: 1 } }, 'bad'),
    ).toThrow(/vorticity/)

    expect(() =>
      parsePreset({ ...prism, audioMapping: [{ from: 'bass', to: 'dye', gain: 1 }] }, 'bad'),
    ).toThrow(/neither a knob/)
  })

  it('reads a whole preset', () => {
    const preset = parsePreset(good(), 'test.json')
    expect(preset.scene).toBe('fluid')
    if (preset.scene !== 'fluid') throw new Error('Expected fluid')
    expect(preset.sceneParams.vorticity).toBe(1)
    expect(preset.audioMapping).toEqual([
      { from: 'treble', to: 'vorticity', gain: 2, curve: 'linear' },
    ])
  })

  it('resolves the post patch over the stack defaults', () => {
    const preset = parsePreset(good(), 'test.json')
    expect(preset.postParams.bloom.intensity).toBe(0.5)
    expect(preset.postParams.bloom.threshold).toBe(DEFAULT_POST_PARAMS.bloom.threshold)
    expect(preset.postParams.feedback).toEqual(DEFAULT_POST_PARAMS.feedback)
    // The defaults are handed out fresh, not shared with the next preset.
    expect(preset.postParams.bloom.weights).not.toBe(DEFAULT_POST_PARAMS.bloom.weights)
  })

  it('reads the preset that carries the history along the flow', () => {
    const preset = parsePreset(drift, 'presets/drift.json')
    expect(preset.scene).toBe('fluid')
    expect(preset.postParams.feedback.carry).toBe(1)
    expect(preset.postParams.feedback.ceiling).toBeGreaterThan(0)
    // The floor is what holds the background black under a gain this long.
    expect(preset.postParams.feedback.floor).toBeGreaterThan(0)
    // The trail is the whole point of it, so the gain had better be long.
    const gain = preset.postParams.feedback.amount * preset.postParams.feedback.decay
    expect(gain).toBeGreaterThan(0.9)
    expect(gain).toBeLessThan(1)
  })

  it('takes a flow the package offers, and leaves the key off when none is asked for', () => {
    const preset = parsePreset({ ...good(), flow: 'fluid' }, 'test.json')
    expect(preset.flow).toBe('fluid')
    const plain = parsePreset(good(), 'test.json')
    expect(plain.flow).toBeUndefined()
    // JSON has no undefined, so a key that is never written round trips.
    expect('flow' in plain).toBe(false)
  })

  it('rejects a flow nothing solves', () => {
    expect(() => parsePreset({ ...good(), flow: 'wind' }, 'b.json')).toThrow(
      'b.json: flow is not a flow; they are fluid',
    )
    expect(() => parsePreset({ ...good(), flow: 7 }, 'b.json')).toThrow(/flow expected a name/)
  })

  it('takes the flow knobs a preset names and nothing else', () => {
    const preset = parsePreset(
      { ...good(), flow: 'fluid', flowParams: { vorticity: 20, force: 0.4 } },
      'test.json',
    )
    expect(preset.flowParams).toEqual({ vorticity: 20, force: 0.4 })
    expect(() =>
      parsePreset({ ...good(), flow: 'fluid', flowParams: { symmetry: 6 } }, 'b.json'),
    ).toThrow(/flowParams\.symmetry is not a knob of the fluid/)

    expect(() =>
      parsePreset({ ...good(), flow: 'fluid', flowParams: { vorticity: 'lots' } }, 'b.json'),
    ).toThrow(/flowParams\.vorticity expected a finite number/)
  })

  it('refuses flow knobs with no flow to tune', () => {
    expect(() => parsePreset({ ...good(), flowParams: { vorticity: 20 } }, 'b.json')).toThrow(
      'b.json: flowParams needs a flow; add "flow": "fluid"',
    )
  })

  it('reads the preset that draws one scene over another scene’s flow', () => {
    const preset = parsePreset(melt, 'presets/melt.json')
    expect(preset.scene).toBe('kaleidoscope')
    expect(preset.flow).toBe('fluid')
    expect(needsFlowSolver(preset.flow, preset.scene)).toBe(true)
    // The trail is what the flow smears, so it has to be a long one, and the
    // ceiling is what stops a gain this close to 1 running away to white.
    const gain = preset.postParams.feedback.amount * preset.postParams.feedback.decay
    expect(gain).toBeGreaterThan(0.9)
    expect(gain).toBeLessThan(1)
    expect(preset.postParams.feedback.carry).toBeGreaterThan(0)
    expect(preset.postParams.feedback.ceiling).toBeGreaterThan(0)
    expect(preset.postParams.feedback.floor).toBeGreaterThan(0)
  })

  it('names the path when a stage is given a field it does not have', () => {
    const broken = { ...good(), postParams: { feedback: { carrry: 1 } } }
    expect(() => parsePreset(broken, 'presets/broken.json')).toThrow(
      /presets\/broken\.json: postParams\.feedback\.carrry is not a field of feedback/,
    )
  })

  it('names the file and the path when a knob is missing', () => {
    const broken = good()
    delete broken.sceneParams.viscosity
    expect(() => parsePreset(broken, 'presets/broken.json')).toThrow(
      'presets/broken.json: sceneParams.viscosity is missing',
    )
  })

  it('rejects a knob that is not this scene’s', () => {
    const broken = { ...good(), sceneParams: { ...fluidParams(), flow: 3 } }
    expect(() => parsePreset(broken, 'b.json')).toThrow(/sceneParams\.flow is not a knob/)
  })

  it('rejects a mapping onto a knob no scene offers', () => {
    const broken = { ...good(), audioMapping: [{ from: 'treble', to: 'flow', gain: 1 }] }
    expect(() => parsePreset(broken, 'b.json')).toThrow(
      /audioMapping\[0\]\.to is neither a knob of this scene/,
    )
  })

  it('rejects a feature that does not exist', () => {
    const broken = { ...good(), audioMapping: [{ from: 'bassline', to: 'vorticity', gain: 1 }] }
    expect(() => parsePreset(broken, 'b.json')).toThrow(/audioMapping\[0\]\.from is not a feature/)
  })

  it('rejects a curve that does not exist', () => {
    const broken = {
      ...good(),
      audioMapping: [{ from: 'treble', to: 'vorticity', gain: 1, curve: 'cubed' }],
    }
    expect(() => parsePreset(broken, 'b.json')).toThrow(/audioMapping\[0\]\.curve is not a curve/)
  })

  it('rejects a gain that is not a finite number', () => {
    const broken = { ...good(), audioMapping: [{ from: 'treble', to: 'vorticity', gain: 'lots' }] }
    expect(() => parsePreset(broken, 'b.json')).toThrow(
      'b.json: audioMapping[0].gain expected a finite number, got "lots"',
    )
  })

  it('rejects a post field that is not part of its stage', () => {
    const broken = { ...good(), postParams: { bloom: { radius: 2 } } }
    expect(() => parsePreset(broken, 'b.json')).toThrow(
      /postParams\.bloom\.radius is not a field of bloom/,
    )
  })

  it('rejects a post stage that does not exist', () => {
    const broken = { ...good(), postParams: { vignette: { amount: 1 } } }
    expect(() => parsePreset(broken, 'b.json')).toThrow(/postParams\.vignette is not a post stage/)
  })

  it('takes the ribbon’s switch and its four numbers, and no others', () => {
    const preset = parsePreset(
      {
        ...good(),
        postParams: {
          ribbon: { enabled: true, intensity: 0.4, width: 5, height: 0.3, shape: 1 },
        },
      },
      'b.json',
    )

    expect(preset.postParams.ribbon).toEqual({
      enabled: true,
      intensity: 0.4,
      width: 5,
      height: 0.3,
      shape: 1,
    })

    // Left out, it is off and the numbers are the stack's own.
    expect(parsePreset(good(), 'b.json').postParams.ribbon).toEqual(DEFAULT_POST_PARAMS.ribbon)
    expect(() =>
      parsePreset({ ...good(), postParams: { ribbon: { colour: 1 } } }, 'b.json'),
    ).toThrow(/postParams\.ribbon\.colour is not a field of ribbon/)

    expect(() =>
      parsePreset({ ...good(), postParams: { ribbon: { width: 'wide' } } }, 'b.json'),
    ).toThrow(/postParams\.ribbon\.width expected a finite number/)

    expect(() =>
      parsePreset({ ...good(), postParams: { ribbon: { enabled: 1 } } }, 'b.json'),
    ).toThrow(/postParams\.ribbon\.enabled expected true or false/)
  })

  it('takes a mapping onto each of the ribbon’s numbers', () => {
    const to = ['ribbon.intensity', 'ribbon.width', 'ribbon.height', 'ribbon.shape']
    const preset = parsePreset(
      {
        ...good(),
        audioMapping: to.map((name) => ({ from: 'energy', to: name, gain: 0.5 })),
      },
      'b.json',
    )

    expect(preset.audioMapping.map((row) => row.to)).toEqual(to)
    expect(() =>
      parsePreset(
        { ...good(), audioMapping: [{ from: 'energy', to: 'ribbon.enabled', gain: 1 }] },
        'b.json',
      ),
    ).toThrow(/audioMapping\[0\]\.to is neither a knob/)
  })

  it('takes three bloom weights and nothing else', () => {
    const preset = parsePreset(
      { ...good(), postParams: { bloom: { weights: [0.6, 0.3, 0.1] } } },
      'b.json',
    )
    expect(preset.postParams.bloom.weights).toEqual([0.6, 0.3, 0.1])
    expect(() =>
      parsePreset({ ...good(), postParams: { bloom: { weights: [1, 2] } } }, 'b.json'),
    ).toThrow(/postParams\.bloom\.weights expected three numbers/)
  })

  it('takes a stage switch as a boolean only', () => {
    const off = parsePreset({ ...good(), postParams: { grain: { enabled: false } } }, 'b.json')
    expect(off.postParams.grain.enabled).toBe(false)
    expect(() =>
      parsePreset({ ...good(), postParams: { grain: { enabled: 'no' } } }, 'b.json'),
    ).toThrow(/postParams\.grain\.enabled expected true or false/)
  })

  it('rejects a scene that does not exist, and a preset that is not an object', () => {
    expect(() => parsePreset({ ...good(), scene: 'tunnel' }, 'b.json')).toThrow(
      /scene is not a scene/,
    )
    expect(() => parsePreset([1, 2], 'b.json')).toThrow('b.json: the preset expected an object')
    expect(() => parsePreset(null, 'b.json')).toThrow('b.json: the preset expected an object')
  })

  it('rejects a key that is not part of a preset', () => {
    expect(() => parsePreset({ ...good(), colour: 'blue' }, 'b.json')).toThrow(
      'b.json: colour is not part of a preset',
    )
  })
})

describe('the presets', () => {
  it('provide at least one parsed preset per scene', () => {
    for (const scene of SCENE_IDS)
      expect(PRESETS.filter((preset) => preset.scene === scene).length).toBeGreaterThan(0)
  })

  it('give every knob of their own scene a finite number', () => {
    for (const preset of PRESETS) {
      const knobs: readonly string[] = SCENE_KNOBS[preset.scene]
      const params: Record<string, number> = preset.sceneParams
      expect(Object.keys(params).sort()).toEqual([...knobs].sort())
      for (const value of Object.values(params)) expect(Number.isFinite(value)).toBe(true)
    }
  })

  it('have unique ids and names', () => {
    expect(new Set(PRESETS.map((preset) => preset.id)).size).toBe(PRESETS.length)
    expect(new Set(PRESETS.map((preset) => preset.name)).size).toBe(PRESETS.length)
  })

  it('has a default that exists and draws the fluid', () => {
    const preset = findPreset(DEFAULT_PRESET_ID) as Preset
    expect(preset).toBeDefined()
    expect(preset.scene).toBe('fluid')
  })

  it('steps both ways and wraps', () => {
    const first = PRESETS[0] as Preset
    const last = PRESETS[PRESETS.length - 1] as Preset
    expect(stepPreset(first.id, 1).id).toBe(PRESETS[1]?.id)
    expect(stepPreset(first.id, -1).id).toBe(last.id)
    expect(stepPreset(last.id, 1).id).toBe(first.id)
    // An id nobody recognises starts the walk from the top rather than off it.
    expect(stepPreset('gone', 1).id).toBe(PRESETS[1]?.id)
  })

  it('offers a first preset for every scene', () => {
    for (const scene of SCENE_IDS) expect(firstPresetOf(scene).scene).toBe(scene)
  })

  // `data-post` on the canvas is the summary, and a consumer's tests assert it.
  // The ribbon is off in every preset that has not asked for it, so these three
  // print what they printed before it existed.
  it('print the stages they always did unless they turn the ribbon on', () => {
    const prints = (id: string) => postSummary((findPreset(id) as Preset).postParams)
    expect(prints('plume')).toBe('feedback bloom chroma tonemap grain')
    expect(prints('wash')).toBe('feedback bloom chroma tonemap grain')
    expect(prints('prism')).toBe('bloom tonemap')
    for (const id of ['plume', 'wash', 'prism'])
      expect((findPreset(id) as Preset).postParams.ribbon.enabled).toBe(false)
  })

  it('turn the ribbon on in Drift and Melt, modestly, driven by a fast feature', () => {
    for (const id of ['drift', 'melt']) {
      const preset = findPreset(id) as Preset
      const ribbon = preset.postParams.ribbon
      expect(ribbon.enabled).toBe(true)
      expect(ribbon.intensity).toBeGreaterThan(0)
      expect(ribbon.intensity).toBeLessThanOrEqual(0.5)
      // A ribbon that sits at one brightness is static; the plan forbids that.
      const rows = preset.audioMapping.filter((row) => row.to === 'ribbon.intensity')
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) expect(['energy', 'beatPulse', 'lowEnd']).toContain(row.from)
    }

    expect(postSummary((findPreset('drift') as Preset).postParams)).toBe(
      'ribbon feedback bloom chroma tonemap grain',
    )

    expect(postSummary((findPreset('melt') as Preset).postParams)).toBe(
      'ribbon feedback bloom tonemap',
    )
  })
})

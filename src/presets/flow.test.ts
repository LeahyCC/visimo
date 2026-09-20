import { describe, expect, it } from 'vitest'

import { SCENE_IDS } from '../scenes/catalog'
import { FLOW_IDS, isFlowId, needsFlowSolver } from './flow'
import { PRESETS } from './index'

describe('needsFlowSolver', () => {
  it('runs a solver for a preset whose scene solves no field', () => {
    expect(needsFlowSolver('fluid', 'kaleidoscope')).toBe(true)
  })

  it('leaves the fluid scene to solve its own field', () => {
    expect(needsFlowSolver('fluid', 'fluid')).toBe(false)
  })

  it('runs nothing for a preset that asks for no flow', () => {
    for (const scene of SCENE_IDS) expect(needsFlowSolver(undefined, scene)).toBe(false)
  })
})

describe('the flow vocabulary', () => {
  it('knows its own names and no others', () => {
    for (const flow of FLOW_IDS) expect(isFlowId(flow)).toBe(true)
    expect(isFlowId('wind')).toBe(false)
  })

  it('has every preset naming a flow that exists', () => {
    for (const preset of PRESETS)
      if (preset.flow !== undefined) expect(isFlowId(preset.flow)).toBe(true)
  })
})

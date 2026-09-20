/**
 * The one decision in the flow blend that is not a GPU call: what grid two
 * live flows are summed into. It matters now that the flows no longer all
 * solve on one grid, since the analytic field is 128 texels and the fluid is
 * 512 or 1024.
 */
import { describe, expect, it } from 'vitest'

import type { Flow } from '../scenes/Scene'
import { blendTarget } from './FlowBlend'
import type { LiveFlow } from './FlowBlend'

// The view is never read here; only the size and the cover are.
const view = {} as GPUTextureView

const at = (size: number, presence: number, cover: Flow['cover'] = [1, 0.5625]): LiveFlow => ({
  flow: { view, cover, size },
  presence,
})

describe('the blended field', () => {
  it('is nothing when no flow is live', () => {
    expect(blendTarget([])).toBeNull()
  })

  // The blend shader samples by uv, so a 128 field lands correctly in a 1024
  // target. The other way round throws away detail the fluid cannot get back,
  // and the whole change would run at a sixty-fourth of its resolution.
  it('takes the largest grid, whichever order the flows arrive in', () => {
    expect(blendTarget([at(128, 0.7), at(1024, 0.3)])?.size).toBe(1024)
    expect(blendTarget([at(1024, 0.3), at(128, 0.7)])?.size).toBe(1024)
  })

  it('leaves one grid alone when both flows share it', () => {
    expect(blendTarget([at(512, 0.5), at(512, 0.5)])?.size).toBe(512)
  })

  // Every flow is handed the same canvas, so every cover is the same; the
  // first's is taken and the test says out loud what is being relied on.
  it('carries the cover the flows share', () => {
    const cover: Flow['cover'] = [1, 0.5625]
    expect(blendTarget([at(128, 0.5, cover), at(512, 0.5, cover)])?.cover).toEqual(cover)
  })

  it('offers nothing to blend into when a flow has no grid at all', () => {
    expect(blendTarget([at(0, 1)])).toBeNull()
  })
})

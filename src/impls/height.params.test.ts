/**
 * height-kit's CPU half: the ring's scrolling, the rows the music writes, and
 * the projection the shader's twin is measured by. None of it needs a GPU.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import {
  bandLevelAt,
  groundPoint,
  HEIGHT_BANDS,
  HEIGHT_CAMERA,
  HEIGHT_COLUMNS,
  HEIGHT_DEPTH,
  HEIGHT_HALF_WIDTH,
  HEIGHT_MAX_RELIEF,
  HEIGHT_ROW_SPACING,
  HEIGHT_ROWS,
  HEIGHT_TAPER,
  HEIGHT_VIEW_FLOATS,
  heightAt,
  heightFog,
  heightLevel,
  heightProfile,
  HeightRing,
  heightSlope,
  pixelToNdc,
  projectPoint,
  writeHeightView,
} from './height.params'

/** A packet with every band at `level` and no pulse. */
const bands = (level: number) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const band of HEIGHT_BANDS) out[band] = level
  return out
}

const PROFILE = { valley: 0.5, relief: 1 }

/**
 * One row of travel, a hair over so a float sum that lands a rounding error
 * under a row line still crosses it. Adding a row's spacing to itself is not
 * exact, and a test that is one row out on which side it fell is not a test.
 */
const ROW = HEIGHT_ROW_SPACING * (1 + 1e-9)

/** A ring the music has been playing into for a while: `seconds` at `speed`, at `fps`. */
function flown(seconds: number, speed: number, fps: number, features = bands(0.6)) {
  const ring = new HeightRing()
  const dt = 1 / fps
  for (let step = 0; step < Math.round(seconds * fps); step += 1)
    ring.advance(speed * dt, dt, features)
  return ring
}

describe('the ring scrolls', () => {
  it('starts flat and writes nothing until the camera has crossed a row line', () => {
    const ring = new HeightRing()
    expect(ring.data.every((value) => value === 0)).toBe(true)
    // Just under one row of travel: no row line has been crossed.
    expect(ring.advance(HEIGHT_ROW_SPACING * 0.9, 0.1, bands(1))).toBe(0)
    expect(ring.data.every((value) => value === 0)).toBe(true)
    // The rest of it crosses one.
    expect(ring.advance(HEIGHT_ROW_SPACING * 0.2, 0.1, bands(1))).toBe(1)
  })

  it('writes one row per row of travel, however the travel is cut into frames', () => {
    const totals = [30, 60, 144].map((fps) => {
      const ring = new HeightRing()
      let rows = 0
      // 12.1 units at 8 a second is a bit over 1.5 s: not on a row line, so
      // the count cannot depend on which side of one float error lands.
      for (let step = 0; step < Math.round(1.5125 * fps); step += 1)
        rows += ring.advance((8 * 1.5125) / Math.round(1.5125 * fps), 1 / fps, bands(0.5))
      return { rows, travel: ring.distance }
    })

    for (const total of totals) {
      expect(total.rows).toBe(Math.floor(total.travel / HEIGHT_ROW_SPACING))
      expect(total.travel).toBeCloseTo(12.1, 9)
    }

    expect(new Set(totals.map((total) => total.rows)).size).toBe(1)
  })

  it('carries the fractional travel to the shader, so the ground moves between rows', () => {
    const ring = new HeightRing()
    ring.advance(HEIGHT_ROW_SPACING * 3.25, 0.1, bands(0.5))
    expect(ring.wrappedTravel).toBeCloseTo(HEIGHT_ROW_SPACING * 3.25, 9)
    // Wrapped to a period of its own, which is what a grid's lines are scrolled by.
    expect(ring.wrapTravel(1)).toBeCloseTo((HEIGHT_ROW_SPACING * 3.25) % 1, 9)
  })

  it('shows the same level at the row a step nearer after one step of travel', () => {
    const ring = new HeightRing()
    const features = bands(0)
    for (let row = 0; row < 30; row += 1) {
      for (const band of HEIGHT_BANDS) features[band] = 0.1 + ((row * 7) % 10) / 12
      ring.advance(ROW, 10, features)
    }

    const places = [0.6, 1.4, 2.2, 3.8, 6, 9]
    const before = places.map((dz) => heightLevel(ring, 0, dz + HEIGHT_ROW_SPACING))
    for (const band of HEIGHT_BANDS) features[band] = 0.5
    ring.advance(ROW, 10, features)
    const after = places.map((dz) => heightLevel(ring, 0, dz))
    // Each row is where the one a step further out was, before the camera moved.
    for (const [index, value] of before.entries())
      expect(after[index], `at ${places[index]}`).toBeCloseTo(value, 6)
  })

  it('writes every row the same either side of the centre line, to the last bit', () => {
    const ring = new HeightRing()
    const features = bands(0)
    for (const [index, band] of HEIGHT_BANDS.entries()) features[band] = 0.15 + index * 0.17
    for (let row = 0; row < 20; row += 1) ring.advance(ROW, 10, features)
    for (let slot = 0; slot < HEIGHT_ROWS; slot += 1)
      for (let column = 0; column < HEIGHT_COLUMNS; column += 1)
        expect(ring.data[slot * HEIGHT_COLUMNS + column]).toBe(
          ring.data[slot * HEIGHT_COLUMNS + (HEIGHT_COLUMNS - 1 - column)],
        )
  })

  it('smooths a row toward the one before by seconds and not by rows', () => {
    // A step from silence to full: one row a frame at 60 frames a second takes
    // the time constant to get most of the way, one row in a long frame takes it whole.
    const quick = new HeightRing()
    quick.advance(ROW, 1 / 60, bands(1))
    const slow = new HeightRing()
    slow.advance(ROW, 1, bands(1))
    // The first row born goes in slot 0; column 3 is out toward the treble, where every band is 1.
    const at = (ring: HeightRing) => ring.data[3] ?? 0
    expect(at(quick)).toBeGreaterThan(0.1)
    expect(at(quick)).toBeLessThan(0.5)
    expect(at(slow)).toBeGreaterThan(0.95)
  })

  it('writes at most the whole ring for a jump longer than the field, and never for no travel', () => {
    const ring = new HeightRing()
    expect(ring.advance(HEIGHT_DEPTH * 10, 0.1, bands(0.5))).toBe(HEIGHT_ROWS)
    for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY])
      expect(new HeightRing().advance(bad, 0.1, bands(1)), `distance ${bad}`).toBe(0)
  })

  it('keeps the wrapped travel inside one lap however far it has flown', () => {
    const ring = new HeightRing()
    // A million units in steps a tenth of a second at a speed of 40 wraps many
    // thousands of laps; the float handed to the shader stays small and exact.
    for (let step = 0; step < 250_000; step += 1) ring.advance(4, 0.1, bands(0))
    expect(ring.wrappedTravel).toBeGreaterThanOrEqual(0)
    expect(ring.wrappedTravel).toBeLessThan(HEIGHT_DEPTH)
    expect(Math.fround(ring.wrappedTravel)).toBeCloseTo(ring.wrappedTravel, 5)
  })

  it('writes no NaN into the ring whatever the packet holds', () => {
    const ring = new HeightRing()
    const features = new Float32Array(PACKET_LENGTH).fill(Number.NaN)
    ring.advance(HEIGHT_DEPTH, 0.1, features)
    expect(ring.data.every((value) => Number.isFinite(value))).toBe(true)
  })

  it('lets a fall in the music reach exactly nothing, so silence is a flat field', () => {
    const ring = flown(2, 8, 60, bands(0.8))
    expect(Math.max(...ring.data)).toBeGreaterThan(0.5)
    for (let step = 0; step < 600; step += 1) ring.advance(8 / 60, 1 / 60, bands(0))
    expect(Math.max(...ring.data)).toBe(0)
  })
})

describe('what the ring hands the GPU', () => {
  it('flushes only the rows written since the last flush, and nothing when none were', () => {
    const ring = new HeightRing()
    const runs: [number, number][] = []
    const take = (first: number, count: number) => runs.push([first, count])
    ring.markAllPending()
    ring.flush(take)
    expect(runs).toEqual([[0, HEIGHT_ROWS]])
    runs.length = 0
    ring.flush(take)
    expect(runs).toEqual([])
    ring.advance(ROW * 3, 0.1, bands(0.5))
    ring.flush(take)
    // The first three rows born land in slots 0, 1 and 2.
    expect(runs).toEqual([[0, 3]])
  })

  it('splits a run that wraps round the end of the ring in two', () => {
    const ring = new HeightRing()
    ring.markAllPending()
    ring.flush(() => {})
    ring.advance(ROW * (HEIGHT_ROWS - 2), 0.1, bands(0.5))
    ring.flush(() => {})
    // The last two slots are next, then 0 and 1: four rows over the seam.
    ring.advance(ROW * 4, 0.1, bands(0.5))
    const runs: [number, number][] = []
    ring.flush((first, count) => runs.push([first, count]))
    expect(runs).toEqual([
      [HEIGHT_ROWS - 2, 2],
      [0, 2],
    ])
  })

  it('hands out the whole ring once after a long time unflushed, and not more than it holds', () => {
    const ring = new HeightRing()
    ring.markAllPending()
    ring.flush(() => {})
    for (let step = 0; step < 20; step += 1) ring.advance(HEIGHT_DEPTH * 0.7, 0.1, bands(0.4))
    let rows = 0
    ring.flush((_first, count) => (rows += count))
    expect(rows).toBe(HEIGHT_ROWS)
  })
})

describe('the row the music writes', () => {
  it('puts the sub on the centre line and the treble at the outer edge', () => {
    const features = bands(0)
    features[F.sub] = 0.9
    features[F.treble] = 0.3
    expect(bandLevelAt(features, 0)).toBeCloseTo(0.9, 6)
    expect(bandLevelAt(features, 1)).toBeCloseTo(0.3, 6)
    features[F.sub] = 0
    features[F.treble] = 0
    features[F.lowMid] = 0.7
    expect(bandLevelAt(features, 0.5)).toBeCloseTo(0.7, 6)
  })

  it('has no crease at a band, so the mirror has no seam', () => {
    const features = bands(0)
    features[F.bass] = 1
    const e = 1e-4
    for (const stop of [0, 0.25, 0.5, 0.75, 1]) {
      const slope =
        (bandLevelAt(features, Math.min(stop + e, 1)) -
          bandLevelAt(features, Math.max(stop - e, 0))) /
        (2 * e)
      // At a stop the smoothstep is flat: the level goes through it level.
      expect(Math.abs(slope), `at ${stop}`).toBeLessThan(0.01)
    }
  })

  it('lets a pulse lengthen a band that is sounding and never draw one from nothing', () => {
    const features = bands(0)
    features[F.bassPulse] = 1
    expect(bandLevelAt(features, 0.25)).toBe(0)
    features[F.bass] = 0.4
    expect(bandLevelAt(features, 0.25)).toBeGreaterThan(0.4)
    expect(bandLevelAt(features, 0.25)).toBeLessThanOrEqual(1)
  })
})

describe('the terrain', () => {
  it('is a valley in the middle and hills at the sides, and never rises to the camera', () => {
    for (const level of [0, 0.5, 1]) {
      const middle = heightProfile(level, 0, PROFILE)
      const side = heightProfile(level, HEIGHT_HALF_WIDTH, PROFILE)
      expect(side, `level ${level}`).toBeGreaterThan(middle)
      expect(side).toBeLessThanOrEqual(HEIGHT_MAX_RELIEF * HEIGHT_CAMERA.height)
    }

    // Under 1 is what the shader's march depends on, so it is pinned.
    expect(HEIGHT_MAX_RELIEF).toBeLessThan(1)
  })

  it('is mirrored about the centre line', () => {
    for (const x of [0.5, 2, 5, 7.5])
      expect(heightProfile(0.6, x, PROFILE)).toBe(heightProfile(0.6, -x, PROFILE))
  })

  it('has the hills stand at their base with the music quiet and at the whole range with it full', () => {
    const quiet = heightProfile(0, HEIGHT_HALF_WIDTH, PROFILE)
    const full = heightProfile(1, HEIGHT_HALF_WIDTH, PROFILE)
    expect(quiet).toBeGreaterThan(0)
    expect(full).toBeCloseTo(HEIGHT_MAX_RELIEF, 9)
    expect(quiet).toBeLessThan(full * 0.5)
  })

  it('narrows the valley live, for the whole field at once', () => {
    const ring = flown(3, 8, 60, bands(0.7))
    const wide = { valley: 0.8, relief: 1 }
    const narrow = { valley: 0.2, relief: 1 }
    // Both read from one ring: only the profile changed, so nothing has to be born again.
    const x = HEIGHT_HALF_WIDTH * 0.5
    expect(heightAt(ring, narrow, x, 4)).toBeGreaterThan(heightAt(ring, wide, x, 4))
  })

  it('reads the ring bilinearly across the columns and along the rows, and is smooth', () => {
    const ring = flown(4, 8, 60, bands(0.7))
    let biggestStep = 0
    let previous = heightLevel(ring, -HEIGHT_HALF_WIDTH, 3)
    for (let step = 1; step <= 400; step += 1) {
      const next = heightLevel(ring, -HEIGHT_HALF_WIDTH + (step / 400) * 2 * HEIGHT_HALF_WIDTH, 3)
      biggestStep = Math.max(biggestStep, Math.abs(next - previous))
      previous = next
    }

    expect(biggestStep).toBeLessThan(0.05)
  })

  it('fades the music to nothing over the far end, so a row is born flat', () => {
    const ring = flown(4, 8, 60, bands(0.9))
    expect(heightLevel(ring, 0, HEIGHT_DEPTH * HEIGHT_TAPER * 0.9)).toBeGreaterThan(0)
    expect(heightLevel(ring, 0, HEIGHT_DEPTH)).toBe(0)
    expect(heightLevel(ring, 0, HEIGHT_DEPTH * 1.5)).toBe(0)
  })

  it('has a slope that points along the way the ground rises', () => {
    const ring = flown(3, 8, 60, bands(0.7))
    const slope = heightSlope(ring, PROFILE, HEIGHT_HALF_WIDTH * 0.7, 5)
    // On the right hill the ground rises going outward.
    expect(slope.across).toBeGreaterThan(0)
    const mirrored = heightSlope(ring, PROFILE, -HEIGHT_HALF_WIDTH * 0.7, 5)
    expect(mirrored.across).toBeCloseTo(-slope.across, 9)
  })
})

describe('the projection, run both ways', () => {
  const camera = HEIGHT_CAMERA

  it('puts a point at eye level on the horizon at any distance', () => {
    for (const z of [1, 5, 40, 1e6]) {
      const at = projectPoint(camera, 3, camera.height, z)
      expect(at?.y).toBeCloseTo(camera.horizon, 12)
    }
  })

  it('puts the ground lower on screen the nearer it is, and on the horizon at infinity', () => {
    const ys = [0.9, 2, 5, 20, 100, 1e7].map((z) => projectPoint(camera, 0, 0, z)?.y ?? 0)
    for (let index = 1; index < ys.length; index += 1)
      expect(ys[index] ?? 0).toBeGreaterThan(ys[index - 1] ?? 0)
    expect(ys.at(-1)).toBeCloseTo(camera.horizon, 5)
    expect(ys[0]).toBeLessThan(camera.horizon)
  })

  it('makes a hill stand higher on screen than the ground at its foot', () => {
    const foot = projectPoint(camera, 2, 0, 6)
    const top = projectPoint(camera, 2, 0.6, 6)
    expect(top?.y).toBeGreaterThan(foot?.y ?? 0)
    // Straight up: the same place across.
    expect(top?.x).toBeCloseTo(foot?.x ?? 0, 12)
  })

  it('finds nothing behind the camera and no ground at or above the horizon', () => {
    expect(projectPoint(camera, 0, 0, 0)).toBeNull()
    expect(projectPoint(camera, 0, 0, -3)).toBeNull()
    expect(groundPoint(camera, { x: 0, y: camera.horizon })).toBeNull()
    expect(groundPoint(camera, { x: 0, y: camera.horizon + 0.3 })).toBeNull()
  })

  it('is its own inverse for ground and for raised ground', () => {
    for (const [x, y, z] of [
      [0, 0, 1],
      [-2.5, 0, 7],
      [4, 0.4, 12],
      [1, 0.8, 3],
    ] as const) {
      const shown = projectPoint(camera, x, y, z)
      expect(shown).not.toBeNull()
      if (!shown) continue
      const back = groundPoint(camera, shown, y)
      expect(back?.x).toBeCloseTo(x, 9)
      expect(back?.z).toBeCloseTo(z, 9)
    }
  })

  it('reads the middle of the screen as straight ahead and is symmetric either side', () => {
    const left = groundPoint(camera, pixelToNdc(300, 800, 1920, 1080))
    const right = groundPoint(camera, pixelToNdc(1920 - 300, 800, 1920, 1080))
    expect(left?.z).toBeCloseTo(right?.z ?? 0, 9)
    expect(left?.x).toBeCloseTo(-(right?.x ?? 0), 9)
    expect(groundPoint(camera, pixelToNdc(960, 800, 1920, 1080))?.x).toBeCloseTo(0, 12)
  })

  it('turns a pixel into half-heights from the middle with y up', () => {
    expect(pixelToNdc(960, 540, 1920, 1080)).toEqual({ x: 0, y: 0 })
    expect(pixelToNdc(1920, 0, 1920, 1080)).toEqual({ x: 960 / 540, y: 1 })
  })
})

describe('the fog', () => {
  it('is all of a line at the camera and exactly none at its reach and past it', () => {
    expect(heightFog(0, 46)).toBe(1)
    expect(heightFog(46, 46)).toBe(0)
    expect(heightFog(1000, 46)).toBe(0)
  })

  it('only ever falls with distance', () => {
    let previous = 1
    for (let distance = 0; distance <= 46; distance += 0.5) {
      const fog = heightFog(distance, 46)
      expect(fog).toBeLessThanOrEqual(previous)
      previous = fog
    }
  })
})

describe('the view uniform', () => {
  it('lays its sixteen floats out as the shader reads them', () => {
    const ring = new HeightRing()
    ring.advance(HEIGHT_ROW_SPACING * 2.5, 0.1, bands(0.5))
    const out = writeHeightView(
      new Float32Array(HEIGHT_VIEW_FLOATS),
      ring,
      HEIGHT_CAMERA,
      { valley: 0.4, relief: 0.7 },
      1920,
      1080,
    )

    expect([...out.slice(0, 4)]).toEqual([1920, 1080, Math.fround(0.22), Math.fround(1.15)])
    expect(out[4]).toBe(1)
    expect(out[5]).toBeCloseTo(HEIGHT_ROW_SPACING * 2.5, 6)
    expect(out[6]).toBeCloseTo(HEIGHT_ROW_SPACING, 6)
    expect(out[7]).toBe(HEIGHT_ROWS)
    expect(out[8]).toBe(HEIGHT_HALF_WIDTH)
    expect(out[9]).toBe(HEIGHT_COLUMNS)
    expect(out[10]).toBeCloseTo(HEIGHT_MAX_RELIEF, 6)
    expect(out[11]).toBeCloseTo(HEIGHT_TAPER, 6)
    expect(out[12]).toBeCloseTo(0.4, 6)
    expect(out[13]).toBeCloseTo(0.7, 6)
  })

  it('holds the valley under 1 and the relief inside 0 to 1, whatever a study resolves', () => {
    const out = writeHeightView(
      new Float32Array(HEIGHT_VIEW_FLOATS),
      new HeightRing(),
      HEIGHT_CAMERA,
      { valley: 4, relief: -2 },
      100,
      100,
    )

    expect(out[12]).toBeLessThan(1)
    expect(out[13]).toBe(0)
  })
})

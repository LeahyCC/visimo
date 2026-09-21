/**
 * The shaders' source read against what the TypeScript says about them. Nothing
 * here compiles WGSL, and nothing in the suite does yet: the failures that only
 * a real adapter reports (a reserved word used as a name, an assignment to a
 * `let`, a derivative read after an early exit) are the ones checked for by
 * reading the text, so a mistake of those kinds fails here and not on Colin's
 * machine. `height.common.wgsl` is prepended to `grid.wgsl` the way the ink
 * builds it, so both are read as the one module the device is given.
 */
import { describe, expect, it } from 'vitest'

import grid from '../shaders/grid.wgsl?raw'
import common from '../shaders/height.common.wgsl?raw'
import { GRID_UNIFORM_FLOATS } from './grid.params'
import { HEIGHT_VIEW_FLOATS } from './height.params'
import { HEIGHT_BINDINGS } from './HeightField'

/**
 * The words WGSL holds back for itself as names, and the keywords a shader
 * here does not use as one. A name on this list is a compile error on the
 * adapter and passes everywhere else.
 */
const RESERVED = new Set(
  `NULL Self abstract active alignas alignof as asm asm_fragment async attribute auto await become
  binding_array cast catch class co_await co_return co_yield coherent column_major common compile
  compile_fragment concept const_cast consteval constexpr constinit crate debugger decltype delete
  demote demote_to_helper do dynamic_cast enum explicit export extends extern external fallthrough
  filter final finally friend from fxgroup get goto groupshared highp impl implements import inline
  instanceof interface layout lowp macro macro_rules match mediump meta mod module move mut mutable
  namespace new nil noexcept noinline nointerpolation noperspective null nullptr of operator package
  packoffset partition pass patch pixelfragment precise precision premerge priv protected pub public
  readonly ref regardless register reinterpret_cast require resource restrict self set shared
  sizeof smooth snorm static static_assert static_cast std subroutine super target template this
  thread_local throw trait try type typedef typeid typename typeof union unless unorm unsafe unsized
  use using varying virtual volatile wgsl where with writeonly yield sample`.split(/\s+/),
)

/**
 * A shader's text without its comments, which are prose and full of reserved
 * words, and with plain line endings, since a checkout on Windows may not have them.
 */
const code = (source: string) => source.replace(/\r\n/g, '\n').replace(/\/\/.*$/gm, '')

const modules = { 'height.common.wgsl': common, 'grid.wgsl': grid } as const

describe('the shaders read as one module', () => {
  for (const [name, source] of Object.entries(modules)) {
    it(`${name}: uses no reserved word as a name`, () => {
      const names = new Set(code(source).match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [])
      const used = [...names].filter((word) => RESERVED.has(word))
      expect(used).toEqual([])
    })

    it(`${name}: never assigns to a let`, () => {
      const text = code(source)
      const lets = new Set([...text.matchAll(/\blet\s+([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]))
      const vars = new Set(
        [...text.matchAll(/\bvar(?:<[^>]*>)?\s+([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]),
      )
      // A name that is a var somewhere is assigned there, and that is fine; a
      // name that is only ever a let has no business on the left of an `=`.
      const assigned = [...text.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*[-+*/]?=(?!=)/gm)].map(
        (m) => m[1],
      )
      expect(assigned.filter((word) => lets.has(word) && !vars.has(word))).toEqual([])
    })
  }

  it('declares the kit at bindings 0 and 1 and the grid at 2, once each', () => {
    const declared = [...code(common + grid).matchAll(/@group\((\d+)\)\s*@binding\((\d+)\)/g)].map(
      (m) => `${m[1]}:${m[2]}`,
    )
    expect(declared).toEqual(['0:0', '0:1', '0:2'])
    expect(HEIGHT_BINDINGS).toEqual({ view: 0, rows: 1 })
    expect(code(common)).toMatch(/@binding\(0\)\s+var<uniform>\s+height_view/)
    expect(code(common)).toMatch(/@binding\(1\)\s+var<storage,\s*read>\s+field_rows/)
  })

  it('has as many vec4s in each uniform struct as the TypeScript writes floats', () => {
    const vec4s = (struct: string, source: string) => {
      const body = code(source).match(new RegExp(`struct\\s+${struct}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
      return (body.match(/vec4<f32>/g) ?? []).length
    }

    expect(vec4s('HeightView', common) * 4).toBe(HEIGHT_VIEW_FLOATS)
    expect(vec4s('Look', grid) * 4).toBe(GRID_UNIFORM_FLOATS)
  })

  it('walks the ground with no early exit, so the derivative after it is in uniform control flow', () => {
    // WGSL refuses `fwidth` anywhere a pixel of a quad could have left before
    // the rest. The march's loops have fixed counts and no exit, and nothing
    // between the start of the fragment and the derivative may return.
    const march = code(common).match(/fn height_march[\s\S]*?\n\}\n/)?.[0] ?? ''
    expect(march.length).toBeGreaterThan(200)
    expect(march).not.toMatch(/\b(break|continue|discard)\b/)
    expect(march.match(/\breturn\b/g)).toHaveLength(1)
    const fragment = code(grid).match(/fn fs\(([\s\S]*)$/)?.[1] ?? ''
    const before = fragment.slice(0, fragment.indexOf('fwidth('))
    expect(fragment).toContain('fwidth(')
    expect(before).not.toMatch(/\b(return|break|continue|discard)\b/)
  })

  it('draws the lines with derivatives and not a texture, so nothing can shimmer at any size', () => {
    expect(code(grid)).toContain('fwidth(')
    expect(code(grid)).not.toMatch(/texture/)
    // Every line is lost to the fog at exactly its reach.
    expect(code(common)).toMatch(/fn height_fog/)
  })

  it('has the entry points the pipeline names', () => {
    expect(code(grid)).toMatch(/@vertex\s+fn vs\(/)
    expect(code(grid)).toMatch(/@fragment\s+fn fs\(/)
  })
})

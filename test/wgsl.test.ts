import { describe, expect, it } from 'vitest'

import { checkWgsl, type WgslVerdict } from './wgsl'

// Vite's own `?raw`, so each string is the file the app's bundler would hand
// over, byte for byte.
const shaderFiles = import.meta.glob<string>('../src/shaders/*.wgsl', {
  query: '?raw',
  import: 'default',
  eager: true,
})

// The app's code, to see how each shader is turned into a module. Tests are
// left out: they import shaders to read them, not to build a module.
const appFiles = import.meta.glob<string>(['../src/**/*.ts', '!../src/**/*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

const shaders = new Map(
  Object.entries(shaderFiles).map(([path, text]) => [path.slice(path.lastIndexOf('/') + 1), text]),
)

/**
 * The shaders the app builds by putting one file in front of another before
 * `createShaderModule` sees them, in the order it does. Each one is only ever a
 * module in that assembled form, so it is only checked that way: a common
 * prefix on its own is not something the app creates.
 *
 * `owner` is the file that does the joining. `appImports` below reads it, so
 * this list cannot fall out of step with the code without a test failing.
 */
const ASSEMBLIES: { owner: string; prefix: string; parts: string[] }[] = [
  {
    owner: 'src/post/PostStack.ts',
    prefix: 'post.common.wgsl',
    parts: [
      'post.bright.wgsl',
      'post.composite.wgsl',
      'post.down.wgsl',
      'post.feedback.wgsl',
      'post.reduce.wgsl',
      'post.ribbon.wgsl',
      'post.up.wgsl',
    ],
  },
  {
    owner: 'src/scenes/Fluid.ts',
    prefix: 'fluid.common.wgsl',
    parts: ['fluid.render.wgsl', 'fluid.sim.wgsl'],
  },
]

type Import = { ident: string; file: string }

/** Every `import x from '.../shaders/y.wgsl?raw'` in a file. */
function shaderImports(text: string): Import[] {
  const pattern = /import\s+(\w+)\s+from\s+'[^']*\/shaders\/([\w.-]+\.wgsl)\?raw'/g

  return [...text.matchAll(pattern)].flatMap(([, ident, file]) =>
    ident && file ? [{ ident, file }] : [],
  )
}

/** App file (as `src/...`) to the shaders it imports. */
const appImports = new Map(
  Object.entries(appFiles).flatMap(([path, text]) => {
    const found = shaderImports(text)

    return found.length > 0 ? [[path.replace('../', ''), found] as const] : []
  }),
)

const assembled = new Set(ASSEMBLIES.flatMap(({ prefix, parts }) => [prefix, ...parts]))
const direct = [...shaders.keys()].filter((file) => !assembled.has(file))

/** What a failure says: the file and line first, then naga's own report. */
function explain(verdict: WgslVerdict, file: string, prefix?: { file: string; text: string }) {
  if (verdict.ok) return ''
  let where = `src/shaders/${file}`
  let line = verdict.line
  if (prefix && line !== null) {
    // The text naga saw is the prefix and then the part, so a line past the
    // prefix belongs to the part, counted from its own first line.
    const prefixLines = prefix.text.split('\n').length - 1
    if (line > prefixLines) line -= prefixLines
    else where = `src/shaders/${prefix.file}`
  }
  const at = line === null ? '' : `:${line}${verdict.column === null ? '' : `:${verdict.column}`}`

  return `${where}${at} ${verdict.message}\n${verdict.report}`
}

describe('shader coverage', () => {
  it('finds the shaders', () => {
    // A glob that matched nothing would let every test below pass empty.
    expect(shaders.size).toBeGreaterThan(0)
  })

  it('has every shader imported with ?raw by the app, so its text is known', () => {
    const imported = new Set([...appImports.values()].flatMap((found) => found.map((i) => i.file)))
    const missing = [...shaders.keys()].filter((file) => !imported.has(file))
    // A shader the app reads some other way would reach the GPU as text this
    // check never saw.
    expect(
      missing,
      `not imported with ?raw by any file under src/ (delete it, or import it the usual way): ${missing.join(', ')}`,
    ).toEqual([])
  })

  it('declares only shaders that exist', () => {
    const missing = [...assembled].filter((file) => !shaders.has(file))
    expect(missing, `in ASSEMBLIES but not in src/shaders: ${missing.join(', ')}`).toEqual([])
  })

  for (const { owner, prefix, parts } of ASSEMBLIES) {
    it(`${owner} joins exactly the declared shaders, prefix first`, () => {
      const found = appImports.get(owner) ?? []
      const declared = [prefix, ...parts].sort()
      expect(
        found.map((i) => i.file).sort(),
        `${owner} imports a different set of shaders than ASSEMBLIES declares for it; update ASSEMBLIES`,
      ).toEqual(declared)

      const prefixName = found.find((i) => i.file === prefix)?.ident
      const text = appFiles[`../${owner}`] ?? ''
      // The order matters: WGSL is read top to bottom by the front end, and
      // the parts use what the prefix declares.
      expect(
        prefixName !== undefined && text.includes(`code: ${prefixName} + code`),
        `${owner} no longer builds its modules as \`${prefixName} + code\`; the assembled text below is not what it sends`,
      ).toBe(true)
    })
  }

  it('passes every other shader to createShaderModule whole', () => {
    const owners = new Set(ASSEMBLIES.map((a) => a.owner))
    const wrong: string[] = []
    for (const [owner, found] of appImports) {
      if (owners.has(owner)) continue
      const text = appFiles[`../${owner}`] ?? ''
      for (const { ident, file } of found) {
        // `code: shader,` or `code: shader }` and nothing joined on, so the
        // file on disk is the module.
        if (!new RegExp(`code:\\s*${ident}\\s*[,}]`).test(text)) wrong.push(`${owner} (${file})`)
      }
    }
    expect(
      wrong,
      `these do not hand the file to createShaderModule on its own, so they need an entry in ASSEMBLIES: ${wrong.join(', ')}`,
    ).toEqual([])
  })
})

describe('shaders compile', () => {
  it.each(direct)('%s', (file) => {
    const verdict = checkWgsl(shaders.get(file) ?? '')
    expect(verdict.ok, explain(verdict, file)).toBe(true)
  })

  for (const { prefix, parts } of ASSEMBLIES) {
    describe.each(parts)(`${prefix} + %s`, (part) => {
      it('validates as the app builds it', () => {
        const prefixText = shaders.get(prefix) ?? ''
        const verdict = checkWgsl(prefixText + (shaders.get(part) ?? ''))
        expect(verdict.ok, explain(verdict, part, { file: prefix, text: prefixText })).toBe(true)
      })
    })
  }
})

// The two mistakes that reached a pull request with every other test green.
// They are here so the check is known to see them, not only to pass.
describe('the checker rejects what a browser rejects', () => {
  const frame = (body: string) =>
    `@fragment
fn fs() -> @location(0) vec4<f32> {
${body}
  return vec4<f32>(1.0);
}`

  function rejected(source: string): Extract<WgslVerdict, { ok: false }> {
    const verdict = checkWgsl(source)
    if (verdict.ok) throw new Error('expected the shader to be rejected')

    return verdict
  }

  it('accepts a sound shader', () => {
    expect(checkWgsl(frame('  var a = 1.0;\n  a = 2.0;')).ok).toBe(true)
  })

  it('rejects a local named `from`, on its line', () => {
    const verdict = rejected(frame('  let from = 1.0;'))
    expect(verdict.message).toContain('`from`')
    expect(verdict.message).toContain('reserved')
    expect(verdict.line).toBe(3)
    expect(verdict.report).toContain('wgsl:3:7')
  })

  it('rejects a local named `target`, on its line', () => {
    const verdict = rejected(frame('  var a = 1.0;\n  var target = a;'))
    expect(verdict.message).toContain('`target`')
    expect(verdict.line).toBe(4)
  })

  it('rejects assigning to a `let`, on the assignment', () => {
    const verdict = rejected(frame('  let a = 1.0;\n  a = 2.0;'))
    expect(verdict.message).toContain('assignment')
    // naga reports the binding it cannot change and the assignment together;
    // the report leads with the `let` on line 3 and points at line 4.
    expect(verdict.line).toBe(3)
    expect(verdict.report).toMatch(/\n4 │\s+a = 2\.0;/)
  })

  it('names the line in a failure from a real file', () => {
    const verdict = rejected(frame('  let from = 1.0;'))
    const text = explain(verdict, 'example.wgsl')
    expect(text).toMatch(/^src\/shaders\/example\.wgsl:3:7 /)
  })

  it('names the part, not the prefix, when the fault is in the part', () => {
    const prefix = 'fn unit_value() -> f32 { return 1.0; }\n'
    const verdict = rejected(prefix + frame('  let from = unit_value();'))
    const text = explain(verdict, 'fake.part.wgsl', { file: 'fake.common.wgsl', text: prefix })
    // Line 4 of the assembled text is line 3 of the part.
    expect(verdict.line).toBe(4)
    expect(text).toMatch(/^src\/shaders\/fake\.part\.wgsl:3:7 /)
  })
})

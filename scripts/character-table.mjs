/**
 * Plays a list of local files through the real extractor and prints what the
 * character reads from each, as a table.
 *
 * Why it is not a browser: the extractor takes an analyser frame and a `dt`
 * and nothing else, so `analyser.mjs` can hand it the frames a browser would
 * and the whole run goes at whatever speed ffmpeg decodes, which is about
 * thirty times real time here. That matters because calibrating an axis means
 * running the same sixteen tracks again after every change, and an hour a
 * pass is an hour nobody spends.
 *
 * Why it is JavaScript in a TypeScript repository: the extractor is loaded
 * through Vite's SSR loader, so this reads the same source the demo does with
 * no build step, no second tsconfig and no dependency added for a tool.
 *
 * It never writes to the library it reads, and the list of files is an
 * argument or an ignored file, so no one's paths land in the repository.
 *
 *   node scripts/character-table.mjs                     scripts/tracks.local.txt
 *   node scripts/character-table.mjs --list my-list.txt  a list of your own
 *   node scripts/character-table.mjs "M:/a.flac" "M:/b.flac"
 *
 * A list file is one track a line, `path | label | kind`, with the label and
 * the kind optional. Blank lines and lines opening with # are skipped.
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { createServer } from 'vite'

import { createAnalyser } from './analyser.mjs'

/** What the browser's graph uses, so the bins line up with the real thing. */
const FFT_SIZE = 4096
const SAMPLE_RATE = 48000
/** The demo runs on requestAnimationFrame, so the packet arrives at this rate. */
const FRAMES_A_SECOND = 60

/** The stretch of each track the table is the mean over. */
const FROM_SECONDS = 30
const TO_SECONDS = 70

const usage = `usage: node scripts/character-table.mjs [--list <file>] [--from <s>] [--to <s>] [--rate <fps>] [files...]`

function parseArguments(argv) {
  const files = []
  const options = { list: null, from: FROM_SECONDS, to: TO_SECONDS, rate: FRAMES_A_SECOND }
  for (let at = 0; at < argv.length; at++) {
    const argument = argv[at]
    if (argument === '--help' || argument === '-h') {
      console.log(usage)
      process.exit(0)
    } else if (argument === '--list') options.list = argv[++at]
    else if (argument === '--from') options.from = Number(argv[++at])
    else if (argument === '--to') options.to = Number(argv[++at])
    else if (argument === '--rate') options.rate = Number(argv[++at])
    else files.push(argument)
  }

  return { files, options }
}

/** One track from a list line: `path | label | kind`, the last two optional. */
function parseLine(line) {
  const [path, label, kind] = line.split('|').map((part) => part.trim())
  return { path, label: label || basename(path).replace(/\.[^.]+$/, ''), kind: kind || '' }
}

function readList(file) {
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map(parseLine)
}

/**
 * The track as mono float samples at the analyser's rate, through ffmpeg.
 * Mono because an AnalyserNode down-mixes what it is given before it looks at
 * it, and only the seconds the table covers, so a long track costs no more
 * than a short one.
 */
function decode(path, seconds) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      'ffmpeg',
      [
        '-v',
        'error',
        '-i',
        path,
        '-t',
        String(seconds),
        '-ac',
        '1',
        '-ar',
        String(SAMPLE_RATE),
        '-f',
        'f32le',
        '-',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const chunks = []
    let errors = ''
    ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk))
    ffmpeg.stderr.on('data', (chunk) => (errors += chunk))
    ffmpeg.on('error', reject)
    ffmpeg.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg (${code}) on ${path}: ${errors.trim()}`))
      const bytes = Buffer.concat(chunks)
      // A Buffer's bytes are not aligned for a Float32Array view, so copy.
      const samples = new Float32Array(bytes.byteLength / 4)
      for (let at = 0; at < samples.length; at++) samples[at] = bytes.readFloatLE(at * 4)
      resolve(samples)
    })
  })
}

/** Mean and standard deviation of a column, and its smallest and largest. */
function summarise(values) {
  if (values.length === 0) return { mean: 0, spread: 0, low: 0, high: 0 }
  let sum = 0
  for (const value of values) sum += value
  const mean = sum / values.length
  let squares = 0
  for (const value of values) squares += (value - mean) * (value - mean)
  return {
    mean,
    spread: Math.sqrt(squares / values.length),
    low: Math.min(...values),
    high: Math.max(...values),
  }
}

/** Where an axis is kept, apart from the rows. */
const axisKey = (axis) => `axis:${axis}`

const round = (value) => (Math.round(value * 100) / 100).toFixed(2)

function table(header, rows) {
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => String(row[column] ?? '').length)),
  )
  const line = (cells) =>
    `| ${cells.map((cell, column) => String(cell ?? '').padEnd(widths[column])).join(' | ')} |`
  return [
    line(header),
    `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`,
    ...rows.map(line),
  ].join('\n')
}

/**
 * One track through the extractor, the character and the moment, frame by
 * frame at a fixed step. Everything the table shows is gathered over the
 * window; the readings before it are the warm-up the character needs.
 */
async function measure(track, modules, options) {
  const { FeatureExtractor, F, CharacterReader, MomentReader, CHARACTER_AXES, ROWS } = modules
  const samples = await decode(track.path, options.to)
  const analyse = createAnalyser(FFT_SIZE)
  const extractor = new FeatureExtractor({ fftSize: FFT_SIZE, sampleRate: SAMPLE_RATE })
  const character = new CharacterReader()
  const moment = new MomentReader()
  const dt = 1 / options.rate
  const hop = SAMPLE_RATE / options.rate
  // The axes are kept under a key of their own: two of them are named after
  // the row they used to be, and a shared key silently mixed the two.
  const columns = new Map()
  for (const name of [...ROWS, ...CHARACTER_AXES.map(axisKey)]) columns.set(name, [])
  let last = null

  for (let frame = 0; ; frame++) {
    const end = Math.round(frame * hop)
    if (end > samples.length) break
    const packet = extractor.update(analyse(samples, end), dt)
    const axes = character.step(packet, dt)
    const weights = moment.step(packet, dt)
    const at = frame / options.rate
    if (at < options.from) continue
    for (const name of ROWS) columns.get(name).push(packet[F[name]])
    for (const axis of CHARACTER_AXES) columns.get(axisKey(axis)).push(axes[axis])
    last = { axes: { ...axes }, weights: { ...weights }, settled: character.settled }
  }

  const summary = new Map()
  for (const [name, values] of columns) summary.set(name, summarise(values))
  return { track, summary, last }
}

/** What the director would put on screen for this track in a settled groove. */
function grooveCast(modules, axes) {
  const { pickCast, MOMENTS } = modules
  const weights = Object.fromEntries(MOMENTS.map((name) => [name, name === 'groove' ? 1 : 0]))
  return pickCast({ character: axes, weights, settled: 1 })
}

async function main() {
  const { files, options } = parseArguments(process.argv.slice(2))
  const tracks =
    files.length > 0 ? files.map(parseLine) : readList(options.list ?? 'scripts/tracks.local.txt')
  const server = await createServer({
    configFile: false,
    logLevel: 'error',
    server: { middlewareMode: true },
    appType: 'custom',
  })
  const load = (path) => server.ssrLoadModule(path)
  const [extractorModule, characterModule, momentModule, directorModule, typesModule] =
    await Promise.all([
      load('/src/audio/FeatureExtractor.ts'),
      load('/src/director/character.ts'),
      load('/src/director/moment.ts'),
      load('/src/director/director.ts'),
      load('/src/studies/types.ts'),
    ])
  const modules = {
    FeatureExtractor: extractorModule.FeatureExtractor,
    F: extractorModule.F,
    CharacterReader: characterModule.CharacterReader,
    MomentReader: momentModule.MomentReader,
    pickCast: directorModule.pickCast,
    CHARACTER_AXES: typesModule.CHARACTER_AXES,
    MOMENTS: typesModule.MOMENTS,
    // The rows the character is built from. `grit` is only there once the
    // calibration has added it, so the table asks the packet what it holds.
    ROWS: ['pace', 'tempo', 'weight', 'keyClarity', 'tempoConfidence', 'hardness'].concat(
      'grit' in extractorModule.F ? ['grit'] : [],
    ),
  }

  const results = []
  for (const track of tracks) {
    process.stderr.write(`${track.label}\n`)
    results.push(await measure(track, modules, options))
  }

  await server.close()

  console.log(`\nMeans over ${options.from} to ${options.to} s, spread in brackets.\n`)
  console.log(
    table(
      ['track', 'kind', ...modules.ROWS],
      results.map((result) => [
        result.track.label,
        result.track.kind,
        ...modules.ROWS.map((name) => {
          const { mean, spread } = result.summary.get(name)
          return `${round(mean)} (${round(spread)})`
        }),
      ]),
    ),
  )

  console.log(`\nThe five axes over the same stretch.\n`)
  console.log(
    table(
      ['track', 'kind', ...modules.CHARACTER_AXES],
      results.map((result) => [
        result.track.label,
        result.track.kind,
        ...modules.CHARACTER_AXES.map((axis) => {
          const { mean, spread } = result.summary.get(axisKey(axis))
          return `${round(mean)} (${round(spread)})`
        }),
      ]),
    ),
  )

  console.log(`\nWhat the director casts in a groove at ${options.to} s.\n`)
  console.log(
    table(
      ['track', 'kind', 'flow', 'inks', 'look'],
      results.map((result) => {
        const cast = grooveCast(modules, result.last.axes)
        return [
          result.track.label,
          result.track.kind,
          cast?.flow ?? '-',
          cast?.inks.join(', ') ?? '-',
          cast?.look ?? '-',
        ]
      }),
    ),
  )

  console.log(`\nHow far each axis spreads across the tracks.\n`)
  console.log(
    table(
      ['axis', 'lowest', 'highest', 'span'],
      modules.CHARACTER_AXES.map((axis) => {
        const means = results.map((result) => result.summary.get(axisKey(axis)).mean)
        return [
          axis,
          round(Math.min(...means)),
          round(Math.max(...means)),
          round(Math.max(...means) - Math.min(...means)),
        ]
      }),
    ),
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

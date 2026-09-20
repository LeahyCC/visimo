/**
 * The same table as `character-table.mjs`, taken from a real browser.
 *
 * It is the slow path, one track a minute and change, because the only way to
 * read a real AnalyserNode is to let the track play. Its job is to keep the
 * fast path honest: run both over the same files and the rows should agree,
 * and if they ever stop agreeing it is the browser that is right.
 *
 * It needs a dev server on 5174 (`npm run dev`), Edge, and playwright-core,
 * which is not a dependency of the package: `npm i --no-save playwright-core`.
 *
 *   node scripts/character-table-browser.mjs [--list <file>] [--from <s>] [--to <s>]
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { chromium } from 'playwright-core'

const URL = 'http://127.0.0.1:5174/'
const FROM_SECONDS = 30
const TO_SECONDS = 70

const ROWS = ['pace', 'tempo', 'weight', 'keyClarity', 'tempoConfidence', 'hardness', 'grit']
/** Packet indices, from the `F` table in `audio/FeatureExtractor.ts`. */
const AT = {
  pace: 24,
  tempo: 27,
  weight: 26,
  keyClarity: 29,
  tempoConfidence: 44,
  hardness: 46,
  grit: 51,
}

function parseArguments(argv) {
  const files = []
  const options = { list: null, from: FROM_SECONDS, to: TO_SECONDS }
  for (let at = 0; at < argv.length; at++) {
    const argument = argv[at]
    if (argument === '--list') options.list = argv[++at]
    else if (argument === '--from') options.from = Number(argv[++at])
    else if (argument === '--to') options.to = Number(argv[++at])
    else files.push(argument)
  }

  return { files, options }
}

const parseLine = (line) => {
  const [path, label, kind] = line.split('|').map((part) => part.trim())
  return { path, label: label || basename(path).replace(/\.[^.]+$/, ''), kind: kind || '' }
}

const readList = (file) =>
  readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map(parseLine)

function summarise(values) {
  let sum = 0
  for (const value of values) sum += value
  const mean = sum / Math.max(values.length, 1)
  let squares = 0
  for (const value of values) squares += (value - mean) * (value - mean)
  return { mean, spread: Math.sqrt(squares / Math.max(values.length, 1)) }
}

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

async function main() {
  const { files, options } = parseArguments(process.argv.slice(2))
  const tracks =
    files.length > 0 ? files.map(parseLine) : readList(options.list ?? 'scripts/tracks.local.txt')
  const browser = await chromium.launch({
    channel: 'msedge',
    args: [
      '--headless=new',
      '--enable-unsafe-webgpu',
      '--use-angle=d3d11',
      '--mute-audio',
      '--autoplay-policy=no-user-gesture-required',
    ],
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await page.goto(URL, { waitUntil: 'load' })
  const results = []
  for (const track of tracks) {
    process.stderr.write(`${track.label}\n`)
    await page.setInputFiles('input[type=file]', track.path)
    // Muting the output is the browser's business and not the element's: the
    // analyser hears the element after its volume control, so a low volume
    // would quieten the features themselves.
    const rows = await page.evaluate(
      async ({ from, to, at, names }) => {
        const element = document.querySelector('audio')
        element.volume = 1
        element.currentTime = 0
        await element.play()
        const taken = Object.fromEntries(names.map((name) => [name, []]))
        await new Promise((resolve) => {
          const tick = () => {
            const now = element.currentTime
            if (now >= to || element.ended) return resolve()
            if (now >= from) {
              const features = window.visimo.features()
              for (const name of names) taken[name].push(features[at[name]] ?? 0)
            }

            requestAnimationFrame(tick)
          }

          requestAnimationFrame(tick)
        })
        element.pause()
        return taken
      },
      { from: options.from, to: options.to, at: AT, names: ROWS },
    )
    results.push({ track, rows })
  }

  await browser.close()
  console.log(
    `\nA real adapter, means over ${options.from} to ${options.to} s, spread in brackets.\n`,
  )
  console.log(
    table(
      ['track', 'kind', ...ROWS],
      results.map((result) => [
        result.track.label,
        result.track.kind,
        ...ROWS.map((name) => {
          const { mean, spread } = summarise(result.rows[name])
          return `${round(mean)} (${round(spread)})`
        }),
      ]),
    ),
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

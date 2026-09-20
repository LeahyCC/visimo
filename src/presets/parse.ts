/**
 * Narrowing for the files the package compiles in. Everything arrives as
 * `unknown` and is checked on the way through, and every message names the
 * file and the path inside it, because a cast is a wall of numbers and
 * "expected a number" on its own is no help.
 *
 * `parsePreset` used to live here and the shape it read is gone; what is left
 * is the seven helpers `studies/cast.ts` reads its files with. They are
 * generic and know nothing of any shape, which is why they sit beside the
 * vocabulary in `knobs.ts` rather than inside the studies.
 */

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const list = (values: readonly string[]) => values.join(', ')

export function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'object') return 'an object'
  return String(value)
}

// Declared rather than assigned, so TypeScript treats a call as the end of
// the branch and narrows what follows it.
export function fail(source: string, path: string, message: string): never {
  throw new Error(`${source}: ${path} ${message}`)
}

export function readNumber(value: unknown, source: string, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    fail(source, path, `expected a finite number, got ${describe(value)}`)
  return value
}

export function readBoolean(value: unknown, source: string, path: string): boolean {
  if (typeof value !== 'boolean') fail(source, path, `expected true or false`)
  return value
}

export function readString(value: unknown, source: string, path: string): string {
  if (typeof value !== 'string' || !value)
    fail(source, path, `expected a name, got ${describe(value)}`)
  return value
}

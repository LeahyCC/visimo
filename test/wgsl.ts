import { NagaError, parseWgsl, validate } from 'naga-wasm'

export type WgslVerdict =
  | { ok: true }
  | { ok: false; message: string; line: number | null; column: number | null; report: string }

/**
 * Run a WGSL module through naga's front end and validator, which is the same
 * parse-then-validate a browser's compiler does, without a GPU. It sits under
 * `test/` and not `src/` because `src` is the published file list and this is
 * a dev dependency.
 *
 * naga puts the position only in its formatted report (`wgsl:2:7`), so it is
 * lifted out here for a caller that wants to name the line.
 */
export function checkWgsl(source: string): WgslVerdict {
  // The handles hold wasm memory, so they are released whether or not
  // validation throws.
  let module: ReturnType<typeof parseWgsl> | undefined
  let info: ReturnType<typeof validate> | undefined
  try {
    module = parseWgsl(source)
    info = validate(module)

    return { ok: true }
  } catch (error) {
    if (!(error instanceof NagaError)) throw error
    const at = /wgsl:(\d+):(\d+)/.exec(error.formatted)

    return {
      ok: false,
      message: error.message,
      line: at ? Number(at[1]) : null,
      column: at ? Number(at[2]) : null,
      report: error.formatted,
    }
  } finally {
    info?.free()
    module?.free()
  }
}

import { create } from 'webgpu'

export type WgslVerdict =
  | { ok: true }
  | { ok: false; message: string; line: number | null; column: number | null; report: string }

export type WgslChecker = {
  check: (source: string) => Promise<WgslVerdict>
  close: () => void
}

/** A message's position, or null where Tint gave none (it reports 0). */
const position = (n: number) => (n > 0 ? n : null)

/**
 * A checker that compiles WGSL with Tint, the compiler Chromium uses, on
 * Dawn's Node bindings. It sits under `test/` and not `src/` because `src` is
 * the published file list and `webgpu` is a dev dependency.
 *
 * The `null` backend is what lets this run with no GPU and no Vulkan
 * driver: it is a real Dawn device that draws nothing, and shader modules are
 * parsed and validated by Tint on the CPU before any backend is asked to do
 * anything. Nothing here submits work.
 *
 * Checks share one device and one error-scope stack, so they must be awaited
 * one at a time, which a test file does.
 */
export async function createWgslChecker(): Promise<WgslChecker> {
  const gpu = create(['backend=null'])
  const adapter = await gpu.requestAdapter()
  if (!adapter) throw new Error('Dawn found no adapter, not even the null backend')
  const device = await adapter.requestDevice()

  return {
    async check(source) {
      // The scope keeps a rejected module from surfacing later as an
      // uncaptured error that fails some other test.
      device.pushErrorScope('validation')
      const module = device.createShaderModule({ code: source })
      const info = await module.getCompilationInfo()
      const scoped = await device.popErrorScope()
      const errors = info.messages.filter((m) => m.type === 'error')
      const first = errors[0]
      if (!first && !scoped) return { ok: true }

      const lines = source.split('\n')
      const report = info.messages
        .map((m) => {
          const at = `${m.lineNum}:${m.linePos}`
          const shown = m.lineNum > 0 ? `\n${m.lineNum} | ${lines[m.lineNum - 1] ?? ''}` : ''

          return `${m.type}: ${m.message} (${at})${shown}`
        })
        .join('\n')

      return {
        ok: false,
        // A module can be refused with no message on the module itself, in
        // which case the scope's text is all there is.
        message: first?.message ?? scoped?.message ?? 'shader module rejected',
        line: first ? position(first.lineNum) : null,
        column: first ? position(first.linePos) : null,
        report: report || (scoped?.message ?? ''),
      }
    },
    close() {
      // Dropping the device lets the process exit; Dawn keeps it alive
      // otherwise.
      device.destroy()
    },
  }
}

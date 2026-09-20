/**
 * Frame times over the last two seconds: the average, and the worst. A frame
 * time is the gap between two drawn frames as the renderer measured it, so a
 * cast that costs more than the display's refresh shows up as a longer gap,
 * and one that costs less shows the refresh itself. That is the reason to read
 * the worst as well as the average: one hitch in a hundred frames moves the
 * average by nothing and is what a viewer sees.
 *
 * The window is measured in the frames' own time and not the clock's, so it
 * holds two seconds of drawing however slowly it was drawn. A ring buffer of
 * fixed size, since a frame pushes one number and nothing may allocate.
 */
export const WINDOW_MS = 2000

/** Two seconds of a display at 1000 Hz, which is more than any of them are. */
const CAPACITY = 2048

export class FrameMeter {
  private readonly ms = new Float32Array(CAPACITY)
  private start = 0
  private count = 0
  private total = 0

  push(ms: number) {
    if (!Number.isFinite(ms) || ms < 0) return
    if (this.count === CAPACITY) this.drop()
    this.ms[(this.start + this.count) % CAPACITY] = ms
    this.count += 1
    this.total += ms
    // Keep at least the newest frame, however long it took.
    while (this.count > 1 && this.total - (this.ms[this.start] ?? 0) >= WINDOW_MS) this.drop()
  }

  private drop() {
    this.total -= this.ms[this.start] ?? 0
    this.start = (this.start + 1) % CAPACITY
    this.count -= 1
  }

  reset() {
    this.start = 0
    this.count = 0
    this.total = 0
  }

  get frames(): number {
    return this.count
  }

  /** Milliseconds per frame, or 0 before there is one. */
  get average(): number {
    return this.count === 0 ? 0 : this.total / this.count
  }

  get worst(): number {
    let worst = 0
    for (let at = 0; at < this.count; at += 1)
      worst = Math.max(worst, this.ms[(this.start + at) % CAPACITY] ?? 0)
    return worst
  }
}

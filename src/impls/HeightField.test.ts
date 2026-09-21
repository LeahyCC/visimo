/**
 * height-kit's GPU half against a stand-in for the device, so what it makes
 * once and what it uploads a frame can be counted. What the ground looks like
 * needs a browser; that a frame with no new row uploads no row, that a study
 * that was dark comes back with all of it, and that the layout says the two
 * bindings the shader declares, does not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PACKET_LENGTH } from '../audio/FeatureExtractor'
import {
  HEIGHT_BANDS,
  HEIGHT_COLUMNS,
  HEIGHT_ROW_SPACING,
  HEIGHT_ROWS,
  HEIGHT_VIEW_FLOATS,
} from './height.params'
import { HEIGHT_BINDINGS, HeightField, heightLayoutEntries } from './HeightField'

vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, STORAGE: 2, COPY_DST: 4 })
vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2 })

type Buffer = {
  label: string
  size: number
  usage: number
  destroyed: boolean
  destroy: () => void
}

function fakeDevice() {
  const buffers: Buffer[] = []
  const writes: { buffer: Buffer; offset: number; floats: number }[] = []
  const device = {
    createBuffer: ({ label, size, usage }: { label: string; size: number; usage: number }) => {
      const buffer: Buffer = {
        label,
        size,
        usage,
        destroyed: false,
        destroy: () => (buffer.destroyed = true),
      }
      buffers.push(buffer)
      return buffer
    },
    queue: {
      writeBuffer: (
        buffer: Buffer,
        offset: number,
        data: Float32Array,
        dataOffset = 0,
        size = data.length - dataOffset,
      ) => {
        writes.push({ buffer, offset, floats: size })
        // The write must stay inside what was made, or the device rejects it.
        expect(offset + size * 4).toBeLessThanOrEqual(buffer.size)
        expect(dataOffset + size).toBeLessThanOrEqual(data.length)
      },
    },
  }

  return { buffers, writes, device: device as unknown as GPUDevice }
}

const sounding = () => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const band of HEIGHT_BANDS) out[band] = 0.6
  return out
}

let gpu: ReturnType<typeof fakeDevice>
let field: HeightField

beforeEach(() => {
  gpu = fakeDevice()
  field = new HeightField()
  field.init(gpu.device)
})

const rowWrites = () => gpu.writes.filter((write) => write.buffer.label === 'Height rows')
const viewWrites = () => gpu.writes.filter((write) => write.buffer.label === 'Height view')

describe('the height field on the device', () => {
  it('makes its two buffers once, sized for the ring and the view, with the usages they are read by', () => {
    expect(gpu.buffers.map((buffer) => [buffer.label, buffer.size])).toEqual([
      ['Height view', HEIGHT_VIEW_FLOATS * 4],
      ['Height rows', HEIGHT_ROWS * HEIGHT_COLUMNS * 4],
    ])
    // Uniform for the view and read-only storage for the rows, each written from the CPU.
    expect(gpu.buffers[0]?.usage).toBe(1 | 4)
    expect(gpu.buffers[1]?.usage).toBe(2 | 4)
    for (let frame = 0; frame < 30; frame += 1) {
      field.advance(0.5, 1 / 60, sounding())
      field.upload({ valley: 0.5, relief: 1 }, 1920, 1080)
    }

    expect(gpu.buffers).toHaveLength(2)
  })

  it('names the two bindings the shader declares, and leaves the rest to the study', () => {
    const entries = heightLayoutEntries(2)
    expect(entries.map((entry) => entry.binding)).toEqual([
      HEIGHT_BINDINGS.view,
      HEIGHT_BINDINGS.rows,
    ])
    expect(entries[0]?.buffer?.type).toBe('uniform')
    expect(entries[1]?.buffer?.type).toBe('read-only-storage')
    expect(entries.every((entry) => entry.visibility === 2)).toBe(true)
    expect(field.bindGroupEntries().map((entry) => entry.binding)).toEqual([0, 1])
  })

  it('refuses to hand out bindings before it has buffers', () => {
    expect(() => new HeightField().bindGroupEntries()).toThrow(/before init/)
  })

  it('uploads the whole ring on the first frame, as a fresh device has none of it', () => {
    field.upload({ valley: 0.5, relief: 1 }, 1920, 1080)
    expect(rowWrites().map((write) => write.floats)).toEqual([HEIGHT_ROWS * HEIGHT_COLUMNS])
    expect(viewWrites()).toHaveLength(1)
  })

  it('uploads no row on a frame that was born none, and only the view', () => {
    field.upload({ valley: 0.5, relief: 1 }, 1920, 1080)
    gpu.writes.length = 0
    // Under one row of travel: nothing new for the far end.
    expect(field.advance(HEIGHT_ROW_SPACING * 0.4, 1 / 60, sounding())).toBe(0)
    field.upload({ valley: 0.5, relief: 1 }, 1920, 1080)
    expect(rowWrites()).toHaveLength(0)
    expect(viewWrites()).toHaveLength(1)
  })

  it('uploads just the rows born, at the byte offset of their slots', () => {
    field.upload({ valley: 0.5, relief: 1 }, 1920, 1080)
    gpu.writes.length = 0
    field.advance(HEIGHT_ROW_SPACING * 3.1, 0.1, sounding())
    field.upload({ valley: 0.5, relief: 1 }, 1920, 1080)
    expect(rowWrites()).toHaveLength(1)
    expect(rowWrites()[0]).toMatchObject({ offset: 0, floats: 3 * HEIGHT_COLUMNS })
  })

  it('costs the device nothing while it is dark, and brings the whole ring up when it comes back', () => {
    field.upload({ valley: 0.5, relief: 1 }, 1920, 1080)
    gpu.writes.length = 0
    // Two seconds of flight with no upload: CPU only.
    for (let frame = 0; frame < 120; frame += 1) field.advance(0.5, 1 / 60, sounding())
    expect(gpu.writes).toHaveLength(0)
    field.upload({ valley: 0.5, relief: 1 }, 1920, 1080)
    expect(rowWrites().reduce((sum, write) => sum + write.floats, 0)).toBe(
      HEIGHT_ROWS * HEIGHT_COLUMNS,
    )
  })

  it('releases its buffers on dispose and does nothing after', () => {
    field.dispose()
    expect(gpu.buffers.every((buffer) => buffer.destroyed)).toBe(true)
    gpu.writes.length = 0
    field.upload({ valley: 0.5, relief: 1 }, 1920, 1080)
    expect(gpu.writes).toHaveLength(0)
  })
})

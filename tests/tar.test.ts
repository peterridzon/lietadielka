/**
 * The tar reader is hand-written, so it is checked against the system tar rather than
 * against my own idea of the format. Every case here is one that actually occurs in an
 * adsb.lol daily archive: names too long for the 100-byte header field, members that
 * straddle the boundary between two split parts, and tens of thousands of entries we do
 * not want surrounding the handful we do.
 *
 * A silent failure here would not look like a crash. It would look like an aircraft that
 * never flew.
 */
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readTarStream } from '../src/lib/tar.js'

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

/** macOS tar writes ._ AppleDouble members that are not part of what was archived. */
const real = (name: string) => !basename(name).startsWith('._')

let root: string
let parts: string[]
const written = new Map<string, Buffer>()

function put(relative: string, bytes: Buffer): void {
  const full = join(root, relative)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, bytes)
  written.set(relative, bytes)
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'lietadielka-tar-'))

  // A trace-shaped file, the thing we are actually here for.
  put('traces/06/trace_full_505c06.json', randomBytes(3000))
  // Larger than one split part, so it must be reassembled across the boundary.
  put('traces/a1/spans_parts.bin', randomBytes(900_000))
  // Exactly one block, and one byte over: the padding arithmetic is off-by-one prone.
  put('traces/02/exactly_512.json', randomBytes(512))
  put('traces/02/one_over.json', randomBytes(513))
  put('traces/02/single_byte.json', Buffer.from('x'))
  // Longer than the 100-byte name field, which forces a GNU long-name member in front.
  put(`traces/cb/${'d'.repeat(90)}/${'n'.repeat(80)}.json`, randomBytes(700))

  execFileSync('tar', ['cf', join(root, 'all.tar'), '-C', root, 'traces'])

  // Split at a size that lands mid-member, mirroring the real archive's ~2 GB parts.
  const whole = readFileSync(join(root, 'all.tar'))
  const size = 400_000
  parts = []
  for (let offset = 0, i = 0; offset < whole.length; offset += size, i++) {
    const path = join(root, `part.${i}`)
    writeFileSync(path, whole.subarray(offset, offset + size))
    parts.push(path)
  }
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

async function* streamParts(paths: string[]): AsyncGenerator<Uint8Array> {
  for (const path of paths) {
    const bytes = readFileSync(path)
    // Deliberately ragged chunks: a reader that assumes chunk boundaries align with
    // tar blocks passes on whole files and fails here.
    for (let at = 0; at < bytes.length; at += 7919) {
      yield bytes.subarray(at, at + 7919)
    }
  }
}

async function extract(want: (name: string) => boolean) {
  const got = new Map<string, Buffer>()
  const summary = await readTarStream(
    streamParts(parts),
    (name) => real(name) && want(name),
    (entry) => {
      got.set(entry.name, entry.data)
    },
  )
  return { got, summary }
}

describe('tar reader', () => {
  it('splits into more than one part, or the test proves nothing', () => {
    expect(parts.length).toBeGreaterThan(1)
  })

  it('reads every file back byte for byte', async () => {
    const { got } = await extract(() => true)
    for (const [relative, expected] of written) {
      const actual = got.get(relative)
      expect(actual, `${relative} missing`).toBeDefined()
      expect(actual!.length, `${relative} length`).toBe(expected.length)
      expect(sha(actual!), `${relative} contents`).toBe(sha(expected))
    }
  })

  it('reassembles a member that straddles a part boundary', async () => {
    const name = 'traces/a1/spans_parts.bin'
    const { got } = await extract((n) => n === name)
    expect(got.size).toBe(1)
    expect(sha(got.get(name)!)).toBe(sha(written.get(name)!))
  })

  it('handles names too long for the header field', async () => {
    const long = [...written.keys()].find((k) => k.includes('d'.repeat(90)))!
    const { got } = await extract((n) => n === long)
    expect(sha(got.get(long)!)).toBe(sha(written.get(long)!))
  })

  it('skips what was not asked for without buffering it', async () => {
    const only = 'traces/06/trace_full_505c06.json'
    const { got, summary } = await extract((n) => n === only)
    expect([...got.keys()]).toEqual([only])
    expect(summary.selected).toBe(1)
    // Everything was still walked — skipping must not mean stopping early, or entries
    // after the first match would be invisible.
    expect(summary.entries).toBeGreaterThanOrEqual(written.size)
  })

  it('counts the bytes it streamed', async () => {
    const { summary } = await extract(() => false)
    const total = parts.reduce((sum, p) => sum + readFileSync(p).length, 0)
    expect(summary.bytes).toBe(total)
    expect(summary.selected).toBe(0)
  })
})

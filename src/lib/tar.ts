/**
 * Minimal streaming tar reader.
 *
 * The adsb.lol daily archives are plain (uncompressed) tar, split across several parts
 * of about 2 GB, and their entries are NOT in sorted order — the observed sequence of
 * trace directories on one day was 20, 65, cb, 50, 02, 87, e7, fa, a1. A filename binary
 * search over HTTP range requests is therefore impossible even though the CDN supports
 * ranges: the only way in is to stream the whole thing and keep what you want.
 *
 * A dependency would do this, but the format needed here is one 512-byte header record
 * followed by data padded to the same size, and a day's archive is 3–4 GB of somebody
 * else's bandwidth. Reading it ourselves keeps the parsing honest about what it does and
 * does not support: regular files and GNU long names, everything else skipped.
 */

const BLOCK = 512

const OFF = {
  name: 0,
  size: 124,
  typeflag: 156,
  prefix: 345,
} as const

const TYPE_FILE = new Set(['0', '\0', ''])
const TYPE_GNU_LONGNAME = 'L'

function cstring(block: Buffer, offset: number, length: number): string {
  const slice = block.subarray(offset, offset + length)
  const end = slice.indexOf(0)
  return (end === -1 ? slice : slice.subarray(0, end)).toString('utf8')
}

/**
 * Sizes are octal ASCII, except that GNU writes anything above 8 GB as base-256 with the
 * high bit of the first byte set. No trace file comes close, but one oversized member in
 * the middle of the stream would otherwise be read as a tiny one and desynchronise every
 * entry after it.
 */
function readSize(block: Buffer): number {
  const first = block[OFF.size]
  if (first !== undefined && (first & 0x80) !== 0) {
    let value = 0
    for (let i = OFF.size + 1; i < OFF.size + 12; i++) value = value * 256 + (block[i] ?? 0)
    return value
  }
  const text = cstring(block, OFF.size, 12).trim()
  return text ? Number.parseInt(text, 8) : 0
}

function padded(size: number): number {
  return size + ((BLOCK - (size % BLOCK)) % BLOCK)
}

function isZeroBlock(block: Buffer): boolean {
  for (const byte of block) if (byte !== 0) return false
  return true
}

export type TarEntry = {
  name: string
  size: number
  data: Buffer
}

export type TarSummary = {
  entries: number
  selected: number
  bytes: number
}

/**
 * Reads entries from a byte stream, asking `wanted(name)` before any data is buffered.
 * Entries the caller does not want are counted and discarded without ever being held,
 * which is what makes a 4 GB archive cost only the few files we keep.
 *
 * `onEntry` receives the selected entries in stream order.
 */
export async function readTarStream(
  source: AsyncIterable<Uint8Array>,
  wanted: (name: string) => boolean,
  onEntry: (entry: TarEntry) => void | Promise<void>,
): Promise<TarSummary> {
  let pending = Buffer.alloc(0)
  let bytes = 0
  let entries = 0
  let selected = 0

  /** Bytes left in the current entry, data and padding together. */
  let remaining = 0
  /** Of those, how many are still real data worth keeping. */
  let keepBytes = 0
  let keeping: Buffer[] | null = null
  let current: { name: string; size: number } | null = null
  /** A GNU long name applies to the header that follows it. */
  let longName: string | null = null

  for await (const chunk of source) {
    bytes += chunk.byteLength
    pending = pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([pending, chunk])

    for (;;) {
      if (remaining > 0) {
        const take = Math.min(remaining, pending.length)
        if (take === 0) break
        if (keeping && keepBytes > 0) {
          const useful = Math.min(keepBytes, take)
          keeping.push(Buffer.from(pending.subarray(0, useful)))
          keepBytes -= useful
        }
        remaining -= take
        pending = pending.subarray(take)

        if (remaining === 0) {
          if (keeping && current) {
            await onEntry({ name: current.name, size: current.size, data: Buffer.concat(keeping) })
            selected++
          }
          keeping = null
          current = null
        }
        continue
      }

      if (pending.length < BLOCK) break
      const header = Buffer.from(pending.subarray(0, BLOCK))
      pending = pending.subarray(BLOCK)

      // Two zero blocks end an archive, but the parts are concatenated back to back, so
      // the end of one is the middle of the stream. Skip them and keep reading.
      if (isZeroBlock(header)) continue

      const type = cstring(header, OFF.typeflag, 1)
      const size = readSize(header)
      const prefix = cstring(header, OFF.prefix, 155)
      const raw = cstring(header, OFF.name, 100)

      if (type === TYPE_GNU_LONGNAME) {
        const total = padded(size)
        if (pending.length < total) {
          // Put the header back and wait for the whole payload; long names are tiny.
          pending = Buffer.concat([header, pending])
          break
        }
        longName = cstring(pending.subarray(0, size), 0, size)
        pending = pending.subarray(total)
        continue
      }

      const name = longName ?? (prefix ? `${prefix}/${raw}` : raw)
      longName = null
      entries++

      const keep = TYPE_FILE.has(type) && wanted(name)
      if (size === 0) {
        if (keep) {
          await onEntry({ name, size: 0, data: Buffer.alloc(0) })
          selected++
        }
        continue
      }

      current = keep ? { name, size } : null
      keeping = keep ? [] : null
      keepBytes = keep ? size : 0
      remaining = padded(size)
    }
  }

  return { entries, selected, bytes }
}

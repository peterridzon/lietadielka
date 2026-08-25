/**
 * adsb.lol daily release archive adapter.
 *
 * The live globe history endpoint keeps roughly 40 days. adsb.lol also publishes each UTC
 * day as a GitHub release holding the same trace files, and those go back years — which is
 * the only way to answer questions about a period that has already scrolled out of the
 * live window.
 *
 *   github.com/adsblol/globe_history_<year>
 *   tag  v<YYYY.MM.DD>-planes-readsb-prod-0
 *   assets  <tag>.tar.aa, .tar.ab, …   (~1–2 GB each, plain tar, concatenated in order)
 *
 * Two things make this adapter different from the live one.
 *
 * The archive is not addressable. Entries are stored unsorted, so there is no way to seek
 * to one aircraft: a day costs 3–4 GB of streaming whatever you are looking for. That is
 * why a day is extracted for the whole fleet at once and cached — fetching five aircraft
 * one at a time would mean streaming the same 4 GB five times.
 *
 * The archive is also unambiguous, which the live endpoint is not. Live, a 504 means
 * either "did not fly" or "day already pruned", and telling those apart needs sentinel
 * airframes. Here, having streamed the entire day, an absent trace is proof of absence.
 * A day either downloads or it does not, and that is recorded honestly either way.
 */
import { createGunzip } from 'node:zlib'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import type { AdsbPosition } from '../../core/types.js'
import { env } from '../../lib/env.js'
import { fetchWithRetry } from '../../lib/http.js'
import { log } from '../../lib/log.js'
import { readTarStream } from '../../lib/tar.js'
import { decodeTrace, type TraceFile } from '../trace.js'
import {
  type AdsbProvider,
  type ProviderCapabilities,
  type ProviderHealth,
  ProviderRangeUnavailableError,
} from '../provider.js'

const PROVIDER = 'archive'

/**
 * Which airframes to pull out while a day is streaming. Every extra one is free — the
 * bytes go past either way — so the backfill sets this to the whole fleet before it
 * starts. Left empty, only the aircraft being asked for is kept, which is correct but
 * costs a full re-stream per aircraft.
 */
let extractSet: string[] = []

export function setArchiveExtractSet(icaos: Iterable<string>): void {
  extractSet = [...new Set([...icaos].map((h) => h.toLowerCase()))]
}

function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function* eachUtcDay(from: Date, to: Date): Generator<Date> {
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  while (cursor < to) {
    yield new Date(cursor)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
}

type ReleaseAsset = { name: string; browser_download_url: string; size: number }
type Release = { tag_name: string; assets: ReleaseAsset[] }

export class ArchiveProvider implements AdsbProvider {
  readonly name = PROVIDER
  readonly capabilities: ProviderCapabilities = {
    history: true,
    // Bounded by what adsb.lol has published, not by a retention window.
    historyWindowDays: null,
    live: false,
    requiresAuth: false,
  }

  private readonly cacheRoot = resolve(env.archiveCacheDir)

  /** Where one day's extracted traces live once the archive has been streamed. */
  private dayDir(day: string): string {
    return join(this.cacheRoot, day)
  }

  /**
   * Written only after a day has been streamed to completion. Its presence is what makes
   * a missing trace mean "this aircraft did not fly" rather than "we have not looked yet",
   * so it must never be written for a partial run.
   */
  private doneMarker(day: string): string {
    return join(this.dayDir(day), '.complete')
  }

  private cachedTrace(day: string, icao24: string): Buffer | null {
    const path = join(this.dayDir(day), `${icao24.toLowerCase()}.json`)
    return existsSync(path) ? readFileSync(path) : null
  }

  /**
   * Candidate repositories for a date. Days at the end of December are published in the
   * following year's repository — 2025-12-14 lives in globe_history_2026 — so the year in
   * the date is a hint, not an address.
   */
  private repoCandidates(day: string): string[] {
    const year = Number(day.slice(0, 4))
    const owner = env.archiveRepoOwner
    const repos = [`${owner}/globe_history_${year}`]
    if (day.slice(5, 7) === '12') repos.push(`${owner}/globe_history_${year + 1}`)
    return repos
  }

  private async findRelease(day: string): Promise<{ repo: string; release: Release } | null> {
    const stamp = day.replace(/-/g, '.')
    for (const repo of this.repoCandidates(day)) {
      for (const variant of env.archiveVariants) {
        const tag = `v${stamp}-${variant}`
        const url = `https://api.github.com/repos/${repo}/releases/tags/${tag}`
        const headers: Record<string, string> = {
          accept: 'application/vnd.github+json',
          'user-agent': 'lietadielka',
        }
        // A token is not required for public repositories, but the unauthenticated rate
        // limit is 60 requests an hour, which a backfill exhausts in a minute.
        if (env.githubToken) headers.authorization = `Bearer ${env.githubToken}`

        const body = await fetchWithRetry(url, { headers, emptyStatuses: [404] })
        if (!body) continue
        const release = JSON.parse(Buffer.from(body).toString('utf8')) as Release
        if (release.assets?.length) return { repo, release }
      }
    }
    return null
  }

  /**
   * Streams every part of one day's archive and writes out the traces we want. Returns
   * false when the day is simply not published — that is a fact about the archive, not a
   * failure, and the caller records it as an unavailable day.
   */
  private async extractDay(day: string, wantedIcaos: string[]): Promise<boolean> {
    if (existsSync(this.doneMarker(day))) return true

    const found = await this.findRelease(day)
    if (!found) {
      log.warn(`archive: ${day} is not published in the release archive`)
      return false
    }

    // Parts must be concatenated in name order: .tar.aa then .tar.ab, never sorted by size.
    const parts = found.release.assets
      .filter((a) => /\.tar\.[a-z]{2}$/.test(a.name))
      .sort((a, b) => a.name.localeCompare(b.name))
    if (parts.length === 0) {
      log.warn(`archive: ${found.release.tag_name} has no tar parts`)
      return false
    }

    const want = new Map<string, string>()
    for (const hex of wantedIcaos) {
      want.set(`traces/${hex.slice(-2)}/trace_full_${hex}.json`, hex)
    }

    const dir = this.dayDir(day)
    mkdirSync(dir, { recursive: true })

    const total = parts.reduce((sum, p) => sum + p.size, 0)
    log.info(
      `archive: streaming ${day} — ${found.release.tag_name}, ` +
        `${parts.length} ${parts.length === 1 ? 'part' : 'parts'}, ${(total / 1e9).toFixed(2)} GB`,
    )
    const started = Date.now()

    // fetchWithRetry buffers whole bodies, which is exactly wrong for a 2 GB part, so the
    // download is a plain streaming fetch. A part that fails midway cannot be resumed
    // without desynchronising the tar, so the whole day is retried from the start.
    async function* bytes(): AsyncGenerator<Uint8Array> {
      for (const part of parts) {
        const response = await fetch(part.browser_download_url, {
          headers: { 'user-agent': 'lietadielka/0.1 (+transparency research)' },
        })
        if (!response.ok || !response.body) {
          throw new Error(`archive: HTTP ${response.status} for ${part.name}`)
        }
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          yield chunk
        }
      }
    }

    let kept = 0
    const summary = await readTarStream(
      bytes(),
      // Names inside the archive are prefixed with "./"; compare on the tail so a change
      // of prefix does not silently match nothing and report an empty day.
      (name) => want.has(name.replace(/^\.\//, '')),
      (entry) => {
        const hex = want.get(entry.name.replace(/^\.\//, ''))
        if (!hex) return
        writeFileSync(join(dir, `${hex}.json`), entry.data)
        kept++
      },
    )

    // Only now is absence meaningful.
    writeFileSync(
      this.doneMarker(day),
      JSON.stringify({
        day,
        repo: found.repo,
        tag: found.release.tag_name,
        entries: summary.entries,
        bytes: summary.bytes,
        extracted: wantedIcaos,
        completedAt: new Date().toISOString(),
      }),
    )

    log.info(
      `archive: ${day} done — ${summary.entries.toLocaleString('sk')} entries scanned, ` +
        `${kept} kept, ${(summary.bytes / 1e9).toFixed(2)} GB, ` +
        `${Math.round((Date.now() - started) / 1000)} s`,
    )
    return true
  }

  async getDayPositions(icao24: string, day: Date): Promise<AdsbPosition[] | null> {
    const key = utcDayKey(day)
    const hex = icao24.toLowerCase()

    if (!existsSync(this.doneMarker(key))) {
      const wanted = extractSet.length ? [...new Set([...extractSet, hex])] : [hex]
      const ok = await this.extractDay(key, wanted)
      if (!ok) return null
    }

    const raw = this.cachedTrace(key, hex)
    // The day was streamed in full, so no trace means the aircraft was not seen.
    if (!raw) return []

    let file: TraceFile
    try {
      const text =
        raw[0] === 0x1f && raw[1] === 0x8b
          ? (await gunzip(raw)).toString('utf8')
          : raw.toString('utf8')
      file = JSON.parse(text) as TraceFile
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.warn(`archive: unparseable trace for ${hex} on ${key}: ${message}`)
      return null
    }
    return decodeTrace(hex, file, this.name)
  }

  async getAircraftHistory(icao24: string, from: Date, to: Date): Promise<AdsbPosition[]> {
    const all: AdsbPosition[] = []
    let unavailable = 0
    let days = 0

    for (const day of eachUtcDay(from, to)) {
      days++
      const positions = await this.getDayPositions(icao24, day)
      if (positions === null) {
        unavailable++
        continue
      }
      all.push(...positions)
    }

    // Same rule as the live adapter: a range we could not read at all is an error, not an
    // empty result, or a gap in the archive would be recorded as a quiet period.
    if (days > 0 && unavailable === days) {
      throw new ProviderRangeUnavailableError(
        this.name,
        'no day in this range is published in the adsb.lol release archive',
        from,
        to,
      )
    }

    all.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    return all
  }

  /** Days already extracted, useful for reporting backfill progress without a database. */
  listCachedDays(): string[] {
    if (!existsSync(this.cacheRoot)) return []
    return readdirSync(this.cacheRoot)
      .filter((name) => existsSync(this.doneMarker(name)))
      .sort()
  }

  async probe(): Promise<ProviderHealth> {
    const yesterday = new Date(Date.now() - 86_400_000)
    const found = await this.findRelease(utcDayKey(yesterday))
    return found
      ? { ok: true, detail: `latest release ${found.release.tag_name} in ${found.repo}` }
      : { ok: false, detail: 'no release found for yesterday' }
  }
}

async function gunzip(buffer: Buffer): Promise<Buffer> {
  const chunks: Buffer[] = []
  const stream = Readable.from(buffer).pipe(createGunzip())
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

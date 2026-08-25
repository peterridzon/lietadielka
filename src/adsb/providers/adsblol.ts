/**
 * adsb.lol history adapter.
 *
 * adsb.lol republishes readsb "globe history" traces: one gzipped JSON file per
 * aircraft per UTC day at
 *   {base}/globe_history/YYYY/MM/DD/traces/{last two hex chars}/trace_full_{icao}.json
 *
 * Measured 2026-08-21/22: the archive keeps roughly the last 40 to 45 days, pruned
 * continuously, so the boundary moves during a long run.
 *
 * The archive answers 504 for ANY trace it does not hold — both "this aircraft did not
 * fly that day" and "that day is outside retention". Those two mean opposite things for
 * data coverage, and the HTTP status alone cannot tell them apart.
 *
 * We disambiguate with a day sentinel: a handful of airliners that fly almost every day.
 * If a sentinel trace exists for the day, the archive holds that day, so a 504 for our
 * aircraft genuinely means it was not seen. If no sentinel exists either, the day itself
 * is missing and we report it as unavailable rather than as zero flights. When in doubt
 * the answer is "unavailable" — undercounting coverage is safe, undercounting flights is not.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { dirname, join, resolve } from 'node:path'
import type { AdsbPosition } from '../../core/types.js'
import { env } from '../../lib/env.js'
import { fetchWithRetry } from '../../lib/http.js'
import { log } from '../../lib/log.js'
import { decodeTrace, type TraceFile } from '../trace.js'
import {
  type AdsbProvider,
  type ProviderCapabilities,
  type ProviderHealth,
  ProviderRangeUnavailableError,
} from '../provider.js'



/**
 * The default sentinel airframes live in env.adsblolDaySentinels: high-utilisation
 * short-haul aircraft verified as present on five sampled archive days (2026-08-21).
 * Any one of them answering proves the day is held. Override with ADSBLOL_DAY_SENTINELS
 * if those airframes are ever retired or grounded.
 */


function utcDayKey(date: Date): { y: string; m: string; d: string } {
  return {
    y: String(date.getUTCFullYear()),
    m: String(date.getUTCMonth() + 1).padStart(2, '0'),
    d: String(date.getUTCDate()).padStart(2, '0'),
  }
}

/** Every UTC day that overlaps [from, to). `to` is exclusive, so a one-day range is one day. */
function* eachUtcDay(from: Date, to: Date): Generator<Date> {
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  while (cursor < to) {
    yield new Date(cursor)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
}

export type AdsbLolDayResult = {
  date: Date
  /** 'ok' = archive answered, 'empty' = aircraft not seen, 'unavailable' = retention/outage. */
  status: 'ok' | 'empty' | 'unavailable'
  positions: AdsbPosition[]
  detail?: string
}

export class AdsbLolProvider implements AdsbProvider {
  readonly name = 'adsblol'
  readonly capabilities: ProviderCapabilities = {
    history: true,
    // Measured, not advertised, and it drifts: 44 days on 2026-08-21, 40 the next
    // morning. Treated as a floor, with the day sentinel deciding each day for real.
    historyWindowDays: 40,
    live: true,
    requiresAuth: false,
  }

  /** Memoised per day key, so one run costs at most one sentinel check per day. */
  private readonly dayAvailability = new Map<string, boolean>()

  constructor(
    private readonly baseUrl = env.adsblolHistoryBaseUrl,
    private readonly cacheDir = env.adsbCacheDir,
    private readonly sentinels: string[] = env.adsblolDaySentinels,
  ) {}

  /**
   * Does the archive hold this UTC day at all? Answered by asking for a sentinel
   * aircraft's trace: one 200 proves the day is present.
   */
  async isDayArchived(date: Date): Promise<boolean> {
    const { y, m, d } = utcDayKey(date)
    const key = `${y}-${m}-${d}`
    const memoised = this.dayAvailability.get(key)
    if (memoised !== undefined) return memoised

    let archived = false
    for (const sentinel of this.sentinels) {
      const url = `${this.baseUrl}/globe_history/${y}/${m}/${d}/traces/${sentinel.slice(-2)}/trace_full_${sentinel}.json`
      try {
        const body = await fetchWithRetry(url, { attempts: 1, emptyStatuses: [404, 410] })
        if (body !== null && body.length > 0) {
          archived = true
          break
        }
      } catch {
        // A 5xx here just means this sentinel has no trace either; try the next one.
      }
    }

    if (!archived) {
      log.debug(`adsblol: no sentinel trace for ${key} — treating the day as not archived`)
    }
    this.dayAvailability.set(key, archived)
    return archived
  }

  private traceUrl(icao24: string, date: Date): string {
    const { y, m, d } = utcDayKey(date)
    const hex = icao24.toLowerCase()
    return `${this.baseUrl}/globe_history/${y}/${m}/${d}/traces/${hex.slice(-2)}/trace_full_${hex}.json`
  }

  private cachePath(icao24: string, date: Date): string {
    const { y, m, d } = utcDayKey(date)
    return resolve(process.cwd(), join(this.cacheDir, icao24.toLowerCase(), `${y}-${m}-${d}.json.gz`))
  }

  /**
   * Fetches one UTC day. Provider responses are cached verbatim so a re-run of the
   * pipeline uses byte-identical input to the original import.
   */
  async getDay(icao24: string, date: Date): Promise<AdsbLolDayResult> {
    const cache = this.cachePath(icao24, date)
    let body: Uint8Array

    if (existsSync(cache)) {
      body = readFileSync(cache)
    } else {
      let downloaded: Uint8Array | null = null
      try {
        // Two attempts only: the archive's 504 is an answer, not a flaky failure.
        downloaded = await fetchWithRetry(this.traceUrl(icao24, date), {
          attempts: 2,
          emptyStatuses: [404, 410],
        })
      } catch {
        downloaded = null
      }

      if (downloaded === null) {
        // The trace is absent. Whether that means "did not fly" or "day not kept"
        // depends on whether the archive holds the day at all.
        return (await this.isDayArchived(date))
          ? { date, status: 'empty', positions: [] }
          : {
              date,
              status: 'unavailable',
              positions: [],
              detail: 'day not present in the adsb.lol archive (outside retention)',
            }
      }

      mkdirSync(dirname(cache), { recursive: true })
      writeFileSync(cache, downloaded)
      body = downloaded
    }

    let file: TraceFile
    try {
      const text =
        body[0] === 0x1f && body[1] === 0x8b
          ? gunzipSync(body).toString('utf8')
          : Buffer.from(body).toString('utf8')
      file = JSON.parse(text) as TraceFile
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { date, status: 'unavailable', positions: [], detail: `unparseable trace: ${message}` }
    }

    return { date, status: 'ok', positions: decodeTrace(icao24, file, this.name) }
  }

  async getAircraftHistory(icao24: string, from: Date, to: Date): Promise<AdsbPosition[]> {
    const all: AdsbPosition[] = []
    let unavailable = 0
    let days = 0

    for (const day of eachUtcDay(from, to)) {
      days++
      const result = await this.getDay(icao24, day)
      if (result.status === 'unavailable') {
        unavailable++
        log.warn(`adsblol: ${icao24} ${day.toISOString().slice(0, 10)} unavailable (${result.detail})`)
        continue
      }
      for (const position of result.positions) {
        if (position.timestamp >= from && position.timestamp < to) all.push(position)
      }
    }

    if (days > 0 && unavailable === days) {
      throw new ProviderRangeUnavailableError(
        this.name,
        `all ${days} days unavailable (likely outside the ~${this.capabilities.historyWindowDays}-day retention window)`,
        from,
        to,
      )
    }

    all.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    return all
  }

  async probe(): Promise<ProviderHealth> {
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000)
    const { y, m, d } = utcDayKey(yesterday)
    try {
      await fetchWithRetry(`${this.baseUrl}/globe_history/${y}/${m}/${d}/traces/06/trace_full_505c06.json`, {
        attempts: 1,
        emptyStatuses: [404, 410],
      })
      return { ok: true, detail: 'history archive reachable' }
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) }
    }
  }
}

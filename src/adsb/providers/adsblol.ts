/**
 * adsb.lol history adapter.
 *
 * adsb.lol republishes readsb "globe history" traces: one gzipped JSON file per
 * aircraft per UTC day at
 *   {base}/globe_history/YYYY/MM/DD/traces/{last two hex chars}/trace_full_{icao}.json
 *
 * Measured 2026-08-21: the archive keeps roughly the last 45 days. Older dates answer
 * with 504, which is a retention limit, not "the aircraft did not fly" — the two are
 * reported differently so data coverage never silently absorbs a missing archive.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { dirname, join, resolve } from 'node:path'
import type { AdsbPosition } from '../../core/types.js'
import { env } from '../../lib/env.js'
import { fetchWithRetry } from '../../lib/http.js'
import { log } from '../../lib/log.js'
import {
  type AdsbProvider,
  type ProviderCapabilities,
  type ProviderHealth,
  ProviderRangeUnavailableError,
} from '../provider.js'

/**
 * readsb trace point layout. Index 8 carries an occasional details object; the rest
 * are positional. Kept as named constants because the format has no self-description.
 */
const IDX = {
  secondsAfterBase: 0,
  latitude: 1,
  longitude: 2,
  altitudeBaro: 3, // number in feet, or the string "ground"
  groundSpeed: 4,
  track: 5,
  flags: 6,
  verticalRateBaro: 7,
  details: 8,
  positionSource: 9,
  altitudeGeom: 10,
  verticalRateGeom: 11,
  indicatedAirspeed: 12,
  rollAngle: 13,
} as const

const FLAG_STALE = 1

type TracePoint = unknown[]
type TraceFile = {
  icao: string
  r?: string
  t?: string
  timestamp: number
  trace: TracePoint[]
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function utcDayKey(date: Date): { y: string; m: string; d: string } {
  return {
    y: String(date.getUTCFullYear()),
    m: String(date.getUTCMonth() + 1).padStart(2, '0'),
    d: String(date.getUTCDate()).padStart(2, '0'),
  }
}

function* eachUtcDay(from: Date, to: Date): Generator<Date> {
  const cursor = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  )
  while (cursor <= to) {
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
    // Measured, not advertised. Re-check with `npm run adsb:probe`.
    historyWindowDays: 45,
    live: true,
    requiresAuth: false,
  }

  constructor(
    private readonly baseUrl = env.adsblolHistoryBaseUrl,
    private readonly cacheDir = env.adsbCacheDir,
  ) {}

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
    let body: Uint8Array | null = null

    if (existsSync(cache)) {
      body = readFileSync(cache)
    } else {
      const url = this.traceUrl(icao24, date)
      try {
        body = await fetchWithRetry(url, { emptyStatuses: [404, 410] })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // 5xx from the archive means the day is outside retention or the backend is
        // unhappy. Either way we did not observe "no flights", and must say so.
        return { date, status: 'unavailable', positions: [], detail: message }
      }
      if (body === null) return { date, status: 'empty', positions: [] }
      mkdirSync(dirname(cache), { recursive: true })
      writeFileSync(cache, body)
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

    return { date, status: 'ok', positions: this.decode(icao24, file) }
  }

  private decode(icao24: string, file: TraceFile): AdsbPosition[] {
    const base = file.timestamp * 1000
    const positions: AdsbPosition[] = []
    // The callsign only appears in the occasional details object; carry it forward
    // until it changes, which is how tar1090 renders it too.
    let callsign: string | undefined

    for (const point of file.trace) {
      const offset = numberOrUndefined(point[IDX.secondsAfterBase])
      const latitude = numberOrUndefined(point[IDX.latitude])
      const longitude = numberOrUndefined(point[IDX.longitude])
      if (offset === undefined || latitude === undefined || longitude === undefined) continue

      const details = point[IDX.details]
      if (details && typeof details === 'object') {
        const flight = (details as { flight?: unknown }).flight
        if (typeof flight === 'string' && flight.trim()) callsign = flight.trim()
      }

      const rawAltitude = point[IDX.altitudeBaro]
      const onGround = rawAltitude === 'ground'
      const flags = numberOrUndefined(point[IDX.flags]) ?? 0

      positions.push({
        aircraftIcao24: icao24.toLowerCase(),
        timestamp: new Date(base + offset * 1000),
        latitude,
        longitude,
        altitudeBaro: onGround ? undefined : numberOrUndefined(rawAltitude),
        altitudeGeom: numberOrUndefined(point[IDX.altitudeGeom]),
        groundSpeed: numberOrUndefined(point[IDX.groundSpeed]),
        verticalRate:
          numberOrUndefined(point[IDX.verticalRateBaro]) ??
          numberOrUndefined(point[IDX.verticalRateGeom]),
        track: numberOrUndefined(point[IDX.track]),
        callsign,
        onGround,
        stale: (flags & FLAG_STALE) !== 0,
        source: this.name,
      })
    }

    positions.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    return positions
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

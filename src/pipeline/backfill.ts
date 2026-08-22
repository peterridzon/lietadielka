/**
 * Historical import: raw ADS-B positions for one registered aircraft over a date range.
 *
 * Unit of work is one aircraft × one UTC day, recorded in `import_job`, so a run is
 * resumable, auditable and safe to repeat. Positions are inserted with ON CONFLICT
 * DO NOTHING against the (icao24, ts, source) unique index, which makes ingest
 * idempotent — re-importing a day adds nothing.
 *
 * We import only ICAO addresses that exist in the registry. There is no bounding-box
 * import and no bulk ingest of unrelated traffic.
 */
import { randomUUID } from 'node:crypto'
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import type { AdsbPosition } from '../core/types.js'
import { getDb } from '../db/client.js'
import { importJob, rawAdsbPosition, type Aircraft } from '../db/schema.js'
import { getProvider } from '../adsb/registry.js'
import { ProviderRangeUnavailableError } from '../adsb/provider.js'
import { log } from '../lib/log.js'

const INSERT_BATCH = 1_000

export type DayOutcome = {
  day: Date
  status: 'completed' | 'empty' | 'unavailable' | 'skipped' | 'failed'
  downloaded: number
  stored: number
  detail?: string
}

export type BackfillResult = {
  aircraft: Aircraft
  provider: string
  from: Date
  to: Date
  days: DayOutcome[]
  totals: { downloaded: number; stored: number; daysWithData: number; daysUnavailable: number }
}

export function* eachUtcDay(from: Date, to: Date): Generator<Date> {
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  const last = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()))
  while (cursor <= last) {
    yield new Date(cursor)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
}

async function alreadyImported(
  icao24: string,
  provider: string,
  dayStart: Date,
  dayEnd: Date,
): Promise<boolean> {
  const { db } = await getDb()
  const rows = await db
    .select({ id: importJob.id })
    .from(importJob)
    .where(
      and(
        eq(importJob.aircraftIcao24, icao24),
        eq(importJob.provider, provider),
        eq(importJob.rangeFrom, dayStart),
        eq(importJob.rangeTo, dayEnd),
        inArray(importJob.status, ['completed', 'empty']),
      ),
    )
    .limit(1)
  return rows.length > 0
}

async function storePositions(
  positions: AdsbPosition[],
  jobId: string,
  dataStatus: string,
): Promise<number> {
  if (positions.length === 0) return 0
  const { db } = await getDb()

  for (let i = 0; i < positions.length; i += INSERT_BATCH) {
    const chunk = positions.slice(i, i + INSERT_BATCH).map((position) => ({
      aircraftIcao24: position.aircraftIcao24,
      ts: position.timestamp,
      latitude: position.latitude,
      longitude: position.longitude,
      altitudeBaro: position.altitudeBaro ?? null,
      altitudeGeom: position.altitudeGeom ?? null,
      groundSpeed: position.groundSpeed ?? null,
      verticalRate: position.verticalRate ?? null,
      track: position.track ?? null,
      callsign: position.callsign?.slice(0, 12) ?? null,
      onGround: position.onGround ?? null,
      positionAgeSeconds: position.positionAgeSeconds ?? null,
      stale: position.stale ?? null,
      source: position.source,
      dataStatus,
      importJobId: jobId,
    }))
    await db.insert(rawAdsbPosition).values(chunk).onConflictDoNothing()
  }

  // Rows that conflicted kept their original import_job_id, so counting by this job
  // gives exactly the number of genuinely new observations.
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(rawAdsbPosition)
    .where(eq(rawAdsbPosition.importJobId, jobId))
  return row?.count ?? 0
}

export async function backfillAircraft(options: {
  aircraft: Aircraft
  from: Date
  to: Date
  providerName?: string
  force?: boolean
  /** Days fetched in parallel. Provider requests are still rate limited globally. */
  concurrency?: number
}): Promise<BackfillResult> {
  const { db } = await getDb()
  const provider = getProvider(options.providerName)
  const icao24 = options.aircraft.icao24
  const days: DayOutcome[] = []

  const importOneDay = async (day: Date): Promise<DayOutcome> => {
    const dayStart = day
    const dayEnd = new Date(day.getTime() + 24 * 3600 * 1000)
    const label = dayStart.toISOString().slice(0, 10)

    if (!options.force && (await alreadyImported(icao24, provider.name, dayStart, dayEnd))) {
      return { day: dayStart, status: 'skipped', downloaded: 0, stored: 0 }
    }

    const jobId = randomUUID()
    await db.insert(importJob).values({
      id: jobId,
      provider: provider.name,
      aircraftIcao24: icao24,
      rangeFrom: dayStart,
      rangeTo: dayEnd,
      status: 'running',
      params: { registration: options.aircraft.registration, force: options.force ?? false },
    })

    try {
      const positions = await provider.getAircraftHistory(icao24, dayStart, dayEnd)
      const stored = await storePositions(positions, jobId, options.aircraft.dataStatus)
      const status = positions.length === 0 ? 'empty' : 'completed'

      await db
        .update(importJob)
        .set({
          status,
          positionsDownloaded: positions.length,
          positionsStored: stored,
          completedAt: new Date(),
        })
        .where(eq(importJob.id, jobId))

      log.info(`${icao24} ${label}: ${positions.length} positions (${stored} new)`)
      return { day: dayStart, status, downloaded: positions.length, stored }
    } catch (error) {
      const unavailable = error instanceof ProviderRangeUnavailableError
      const detail = error instanceof Error ? error.message : String(error)
      await db
        .update(importJob)
        .set({ status: unavailable ? 'unavailable' : 'failed', error: detail, completedAt: new Date() })
        .where(eq(importJob.id, jobId))
      log.warn(`${icao24} ${label}: ${unavailable ? 'unavailable' : 'failed'} — ${detail}`)
      return {
        day: dayStart,
        status: unavailable ? 'unavailable' : 'failed',
        downloaded: 0,
        stored: 0,
        detail,
      }
    }
  }

  // Days are independent units of work, so they overlap. The provider's rate limiter
  // still spaces the actual HTTP requests, this only hides the archive's latency.
  const queue = [...eachUtcDay(options.from, options.to)]
  const workers = Math.max(1, Math.min(options.concurrency ?? 4, 8))
  const results = new Array<DayOutcome>(queue.length)
  let cursor = 0

  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (true) {
        const index = cursor++
        const day = queue[index]
        if (!day) return
        results[index] = await importOneDay(day)
      }
    }),
  )
  days.push(...results.filter((outcome): outcome is DayOutcome => outcome !== undefined))

  return {
    aircraft: options.aircraft,
    provider: provider.name,
    from: options.from,
    to: options.to,
    days,
    totals: {
      downloaded: days.reduce((sum, d) => sum + d.downloaded, 0),
      stored: days.reduce((sum, d) => sum + d.stored, 0),
      daysWithData: days.filter((d) => d.status === 'completed').length,
      daysUnavailable: days.filter((d) => d.status === 'unavailable' || d.status === 'failed').length,
    },
  }
}

export async function countPositions(icao24: string, from?: Date, to?: Date): Promise<number> {
  const { db } = await getDb()
  const filters = [eq(rawAdsbPosition.aircraftIcao24, icao24)]
  if (from) filters.push(gte(rawAdsbPosition.ts, from))
  if (to) filters.push(lt(rawAdsbPosition.ts, to))
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(rawAdsbPosition)
    .where(and(...filters))
  return row?.count ?? 0
}

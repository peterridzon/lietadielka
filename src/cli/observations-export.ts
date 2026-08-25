/**
 * npm run obs:export
 *
 * Writes raw observations out to data/observations/<icao24>/<YYYY-MM-DD>.ndjson.gz,
 * one file per aircraft per UTC day, so they can live in version control.
 *
 * This is what makes unattended collection possible: a CI runner starts empty every
 * time, and these files — not the database — are the thing that persists. It also does
 * something the project wants anyway. The observations become public, diffable and
 * independently checkable, which is a stronger transparency claim than any dashboard.
 *
 * Files already on disk are left alone unless --force. Raw data is append-only.
 *
 * Positions alone are not enough. A day on which an aircraft was checked and simply did
 * not fly leaves no position file, so a database rebuilt from these files would show that
 * day as never examined — the exact confusion between a quiet day and a missing one that
 * the whole coverage methodology exists to prevent. Worse, the backfill would re-download
 * it, and a 237-day history that re-reads its own work never finishes.
 *
 * So the outcome of every day is written too, to data/observations/<icao24>/days.csv:
 * one line per UTC day, sorted, plain text, so it diffs as a ledger rather than a blob.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { asc, eq, sql } from 'drizzle-orm'
import { closeDb, getDb } from '../db/client.js'
import { importJob, rawAdsbPosition } from '../db/schema.js'
import { flag, parseArgs, runCli } from '../lib/cli.js'

const ROOT = 'data/observations'

/** Compact per-position record. Field order is fixed so diffs stay readable. */
type Row = {
  t: string
  lat: number
  lon: number
  alt?: number
  altg?: number
  gs?: number
  vr?: number
  trk?: number
  cs?: string
  og?: boolean
  st?: boolean
  src: string
}

async function main(): Promise<void> {
  const args = parseArgs()
  const force = flag(args, 'force')
  const { db } = await getDb()

  const days = await db
    .select({
      icao: rawAdsbPosition.aircraftIcao24,
      day: sql<string>`to_char(${rawAdsbPosition.ts} at time zone 'UTC', 'YYYY-MM-DD')`,
      n: sql<number>`count(*)::int`,
    })
    .from(rawAdsbPosition)
    .groupBy(rawAdsbPosition.aircraftIcao24, sql`2`)
    .orderBy(sql`1`, sql`2`)

  let written = 0
  let skipped = 0
  let positions = 0

  for (const { icao, day } of days) {
    const path = resolve(process.cwd(), `${ROOT}/${icao}/${day}.ndjson.gz`)
    if (!force && existsSync(path)) {
      skipped++
      continue
    }

    const rows = await db
      .select()
      .from(rawAdsbPosition)
      .where(
        sql`${rawAdsbPosition.aircraftIcao24} = ${icao}
            and to_char(${rawAdsbPosition.ts} at time zone 'UTC', 'YYYY-MM-DD') = ${day}`,
      )
      .orderBy(asc(rawAdsbPosition.ts))

    const lines = rows.map((r) => {
      const row: Row = {
        t: r.ts.toISOString(),
        lat: r.latitude,
        lon: r.longitude,
        src: r.source,
      }
      if (r.altitudeBaro !== null) row.alt = r.altitudeBaro
      if (r.altitudeGeom !== null) row.altg = r.altitudeGeom
      if (r.groundSpeed !== null) row.gs = r.groundSpeed
      if (r.verticalRate !== null) row.vr = r.verticalRate
      if (r.track !== null) row.trk = r.track
      if (r.callsign !== null) row.cs = r.callsign
      if (r.onGround !== null) row.og = r.onGround
      if (r.stale !== null) row.st = r.stale
      return JSON.stringify(row)
    })

    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, gzipSync(lines.join('\n') + '\n', { level: 9 }))
    written++
    positions += rows.length
  }

  // The ledger of what was examined, which positions cannot express.
  const jobs = await db
    .select({
      icao: importJob.aircraftIcao24,
      day: sql<string>`to_char(${importJob.rangeFrom} at time zone 'UTC', 'YYYY-MM-DD')`,
      status: importJob.status,
      provider: importJob.provider,
      positions: importJob.positionsStored,
    })
    .from(importJob)
    .where(sql`${importJob.status} in ('completed', 'empty', 'unavailable')`)
    .orderBy(asc(importJob.aircraftIcao24), asc(importJob.rangeFrom))

  const byAircraft = new Map<string, Map<string, string>>()
  for (const job of jobs) {
    const rows = byAircraft.get(job.icao) ?? new Map<string, string>()
    // A day polled more than once keeps its best-evidenced answer, the same precedence
    // the provider uses: seeing something beats seeing nothing beats not looking.
    const rank: Record<string, number> = { unavailable: 0, empty: 1, completed: 2 }
    const line = `${job.day},${job.status},${job.provider},${job.positions ?? 0}`
    const existing = rows.get(job.day)
    if (!existing || (rank[job.status] ?? 0) >= (rank[existing.split(',')[1] ?? ''] ?? 0)) {
      rows.set(job.day, line)
    }
    byAircraft.set(job.icao, rows)
  }

  let ledgers = 0
  for (const [icao, rows] of byAircraft) {
    const path = resolve(process.cwd(), `${ROOT}/${icao}/days.csv`)
    const body =
      'day,status,provider,positions\n' +
      [...rows.keys()].sort().map((day) => rows.get(day)).join('\n') +
      '\n'
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, body)
    ledgers++
  }

  console.log(
    `observations: ${written} day files written (${positions.toLocaleString('en-GB')} positions), ` +
      `${skipped} already present, ${ledgers} ledgers (${jobs.length} day outcomes)`,
  )
  await closeDb()
}

runCli(main)

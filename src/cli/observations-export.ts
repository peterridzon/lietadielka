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
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { asc, sql } from 'drizzle-orm'
import { closeDb, getDb } from '../db/client.js'
import { rawAdsbPosition } from '../db/schema.js'
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

  console.log(
    `observations: ${written} day files written (${positions.toLocaleString('en-GB')} positions), ` +
      `${skipped} already present`,
  )
  await closeDb()
}

runCli(main)

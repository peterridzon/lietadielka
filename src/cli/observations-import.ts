/**
 * npm run obs:import
 *
 * Loads data/observations/** back into the database. This is how a clean checkout —
 * or a CI runner that started with nothing — gets its history back before collecting
 * the next day.
 *
 * Idempotent: positions carry a unique key of (icao24, ts, source), so re-importing
 * changes nothing.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { getDb, closeDb } from '../db/client.js'
import { rawAdsbPosition } from '../db/schema.js'
import { parseArgs, runCli, optionalString } from '../lib/cli.js'
import { log } from '../lib/log.js'

const ROOT = 'data/observations'
const BATCH = 2_000

async function main(): Promise<void> {
  const args = parseArgs()
  const only = optionalString(args, 'aircraft')?.toLowerCase()
  const root = resolve(process.cwd(), ROOT)

  if (!existsSync(root)) {
    console.log(`${ROOT} does not exist — nothing to import`)
    await closeDb()
    return
  }

  const { db } = await getDb()
  let files = 0
  let positions = 0

  for (const icao of readdirSync(root).sort()) {
    if (only && icao !== only) continue
    const dir = join(root, icao)
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith('.ndjson.gz')) continue
      const text = gunzipSync(readFileSync(join(dir, name))).toString('utf8')
      const rows = text
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const r = JSON.parse(line) as Record<string, unknown>
          return {
            aircraftIcao24: icao,
            ts: new Date(r.t as string),
            latitude: r.lat as number,
            longitude: r.lon as number,
            altitudeBaro: (r.alt as number) ?? null,
            altitudeGeom: (r.altg as number) ?? null,
            groundSpeed: (r.gs as number) ?? null,
            verticalRate: (r.vr as number) ?? null,
            track: (r.trk as number) ?? null,
            callsign: (r.cs as string) ?? null,
            onGround: (r.og as boolean) ?? null,
            stale: (r.st as boolean) ?? null,
            source: r.src as string,
            dataStatus: 'real',
          }
        })

      for (let i = 0; i < rows.length; i += BATCH) {
        await db.insert(rawAdsbPosition).values(rows.slice(i, i + BATCH)).onConflictDoNothing()
      }
      files++
      positions += rows.length
    }
  }

  log.info(`observations: ${files} files, ${positions.toLocaleString('en-GB')} positions imported`)
  console.log(`imported ${positions.toLocaleString('en-GB')} positions from ${files} day files`)
  await closeDb()
}

runCli(main)

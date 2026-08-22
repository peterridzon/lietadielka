/**
 * npm run imports:list -- [--aircraft 505C06] [--status unavailable] [--limit 50]
 *
 * The CLI form of the /admin/imports page from the brief. Its main job is to make the
 * difference between "no flights" and "no data" visible, because a day the archive
 * could not serve must never be read as a day the aircraft stayed on the ground.
 */
import { and, desc, eq, sql } from 'drizzle-orm'
import { closeDb, getDb } from '../db/client.js'
import { findAircraft } from '../db/repositories/aircraft.js'
import { importJob } from '../db/schema.js'
import { optionalString, parseArgs, runCli } from '../lib/cli.js'

async function main(): Promise<void> {
  const args = parseArgs()
  const { db } = await getDb()

  const filters = []
  const identifier = optionalString(args, 'aircraft')
  if (identifier) {
    const target = await findAircraft(identifier)
    if (!target) throw new Error(`Aircraft "${identifier}" is not in the registry`)
    filters.push(eq(importJob.aircraftIcao24, target.icao24))
  }
  const status = optionalString(args, 'status')
  if (status) filters.push(eq(importJob.status, status))

  const where = filters.length > 0 ? and(...filters) : undefined

  const summary = await db
    .select({
      provider: importJob.provider,
      aircraft: importJob.aircraftIcao24,
      status: importJob.status,
      days: sql<number>`count(*)::int`,
      positions: sql<number>`coalesce(sum(${importJob.positionsStored}),0)::int`,
    })
    .from(importJob)
    .where(where)
    .groupBy(importJob.provider, importJob.aircraftIcao24, importJob.status)
    .orderBy(importJob.aircraftIcao24, importJob.status)

  if (summary.length === 0) {
    console.log('no import jobs recorded')
    await closeDb()
    return
  }

  console.log('\nprovider  aircraft  status        days  positions')
  for (const row of summary) {
    console.log(
      `${row.provider.padEnd(9)} ${row.aircraft.padEnd(9)} ${row.status.padEnd(13)} ` +
        `${String(row.days).padStart(4)}  ${String(row.positions).padStart(9)}`,
    )
  }

  const failures = await db
    .select({
      aircraft: importJob.aircraftIcao24,
      rangeFrom: importJob.rangeFrom,
      status: importJob.status,
      error: importJob.error,
    })
    .from(importJob)
    .where(where)
    .orderBy(desc(importJob.rangeFrom))
    .limit(Number(optionalString(args, 'limit') ?? 200))

  const problems = failures.filter((row) => row.status === 'unavailable' || row.status === 'failed')
  if (problems.length > 0) {
    console.log(`\n${problems.length} day(s) with no usable answer from the provider:`)
    for (const row of problems.slice(0, 20)) {
      console.log(
        `  ${row.rangeFrom.toISOString().slice(0, 10)}  ${row.aircraft}  ${row.status}  ${row.error ?? ''}`,
      )
    }
    if (problems.length > 20) console.log(`  ... and ${problems.length - 20} more`)
    console.log(
      '\n  These days are absent from the dataset. They are NOT zero-flight days, and any\n' +
        '  statistic covering them has to say so — see brief §25 and METHODOLOGY.md.',
    )
  }

  await closeDb()
}

runCli(main)

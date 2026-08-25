/**
 * npm run archive:backfill -- --from 2026-01-01 [--to 2026-07-01] [--days 12]
 *
 * Fills history from the adsb.lol daily release archive, which unlike the live endpoint
 * is not pruned.
 *
 * A day costs 2.5–4 GB of streaming and there is no way to make it cheaper: the archive
 * stores entries unsorted, so an aircraft cannot be seeked to. Measured end to end on
 * 2026-08-22: 3.60 GB, 73 180 entries — the same trace the live endpoint serves, 796
 * positions, identical. A day takes 72–85 seconds on a CI runner and roughly seven times
 * that on a home connection, which is the link speed talking, not the archive.
 * That shapes the whole design. --days bounds one run so it fits inside a CI job, the
 * oldest missing day is always taken first, and each finished day is committed, so an
 * interrupted backfill loses at most the day it was working on.
 *
 * Options:
 *   --from   YYYY-MM-DD, earliest day to reach (required)
 *   --to     YYYY-MM-DD, latest day to fill (default: yesterday UTC)
 *   --days   how many days to process in this run (default 40)
 *   --newest work forwards from the newest missing day instead of the oldest
 *   --force  re-import days that were already imported
 */
import { getDb } from '../db/client.js'
import { listTrackedAircraft } from '../db/repositories/aircraft.js'
import { shouldPoll } from '../core/fleet.js'
import { setArchiveExtractSet } from '../adsb/providers/archive.js'
import { backfillAircraft } from '../pipeline/backfill.js'
import { flag, optionalString, parseArgs, parseUtcDate, requireString, runCli } from '../lib/cli.js'
import { importJob } from '../db/schema.js'
import { and, eq, inArray } from 'drizzle-orm'

const PROVIDER = 'archive'

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function* eachDay(from: Date, to: Date): Generator<string> {
  const cursor = new Date(from)
  while (cursor <= to) {
    yield dayKey(cursor)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
}

/**
 * A day counts as done only when every tracked aircraft has a settled import job for it.
 * Counting the day as done because one aircraft succeeded would silently leave the rest
 * of the fleet unexamined for that date, which is exactly the kind of hole the coverage
 * grid exists to make visible.
 */
async function settledDays(icaos: string[]): Promise<Map<string, number>> {
  const { db } = await getDb()
  const rows = await db
    .select({ from: importJob.rangeFrom, icao: importJob.aircraftIcao24 })
    .from(importJob)
    .where(
      and(
        eq(importJob.provider, PROVIDER),
        inArray(importJob.status, ['completed', 'empty']),
        inArray(importJob.aircraftIcao24, icaos),
      ),
    )

  const counts = new Map<string, Set<string>>()
  for (const row of rows) {
    const key = dayKey(row.from)
    const set = counts.get(key) ?? new Set<string>()
    set.add(row.icao)
    counts.set(key, set)
  }
  return new Map([...counts].map(([day, set]) => [day, set.size]))
}

async function main(): Promise<void> {
  const args = parseArgs()
  const from = parseUtcDate(requireString(args, 'from'))

  const toArg = optionalString(args, 'to')
  const to = toArg
    ? parseUtcDate(toArg)
    : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() - 1))
  if (to < from) throw new Error('--to must not be before --from')

  const budget = Number(optionalString(args, 'days') ?? 40)
  if (!Number.isFinite(budget) || budget < 1) throw new Error('--days must be a positive number')

  // The fleet of the day being filled, not the fleet of today. OM-BYC flew until February
  // 2025 and is retired now; selecting by today's fleet would have left its flights out of
  // the record with nothing to show they were ever expected — and a missing aircraft leaves
  // no trace on the coverage calendar, which makes it worse than a wrong number.
  const fleet = await listTrackedAircraft(to)
  const everTracked = await listTrackedAircraft(from)
  for (const ac of everTracked) {
    if (!fleet.some((x) => x.icao24 === ac.icao24)) fleet.push(ac)
  }
  if (fleet.length === 0) throw new Error('no aircraft are currently tracked — run "npm run seed"')

  const icaos = fleet.map((a) => a.icao24.toLowerCase())
  // Every airframe extracted while a day streams is free; the bytes pass either way.
  setArchiveExtractSet(icaos)

  const activeOn = (day: string): number =>
    fleet.filter((a) => shouldPoll(a, new Date(`${day}T12:00:00.000Z`))).length

  const done = await settledDays(icaos)
  // A day counts as filled when every aircraft that existed THAT DAY has an answer.
  // Comparing against the whole fleet would leave 2025 permanently unfinished, because
  // the Global 5000s did not exist before December 2024 and never will.
  const missing = [...eachDay(from, to)].filter((day) => (done.get(day) ?? 0) < activeOn(day))

  if (missing.length === 0) {
    console.log(`Nothing to do: ${dayKey(from)}..${dayKey(to)} is complete for all ${fleet.length} aircraft.`)
    return
  }

  const order = flag(args, 'newest') ? missing.reverse() : missing
  const batch = order.slice(0, budget)

  console.log(
    `Archive backfill · ${dayKey(from)}..${dayKey(to)}\n` +
      `  ${missing.length} ${missing.length === 1 ? 'day' : 'days'} still missing, ` +
      `taking ${batch.length} this run (${batch[0]}..${batch[batch.length - 1]})\n` +
      `  fleet: ${fleet.map((a) => a.registration).join(', ')}\n`,
  )

  let filled = 0
  let unavailable = 0

  for (const day of batch) {
    const start = new Date(`${day}T00:00:00.000Z`)
    const end = new Date(start)
    end.setUTCDate(end.getUTCDate() + 1)

    let dayPositions = 0
    let dayFailed = 0

    for (const aircraft of fleet) {
      // Asking the archive for an aircraft that did not yet belong to Slovakia would file
      // a foreign owner's flights as state flights.
      if (!shouldPoll(aircraft, start)) continue
      try {
        const result = await backfillAircraft({
          aircraft,
          from: start,
          to: end,
          providerName: PROVIDER,
          force: flag(args, 'force'),
        })
        dayPositions += result.days.reduce((sum, d) => sum + d.stored, 0)
      } catch (error) {
        dayFailed++
        const message = error instanceof Error ? error.message : String(error)
        console.log(`  ${day} ${aircraft.registration}: ${message}`)
      }
    }

    if (dayFailed > 0 && dayFailed === activeOn(day)) {
      unavailable++
      console.log(`  ${day}  unavailable`)
    } else {
      filled++
      console.log(`  ${day}  ${dayPositions} positions`)
    }
  }

  const left = missing.length - batch.length
  console.log(
    `\n${filled} ${filled === 1 ? 'day' : 'days'} filled, ${unavailable} unavailable, ` +
      `${left} still to go.`,
  )
  if (left > 0) console.log('Run again to continue — progress is stored, nothing is repeated.')
}

runCli(main)

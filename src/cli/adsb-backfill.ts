/**
 * npm run adsb:backfill -- --aircraft 505C06 --from 2026-07-08 --to 2026-08-21
 *
 * Options:
 *   --aircraft   ICAO24 hex or registration; must exist in the registry
 *   --all        every aircraft with tracking_enabled
 *   --from/--to  YYYY-MM-DD (UTC, inclusive)
 *   --provider   adsblol | opensky   (default: ADSB_PROVIDER)
 *   --force      re-import days that were already imported
 *   --concurrency  days fetched in parallel (default 4, max 8)
 */
import { closeDb } from '../db/client.js'
import { listTrackedAircraft, requireAircraft } from '../db/repositories/aircraft.js'
import { backfillAircraft, countPositions } from '../pipeline/backfill.js'
import { flag, optionalString, parseArgs, parseUtcDate, requireString, runCli } from '../lib/cli.js'

async function main(): Promise<void> {
  const args = parseArgs()
  const from = parseUtcDate(requireString(args, 'from'))
  const to = parseUtcDate(requireString(args, 'to'), true)
  if (to < from) throw new Error('--to must not be before --from')

  const fleet = flag(args, 'all')
    ? await listTrackedAircraft()
    : [await requireAircraft(requireString(args, 'aircraft'))]

  if (fleet.length === 0) throw new Error('no aircraft with tracking_enabled — run "npm run seed" first')

  for (const target of fleet) {
    if (!target.trackingEnabled && !flag(args, 'force')) {
      console.log(`${target.registration}: tracking_enabled is false, skipping (use --force to override)`)
      continue
    }

    console.log(
      `\n${target.registration ?? target.icao24} (${target.icao24}) ` +
        `${from.toISOString().slice(0, 10)} .. ${to.toISOString().slice(0, 10)}`,
    )
    const result = await backfillAircraft({
      aircraft: target,
      from,
      to,
      providerName: optionalString(args, 'provider'),
      force: flag(args, 'force'),
      concurrency: Number(optionalString(args, 'concurrency') ?? 4),
    })

    const skipped = result.days.filter((d) => d.status === 'skipped').length
    const empty = result.days.filter((d) => d.status === 'empty').length
    console.log(
      `  provider           ${result.provider}\n` +
        `  days examined      ${result.days.length}` +
        ` (${result.totals.daysWithData} with data, ${empty} empty, ` +
        `${result.totals.daysUnavailable} unavailable, ${skipped} skipped)\n` +
        `  positions returned ${result.totals.downloaded}\n` +
        `  positions stored   ${result.totals.stored} (new rows; duplicates are ignored)\n` +
        `  positions in db    ${await countPositions(target.icao24)}`,
    )

    if (result.totals.daysUnavailable > 0) {
      console.log(
        `  note: ${result.totals.daysUnavailable} day(s) could not be retrieved. ` +
          `Unavailable is NOT the same as "no flights" — those days are excluded from ` +
          `coverage rather than counted as zero.`,
      )
    }
  }

  await closeDb()
}

runCli(main)

/**
 * npm run flights:rebuild -- --aircraft 505C06
 *
 * Options:
 *   --aircraft   ICAO24 hex or registration
 *   --all        every aircraft with tracking_enabled
 *   --from/--to  optional YYYY-MM-DD window (UTC)
 */
import { closeDb } from '../db/client.js'
import { listAllAircraft, requireAircraft } from '../db/repositories/aircraft.js'
import { getAirportIndex } from '../db/repositories/airports.js'
import { rebuildFlightsForAircraft } from '../pipeline/rebuild-flights.js'
import { flag, optionalString, parseArgs, parseUtcDate, requireString, runCli } from '../lib/cli.js'

async function main(): Promise<void> {
  const args = parseArgs()
  const fromArg = optionalString(args, 'from')
  const toArg = optionalString(args, 'to')

  // --all covers withdrawn aircraft too: their historical flights are still derived data
  // and still need rebuilding when the detector improves.
  const fleet = flag(args, 'all')
    ? await listAllAircraft()
    : [await requireAircraft(requireString(args, 'aircraft'))]

  const index = await getAirportIndex()
  console.log(`airport index: ${index.size} aerodromes`)

  for (const target of fleet) {
    const result = await rebuildFlightsForAircraft({
      aircraft: target,
      from: fromArg ? parseUtcDate(fromArg) : undefined,
      to: toArg ? parseUtcDate(toArg, true) : undefined,
      airportIndex: index,
    })

    const withUnknownAirport = result.flights.filter(
      (f) => !f.departureMatch.airport || !f.arrivalMatch.airport,
    ).length
    console.log(
      `\n${target.registration ?? target.icao24}\n` +
        `  positions read     ${result.positionsRead}\n` +
        `  flights detected   ${result.flights.length}\n` +
        `  unresolved airport ${withUnknownAirport}`,
    )
  }

  await closeDb()
}

runCli(main)

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

  const failures: string[] = []

  for (const target of fleet) {
    try {
      await rebuildOne(target)
    } catch (error) {
      // One aircraft failing must not leave the other thirteen unrebuilt and the database
      // in a half-written state that looks like a fleet which stopped flying.
      const message = error instanceof Error ? error.message : String(error)
      failures.push(`${target.registration ?? target.icao24}: ${message.split('\n')[0]}`)
      console.log(`\n${target.registration ?? target.icao24}: FAILED — ${message.split('\n')[0]}`)
    }
  }

  if (failures.length > 0) {
    console.log(`\n${failures.length} aircraft failed to rebuild:`)
    for (const f of failures) console.log(`  ${f}`)
    await closeDb()
    process.exit(1)
  }

  await closeDb()
}

async function rebuildOne(target: Awaited<ReturnType<typeof requireAircraft>>): Promise<void> {
  {
    const args = parseArgs()
    const fromArg = optionalString(args, 'from')
    const toArg = optionalString(args, 'to')
    const index = await getAirportIndex()
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
}

runCli(main)

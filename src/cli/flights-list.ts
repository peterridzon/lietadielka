/**
 * npm run flights:list -- --aircraft 505C06
 *
 * The Phase 7 debug view: what the pipeline actually reconstructed, with the data
 * quality attached to every line. Shows everything in the database by default;
 * pass --public to apply the publication delay exactly as the public site will.
 */
import { and, asc, eq, isNotNull, lte, sql } from 'drizzle-orm'
import { closeDb, getDb } from '../db/client.js'
import { findAircraft } from '../db/repositories/aircraft.js'
import { aircraft, airport, flight } from '../db/schema.js'
import { env } from '../lib/env.js'
import { flag, optionalString, parseArgs, runCli } from '../lib/cli.js'

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '  --  '
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function formatAirport(code: string | null, city: string | null, certain: boolean): string {
  if (!code) return 'UNKNOWN'
  const label = city ? `${code} ${city}` : code
  return certain ? label : `${label}?`
}

async function main(): Promise<void> {
  const args = parseArgs()
  const identifier = optionalString(args, 'aircraft')
  const limit = Number(optionalString(args, 'limit') ?? 200)
  const publicOnly = flag(args, 'public')

  const { db } = await getDb()
  const filters = []

  if (identifier) {
    const target = await findAircraft(identifier)
    if (!target) throw new Error(`Aircraft "${identifier}" is not in the registry`)
    filters.push(eq(flight.aircraftId, target.id))
  }
  if (publicOnly) {
    filters.push(isNotNull(flight.publishedAt))
    filters.push(lte(flight.publishedAt, new Date()))
  }

  const rows = await db
    .select({
      publicId: flight.publicId,
      registration: aircraft.registration,
      departureTime: flight.departureTime,
      arrivalTime: flight.arrivalTime,
      departureTimeEstimated: flight.departureTimeEstimated,
      arrivalTimeEstimated: flight.arrivalTimeEstimated,
      departureAirportId: flight.departureAirportId,
      arrivalAirportId: flight.arrivalAirportId,
      probableDepartureAirportId: flight.probableDepartureAirportId,
      probableArrivalAirportId: flight.probableArrivalAirportId,
      durationSeconds: flight.durationSeconds,
      distanceKm: flight.distanceKm,
      distanceFromGapsKm: flight.distanceFromGapsKm,
      dataCoverage: flight.dataCoverage,
      confidence: flight.confidence,
      routeConfidence: flight.routeConfidence,
      departureAirportConfidence: flight.departureAirportConfidence,
      arrivalAirportConfidence: flight.arrivalAirportConfidence,
      positionCount: flight.positionCount,
      maxGapSeconds: flight.maxGapSeconds,
      callsign: flight.callsign,
      publishedAt: flight.publishedAt,
    })
    .from(flight)
    .innerJoin(aircraft, eq(aircraft.id, flight.aircraftId))
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(asc(flight.departureTime))
    .limit(limit)

  const airportRows = await db
    .select({ id: airport.id, ident: airport.ident, iata: airport.iata, city: airport.city })
    .from(airport)
  const byId = new Map(airportRows.map((row) => [row.id, row]))
  const code = (id: string | null): { code: string | null; city: string | null } => {
    if (!id) return { code: null, city: null }
    const found = byId.get(id)
    return { code: found?.iata || found?.ident || id, city: found?.city ?? null }
  }

  if (rows.length === 0) {
    console.log('no flights in the database for that selection')
    await closeDb()
    return
  }

  console.log(
    publicOnly
      ? `\nPUBLIC VIEW — publication delay ${env.publicationDelayHours} h applied\n`
      : `\nINTERNAL VIEW — all detected flights, publication delay NOT applied\n`,
  )

  for (const row of rows) {
    const departure = code(row.departureAirportId ?? row.probableDepartureAirportId)
    const arrival = code(row.arrivalAirportId ?? row.probableArrivalAirportId)
    const date = row.departureTime.toISOString().slice(0, 10)
    const outTime = row.departureTime.toISOString().slice(11, 16)
    const inTime = row.arrivalTime?.toISOString().slice(11, 16) ?? '--:--'

    console.log(
      `${date}  ${row.registration ?? ''}  ${(row.callsign ?? '').padEnd(8)}\n` +
        `  ${formatAirport(departure.code, departure.city, row.departureAirportId !== null)} ` +
        `${outTime}${row.departureTimeEstimated ? '~' : ' '}` +
        ` ->  ${formatAirport(arrival.code, arrival.city, row.arrivalAirportId !== null)} ` +
        `${inTime}${row.arrivalTimeEstimated ? '~' : ' '}\n` +
        `  ${formatDuration(row.durationSeconds)}  ` +
        `${Math.round(row.distanceKm ?? 0).toLocaleString('en-GB')} km` +
        ((row.distanceFromGapsKm ?? 0) > 1
          ? ` (${Math.round(row.distanceFromGapsKm ?? 0)} km bridged across gaps)`
          : '') +
        `\n  coverage ${((row.dataCoverage ?? 0) * 100).toFixed(0)} %  ` +
        `points ${row.positionCount}  max gap ${row.maxGapSeconds ?? 0}s  ` +
        `confidence ${(row.confidence ?? 'low').toUpperCase()}` +
        `\n  route ${(row.routeConfidence ?? 0).toFixed(2)}  ` +
        `dep airport ${(row.departureAirportConfidence ?? 0).toFixed(2)}  ` +
        `arr airport ${(row.arrivalAirportConfidence ?? 0).toFixed(2)}` +
        `\n  ${row.publicId}\n`,
    )
  }

  const [summary] = await db
    .select({
      flights: sql<number>`count(*)::int`,
      hours: sql<number>`coalesce(sum(${flight.durationSeconds}),0)::float / 3600`,
      distance: sql<number>`coalesce(sum(${flight.distanceKm}),0)::float`,
    })
    .from(flight)
    .where(filters.length > 0 ? and(...filters) : undefined)

  console.log(
    `${rows.length} shown | total ${summary?.flights ?? 0} flights, ` +
      `${(summary?.hours ?? 0).toFixed(1)} h, ${Math.round(summary?.distance ?? 0).toLocaleString('en-GB')} km`,
  )

  await closeDb()
}

runCli(main)

/**
 * Rebuilds flights for one aircraft from stored raw positions.
 *
 * Raw observations are never touched. Derived flights are deleted and recreated, so
 * improving the detector is a matter of bumping DETECTOR_VERSION and re-running this
 * — which is the entire reason the raw layer exists.
 */
import { and, asc, eq, gte, lt, type SQL } from 'drizzle-orm'
import { matchAirport, type AirportMatch } from '../core/airports/match.js'
import type { AirportIndex } from '../core/airports/spatial-index.js'
import {
  detectFlights,
  DETECTOR_VERSION,
  confidenceLabel,
  type DetectedFlight,
} from '../core/flight-detection/index.js'
import { simplifyPath } from '../core/geo.js'
import { publishableAt } from '../core/publication.js'
import type { AdsbPosition } from '../core/types.js'
import { getDb } from '../db/client.js'
import { getAirportIndex } from '../db/repositories/airports.js'
import {
  flight,
  flightPassengers,
  flightPurpose,
  flightTrack,
  rawAdsbPosition,
  route,
  type Aircraft,
} from '../db/schema.js'
import { env } from '../lib/env.js'
import { log } from '../lib/log.js'

/** Track simplification tolerance. 0.5 km keeps the shape of an airway turn. */
const TRACK_SIMPLIFY_TOLERANCE_KM = 0.5

export type RebuiltFlight = {
  id: string
  publicId: string
  detected: DetectedFlight
  departureMatch: AirportMatch
  arrivalMatch: AirportMatch
  overallConfidence: number
}

export type RebuildResult = {
  aircraft: Aircraft
  positionsRead: number
  flights: RebuiltFlight[]
}

async function loadPositions(icao24: string, from?: Date, to?: Date): Promise<AdsbPosition[]> {
  const { db } = await getDb()
  const filters = [eq(rawAdsbPosition.aircraftIcao24, icao24)]
  if (from) filters.push(gte(rawAdsbPosition.ts, from))
  if (to) filters.push(lt(rawAdsbPosition.ts, to))

  const rows = await db
    .select()
    .from(rawAdsbPosition)
    .where(and(...filters))
    .orderBy(asc(rawAdsbPosition.ts))

  return rows.map((row) => ({
    aircraftIcao24: row.aircraftIcao24,
    timestamp: row.ts,
    latitude: row.latitude,
    longitude: row.longitude,
    altitudeBaro: row.altitudeBaro ?? undefined,
    altitudeGeom: row.altitudeGeom ?? undefined,
    groundSpeed: row.groundSpeed ?? undefined,
    verticalRate: row.verticalRate ?? undefined,
    track: row.track ?? undefined,
    callsign: row.callsign ?? undefined,
    onGround: row.onGround ?? undefined,
    positionAgeSeconds: row.positionAgeSeconds ?? undefined,
    stale: row.stale ?? undefined,
    source: row.source,
  }))
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * URL slug for a flight. The departure time is part of it, not decoration.
 *
 * Date plus aircraft plus route is not unique: an aircraft making two flights in a day
 * with neither end identified produces the same slug twice, which a helicopter does
 * routinely. Including the time keeps it unique without depending on what other flights
 * happen to exist, so a permalink stays put across rebuilds.
 */
function publicIdFor(target: Aircraft, detected: DetectedFlight, departure: string, arrival: string): string {
  const iso = detected.departureTime.toISOString()
  const date = iso.slice(0, 10)
  const time = iso.slice(11, 16).replace(':', '')
  const registration = slug(target.registration ?? target.icao24)
  return `${date}-${time}-${registration}-${slug(departure)}-${slug(arrival)}`
}

/**
 * Slug component for the URL. Only an accepted airport contributes its code — a
 * "probable" match must not end up in a permalink that reads like a statement of fact.
 */
function airportCode(match: AirportMatch): string {
  return match.airport?.ident ?? 'unknown'
}

async function upsertRoute(
  originId: string | null,
  destinationId: string | null,
): Promise<string | null> {
  if (!originId || !destinationId) return null
  const { db } = await getDb()
  const id = `${originId}-${destinationId}`
  const cityPairKey = [originId, destinationId].sort().join('|')
  await db
    .insert(route)
    .values({ id, originAirportId: originId, destinationAirportId: destinationId, cityPairKey })
    .onConflictDoNothing()
  return id
}

export async function rebuildFlightsForAircraft(options: {
  aircraft: Aircraft
  from?: Date
  to?: Date
  airportIndex?: AirportIndex
}): Promise<RebuildResult> {
  const { db } = await getDb()
  const index = options.airportIndex ?? (await getAirportIndex())
  const target = options.aircraft

  const positions = await loadPositions(target.icao24, options.from, options.to)
  const detected = detectFlights(positions, {
    config: {
      gapSoftSeconds: env.detect.gapSoftSeconds,
      gapHardSeconds: env.detect.gapHardSeconds,
      minGroundSeconds: env.detect.minGroundSeconds,
      minFlightSeconds: env.detect.minFlightSeconds,
    },
    elevationAt: (latitude, longitude) => index.elevationAt(latitude, longitude),
  })

  // Hand-entered enrichment is not derived data and must survive a rebuild. It hangs off
  // the flight row by a surrogate id, so it has to be lifted out before the delete and
  // re-attached afterwards by the natural key — aircraft plus departure time.
  const carried = await liftManualEnrichment(target.id, options.from, options.to)

  // Derived data only — raw positions are untouched. When a window was given, only
  // flights departing inside it are replaced; wiping the aircraft's whole history to
  // rebuild one week would quietly destroy everything outside the window.
  const deleteFilters: SQL[] = [eq(flight.aircraftId, target.id)]
  if (options.from) deleteFilters.push(gte(flight.departureTime, options.from))
  if (options.to) deleteFilters.push(lt(flight.departureTime, options.to))
  await db.delete(flight).where(and(...deleteFilters))

  const results: RebuiltFlight[] = []

  for (const item of detected) {
    const matchOptions = {
      groundRadiusKm: env.airportMatch.searchRadiusKm,
      minConfidence: env.airportMatch.minConfidence,
      isRotorcraft: target.isRotorcraft,
    }
    const anchorFor = (anchor: typeof item.departureAnchor) => {
      const altitude = anchor.position.altitudeBaro ?? anchor.position.altitudeGeom ?? null
      const field = index.elevationAt(anchor.position.latitude, anchor.position.longitude)
      return {
        latitude: anchor.position.latitude,
        longitude: anchor.position.longitude,
        onGround: anchor.onGround,
        altitudeAglFt: altitude === null ? null : altitude - (field ?? 0),
      }
    }
    const departureMatch = matchAirport(index, anchorFor(item.departureAnchor), matchOptions)
    const arrivalMatch = matchAirport(index, anchorFor(item.arrivalAnchor), matchOptions)

    const overallConfidence = Math.min(
      item.routeConfidence,
      departureMatch.confidence,
      arrivalMatch.confidence,
    )
    const id = `${target.id}-${item.departureTime.toISOString()}`
    const publicId = publicIdFor(target, item, airportCode(departureMatch), airportCode(arrivalMatch))
    const routeId = await upsertRoute(
      departureMatch.airport?.id ?? null,
      arrivalMatch.airport?.id ?? null,
    )

    await db.insert(flight).values({
      id,
      publicId,
      aircraftId: target.id,
      departureTime: item.departureTime,
      arrivalTime: item.arrivalTime,
      departureTimeEstimated: item.departureTimeEstimated,
      arrivalTimeEstimated: item.arrivalTimeEstimated,
      departureAirportId: departureMatch.airport?.id ?? null,
      arrivalAirportId: arrivalMatch.airport?.id ?? null,
      probableDepartureAirportId: departureMatch.airport ? null : (departureMatch.probable?.id ?? null),
      probableArrivalAirportId: arrivalMatch.airport ? null : (arrivalMatch.probable?.id ?? null),
      routeId,
      durationSeconds: item.durationSeconds,
      blockSeconds: item.blockSeconds,
      blockSecondsEstimated: item.blockSeconds === null,
      distanceKm: item.distanceKm,
      distanceFromGapsKm: item.distanceFromGapsKm,
      greatCircleKm: item.greatCircleKm,
      maxAltitudeFt: item.maxAltitudeFt,
      callsign: item.callsign?.slice(0, 12) ?? null,
      dataCoverage: item.coverage.dataCoverage,
      routeConfidence: item.routeConfidence,
      departureAirportConfidence: departureMatch.confidence,
      arrivalAirportConfidence: arrivalMatch.confidence,
      confidence: confidenceLabel(overallConfidence),
      positionCount: item.coverage.positionCount,
      maxGapSeconds: item.coverage.maxGapSeconds,
      medianIntervalSeconds: item.coverage.medianIntervalSeconds,
      dataSource: item.dataSource,
      dataStatus: target.dataStatus,
      detectorVersion: DETECTOR_VERSION,
      publishedAt: publishableAt(item, env.publicationDelayHours),
      updatedAt: new Date(),
    })

    const simplified = simplifyPath(item.positions, TRACK_SIMPLIFY_TOLERANCE_KM)
    await db.insert(flightTrack).values({
      flightId: id,
      points: simplified.map((position) => [
        Number(position.longitude.toFixed(5)),
        Number(position.latitude.toFixed(5)),
        position.altitudeBaro ?? null,
        Math.floor(position.timestamp.getTime() / 1000),
      ]),
      pointCount: simplified.length,
      simplifiedFrom: item.positions.length,
      gaps: item.coverage.gaps.map((gap) => ({
        from: gap.fromTs.toISOString(),
        to: gap.toTs.toISOString(),
        seconds: Math.round(gap.seconds),
        distanceKm: Number(gap.distanceKm.toFixed(1)),
        airborne: gap.airborne,
      })),
    })

    results.push({ id, publicId, detected: item, departureMatch, arrivalMatch, overallConfidence })
  }

  const reattached = await reattachManualEnrichment(carried, results)

  log.info(
    `${target.registration ?? target.icao24}: ${positions.length} positions -> ${results.length} flights` +
      (carried.purposes.length + carried.passengers.length > 0
        ? `, ${reattached} of ${carried.purposes.length + carried.passengers.length} manual records reattached`
        : ''),
  )

  return { aircraft: target, positionsRead: positions.length, flights: results }
}

/** Detection may shift a departure time slightly; anything further apart is a different flight. */
const REATTACH_TOLERANCE_MS = 30 * 60 * 1000

type CarriedEnrichment = {
  purposes: { departureTime: Date; row: typeof flightPurpose.$inferSelect }[]
  passengers: { departureTime: Date; row: typeof flightPassengers.$inferSelect }[]
}

/**
 * Lifts hand-entered records out before the flights they hang off are deleted.
 *
 * Purposes and passenger counts are research, not derived data. They cost someone an
 * afternoon and a freedom-of-information request; a rebuild must not consume them.
 */
async function liftManualEnrichment(
  aircraftId: string,
  from?: Date,
  to?: Date,
): Promise<CarriedEnrichment> {
  const { db } = await getDb()
  const filters: SQL[] = [eq(flight.aircraftId, aircraftId)]
  if (from) filters.push(gte(flight.departureTime, from))
  if (to) filters.push(lt(flight.departureTime, to))

  const purposes = await db
    .select({ departureTime: flight.departureTime, row: flightPurpose })
    .from(flightPurpose)
    .innerJoin(flight, eq(flight.id, flightPurpose.flightId))
    .where(and(...filters))

  const passengers = await db
    .select({ departureTime: flight.departureTime, row: flightPassengers })
    .from(flightPassengers)
    .innerJoin(flight, eq(flight.id, flightPassengers.flightId))
    .where(and(...filters))

  return { purposes, passengers }
}

/**
 * Puts them back, matching on the natural key — this aircraft, departing at about this
 * time. Anything that cannot be matched is reported loudly rather than dropped.
 */
async function reattachManualEnrichment(
  carried: CarriedEnrichment,
  rebuilt: RebuiltFlight[],
): Promise<number> {
  if (carried.purposes.length === 0 && carried.passengers.length === 0) return 0
  const { db } = await getDb()

  const nearest = (departureTime: Date): RebuiltFlight | null => {
    let best: RebuiltFlight | null = null
    let bestDelta = Number.POSITIVE_INFINITY
    for (const candidate of rebuilt) {
      const delta = Math.abs(candidate.detected.departureTime.getTime() - departureTime.getTime())
      if (delta < bestDelta) {
        bestDelta = delta
        best = candidate
      }
    }
    return bestDelta <= REATTACH_TOLERANCE_MS ? best : null
  }

  let reattached = 0

  for (const item of carried.purposes) {
    const match = nearest(item.departureTime)
    if (!match) {
      log.warn(
        `purpose "${item.row.title}" could not be reattached: no rebuilt flight departs within ` +
          `30 minutes of ${item.departureTime.toISOString()}`,
      )
      continue
    }
    await db.insert(flightPurpose).values({ ...item.row, flightId: match.id }).onConflictDoNothing()
    reattached++
  }

  for (const item of carried.passengers) {
    const match = nearest(item.departureTime)
    if (!match) {
      log.warn(
        `passenger count could not be reattached: no rebuilt flight departs within 30 minutes ` +
          `of ${item.departureTime.toISOString()}`,
      )
      continue
    }
    await db.insert(flightPassengers).values({ ...item.row, flightId: match.id }).onConflictDoNothing()
    reattached++
  }

  return reattached
}

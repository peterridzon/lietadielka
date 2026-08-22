/**
 * Groups detected flights into missions (trips), so that cost and any commercial
 * comparison happen at the level a delegation actually travels.
 */
import { asc, eq } from 'drizzle-orm'
import { groupMissions, missionPublicId, type MissionLegInput } from '../core/missions/group.js'
import { getDb } from '../db/client.js'
import { aircraft, airport, flight, mission, missionLeg } from '../db/schema.js'
import { log } from '../lib/log.js'

export async function rebuildMissions(): Promise<{ missions: number; legs: number }> {
  const { db } = await getDb()

  const depAirport = airport
  const rows = await db
    .select({
      flightId: flight.id,
      publicId: flight.publicId,
      aircraftId: flight.aircraftId,
      registration: aircraft.registration,
      departureTime: flight.departureTime,
      arrivalTime: flight.arrivalTime,
      departureAirportId: flight.departureAirportId,
      arrivalAirportId: flight.arrivalAirportId,
      durationSeconds: flight.durationSeconds,
      blockSeconds: flight.blockSeconds,
      distanceKm: flight.distanceKm,
    })
    .from(flight)
    .innerJoin(aircraft, eq(aircraft.id, flight.aircraftId))
    .orderBy(asc(flight.departureTime))
  void depAirport

  const legs: MissionLegInput[] = rows.map((r) => ({
    flightId: r.flightId,
    publicId: r.publicId,
    aircraftId: r.aircraftId,
    departureTime: r.departureTime,
    arrivalTime: r.arrivalTime ?? r.departureTime,
    departureAirport: r.departureAirportId,
    arrivalAirport: r.arrivalAirportId,
    airborneSeconds: r.durationSeconds ?? 0,
    blockSeconds: r.blockSeconds,
    distanceKm: r.distanceKm ?? 0,
  }))

  const registrationById = new Map(rows.map((r) => [r.aircraftId, r.registration ?? r.aircraftId]))
  const groups = groupMissions(legs)

  // Missions are derived; rebuilding replaces them entirely.
  await db.delete(mission)

  let legCount = 0
  for (const group of groups) {
    const registration = registrationById.get(group.aircraftId) ?? group.aircraftId
    const id = missionPublicId(group, registration)
    await db.insert(mission).values({
      id,
      publicId: id,
      aircraftId: group.aircraftId,
      startedAt: group.startedAt,
      endedAt: group.endedAt,
      legCount: group.legs.length,
      grouping: group.grouping,
      groupingConfidence: group.confidence,
      routeKey: group.routeKey,
      airborneSeconds: Math.round(group.airborneSeconds),
      blockSeconds: group.blockSeconds === null ? null : Math.round(group.blockSeconds),
      distanceKm: group.distanceKm,
    })
    for (const [index, leg] of group.legs.entries()) {
      await db.insert(missionLeg).values({ missionId: id, flightId: leg.flightId, legIndex: index })
      legCount++
    }
  }

  log.info(`missions: ${groups.length} missions from ${legCount} legs`)
  return { missions: groups.length, legs: legCount }
}

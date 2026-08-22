/**
 * Exports the database into the JSON the design preview renders.
 *
 * Run from the repository root:  npx tsx preview/export.ts
 * Then rebuild the page with:    python3 preview/build.py
 */
import { writeFileSync } from 'node:fs'
import { asc, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { closeDb, getDb } from '../src/db/client.js'
import { aircraft, airport, flight, flightPurpose, flightTrack, importJob } from '../src/db/schema.js'
import { env } from '../src/lib/env.js'

const { db } = await getDb()
const dep = alias(airport, 'dep')
const arr = alias(airport, 'arr')
const depP = alias(airport, 'depp')
const arrP = alias(airport, 'arrp')

const flights = await db
  .select({
    publicId: flight.publicId,
    registration: aircraft.registration,
    model: aircraft.model,
    variant: aircraft.variant,
    operator: aircraft.operator,
    departureTime: flight.departureTime,
    arrivalTime: flight.arrivalTime,
    depEst: flight.departureTimeEstimated,
    arrEst: flight.arrivalTimeEstimated,
    durationSeconds: flight.durationSeconds,
    distanceKm: flight.distanceKm,
    distanceFromGapsKm: flight.distanceFromGapsKm,
    greatCircleKm: flight.greatCircleKm,
    maxAltitudeFt: flight.maxAltitudeFt,
    callsign: flight.callsign,
    dataCoverage: flight.dataCoverage,
    routeConfidence: flight.routeConfidence,
    depConf: flight.departureAirportConfidence,
    arrConf: flight.arrivalAirportConfidence,
    confidence: flight.confidence,
    positionCount: flight.positionCount,
    maxGapSeconds: flight.maxGapSeconds,
    detectorVersion: flight.detectorVersion,
    publishedAt: flight.publishedAt,
    depIdent: dep.ident, depIata: dep.iata, depCity: dep.city, depName: dep.name, depCountry: dep.country,
    arrIdent: arr.ident, arrIata: arr.iata, arrCity: arr.city, arrName: arr.name, arrCountry: arr.country,
    depPIdent: depP.ident, depPIata: depP.iata, depPCity: depP.city, depPName: depP.name,
    arrPIdent: arrP.ident, arrPIata: arrP.iata, arrPCity: arrP.city, arrPName: arrP.name,
    track: flightTrack.points,
    gaps: flightTrack.gaps,
    trackPoints: flightTrack.pointCount,
    trackFrom: flightTrack.simplifiedFrom,
    purposeTitle: flightPurpose.title,
    purposeDescription: flightPurpose.description,
    purposeStatus: flightPurpose.status,
    purposeSourceUrl: flightPurpose.sourceUrl,
    purposeSourcePublisher: flightPurpose.sourcePublisher,
    purposeSourcePublishedAt: flightPurpose.sourcePublishedAt,
  })
  .from(flight)
  .innerJoin(aircraft, eq(aircraft.id, flight.aircraftId))
  .leftJoin(dep, eq(dep.id, flight.departureAirportId))
  .leftJoin(arr, eq(arr.id, flight.arrivalAirportId))
  .leftJoin(depP, eq(depP.id, flight.probableDepartureAirportId))
  .leftJoin(arrP, eq(arrP.id, flight.probableArrivalAirportId))
  .leftJoin(flightTrack, eq(flightTrack.flightId, flight.id))
  .leftJoin(flightPurpose, eq(flightPurpose.flightId, flight.id))
  .orderBy(asc(flight.departureTime))

const fleet = await db.select().from(aircraft).orderBy(aircraft.registration)
const jobs = await db
  .select({
    day: importJob.rangeFrom,
    icao: importJob.aircraftIcao24,
    status: importJob.status,
    positions: importJob.positionsStored,
  })
  .from(importJob)
  .orderBy(asc(importJob.rangeFrom))

const days = jobs.map((j) => ({
  day: j.day.toISOString().slice(0, 10),
  icao: j.icao,
  status: j.status,
  positions: j.positions,
}))

writeFileSync(
  'preview/src/export.json',
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    publicationDelayHours: env.publicationDelayHours,
    flights,
    fleet,
    days,
  }),
)
console.log(`exported ${flights.length} flights, ${fleet.length} aircraft, ${days.length} import jobs`)
await closeDb()

/**
 * Exports the database into the JSON the design preview renders.
 *
 * Run from the repository root:  npx tsx preview/export.ts
 * Then rebuild the page with:    python3 preview/build.py
 */
import { writeFileSync } from 'node:fs'
import { and, asc, eq } from 'drizzle-orm'
import { getAirportIndex } from '../src/db/repositories/airports.js'
import { alias } from 'drizzle-orm/pg-core'
import { closeDb, getDb } from '../src/db/client.js'
import {
  aircraft,
  airport,
  annualFixedCost,
  annualUtilisation,
  costBenchmark,
  costModel,
  costResearchItem,
  flight,
  flightCost,
  flightPurpose,
  flightTrack,
  importJob,
  mission,
  missionLeg,
  operatorOrganisation,
  source,
} from '../src/db/schema.js'
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
    blockSeconds: flight.blockSeconds,
    costDirectLow: flightCost.directLow,
    costDirectMid: flightCost.directMid,
    costDirectHigh: flightCost.directHigh,
    costFixedLow: flightCost.fixedLow,
    costFixedMid: flightCost.fixedMid,
    costFixedHigh: flightCost.fixedHigh,
    costFullLow: flightCost.fullLow,
    costFullMid: flightCost.fullMid,
    costFullHigh: flightCost.fullHigh,
    costConfidence: flightCost.confidence,
    costBlockHours: flightCost.blockHours,
    costBlockEstimated: flightCost.blockHoursEstimated,
    costPriceYear: flightCost.priceYear,
    costPriceYearGap: flightCost.priceYearGapYears,
    costModelVersion: flightCost.costModelVersion,
    costEngineVersion: flightCost.engineVersion,
    costMissing: flightCost.missing,
    costWarnings: flightCost.warnings,
    costTrace: flightCost.trace,
    costComponents: flightCost.components,
    costValidationWarning: flightCost.validationWarning,
  })
  .from(flight)
  .innerJoin(aircraft, eq(aircraft.id, flight.aircraftId))
  .leftJoin(dep, eq(dep.id, flight.departureAirportId))
  .leftJoin(arr, eq(arr.id, flight.arrivalAirportId))
  .leftJoin(depP, eq(depP.id, flight.probableDepartureAirportId))
  .leftJoin(arrP, eq(arrP.id, flight.probableArrivalAirportId))
  .leftJoin(flightTrack, eq(flightTrack.flightId, flight.id))
  .leftJoin(flightPurpose, eq(flightPurpose.flightId, flight.id))
  .leftJoin(flightCost, and(eq(flightCost.flightId, flight.id), eq(flightCost.isCurrent, true)))
  .orderBy(asc(flight.departureTime))

// Where an endpoint was never identified we still know where the aircraft was when we
// last saw it. "Coverage lost over Romania" answers "where did it go" far better than
// "unknown" does, and it is a fact rather than a guess about the destination.
const airportIndex = await getAirportIndex()
function lastKnownPlace(track: unknown, which: 'first' | 'last'): { country: string | null; near: string | null } {
  const points = (track as [number, number, number | null, number][] | null) ?? []
  if (points.length === 0) return { country: null, near: null }
  const p = which === 'first' ? points[0]! : points[points.length - 1]!
  const found = airportIndex.near({ latitude: p[1], longitude: p[0] }, 300)[0]
  return found
    ? { country: found.airport.country, near: found.airport.city ?? found.airport.name }
    : { country: null, near: null }
}

const fleet = await db.select().from(aircraft).orderBy(aircraft.registration)
const operators = await db.select().from(operatorOrganisation)

const missions = await db
  .select({
    publicId: mission.publicId,
    registration: aircraft.registration,
    startedAt: mission.startedAt,
    endedAt: mission.endedAt,
    legCount: mission.legCount,
    routeKey: mission.routeKey,
    grouping: mission.grouping,
    groupingConfidence: mission.groupingConfidence,
    airborneSeconds: mission.airborneSeconds,
    distanceKm: mission.distanceKm,
  })
  .from(mission)
  .leftJoin(aircraft, eq(aircraft.id, mission.aircraftId))
  .orderBy(asc(mission.startedAt))

const missionLegs = await db
  .select({ missionId: missionLeg.missionId, publicId: flight.publicId, legIndex: missionLeg.legIndex })
  .from(missionLeg)
  .innerJoin(flight, eq(flight.id, missionLeg.flightId))

const models = await db.select().from(costModel).orderBy(asc(costModel.validFrom))
const sources = await db.select().from(source)
const research = await db.select().from(costResearchItem).orderBy(asc(costResearchItem.id))
const benchmarks = await db.select().from(costBenchmark)
const utilisation = await db.select().from(annualUtilisation).orderBy(asc(annualUtilisation.year))
const fixedCosts = await db.select().from(annualFixedCost).orderBy(asc(annualFixedCost.year))
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

for (const f of flights as (typeof flights[number] & Record<string, unknown>)[]) {
  if (!f.depIdent) {
    const place = lastKnownPlace(f.track, 'first')
    f.depLastSeenCountry = place.country
    f.depLastSeenNear = place.near
  }
  if (!f.arrIdent) {
    const place = lastKnownPlace(f.track, 'last')
    f.arrLastSeenCountry = place.country
    f.arrLastSeenNear = place.near
  }
}

writeFileSync(
  'preview/src/export.json',
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    publicationDelayHours: env.publicationDelayHours,
    flights,
    fleet,
    operators,
    days,
    missions,
    missionLegs,
    costModels: models,
    sources,
    research,
    benchmarks,
    utilisation,
    fixedCosts,
  }),
)
console.log(
  `exported ${flights.length} flights, ${fleet.length} aircraft, ${days.length} import jobs, ` +
    `${missions.length} missions, ${models.length} cost models`,
)
await closeDb()

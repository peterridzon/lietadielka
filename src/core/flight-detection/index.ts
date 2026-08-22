/**
 * Flight reconstruction: a stream of ADS-B fixes for one aircraft becomes a list of
 * flights, each with its measurements and an honest account of how well we saw it.
 *
 * Entry point for the whole detector. Pure: no database, no network, no clock.
 */
import { haversineKm, pathLengthKm } from '../geo.js'
import type { AdsbPosition, ConfidenceLabel } from '../types.js'
import { classifyPoint, resolveUnknowns, type ElevationLookup, type PointState } from './classify.js'
import { DEFAULT_DETECTION_CONFIG, DETECTOR_VERSION, type DetectionConfig } from './config.js'
import { computeCoverage, type CoverageMetrics } from './coverage.js'
import { normaliseStream, segmentPositions } from './segmentation.js'
import { findFlightSpans, labelPhases, type FlightPhase } from './state-machine.js'

export { DETECTOR_VERSION, DEFAULT_DETECTION_CONFIG }
export type { DetectionConfig }

export type DetectedFlight = {
  departureTime: Date
  arrivalTime: Date
  departureTimeEstimated: boolean
  arrivalTimeEstimated: boolean
  durationSeconds: number

  positions: AdsbPosition[]
  phases: FlightPhase[]

  distanceKm: number
  distanceFromGapsKm: number
  greatCircleKm: number
  maxAltitudeFt: number | null
  callsign?: string

  coverage: CoverageMetrics
  routeConfidence: number
  touchAndGoCount: number

  /** First and last fixes, i.e. what we actually observed at each end. */
  firstPosition: AdsbPosition
  lastPosition: AdsbPosition
  /** Representative fix for airport matching at each end, and whether it was on the ground. */
  departureAnchor: { position: AdsbPosition; onGround: boolean }
  arrivalAnchor: { position: AdsbPosition; onGround: boolean }

  detectorVersion: string
  dataSource: string
}

export type DetectionOptions = {
  config?: Partial<DetectionConfig>
  elevationAt?: ElevationLookup
}

export function detectFlights(
  rawPositions: AdsbPosition[],
  options: DetectionOptions = {},
): DetectedFlight[] {
  const config = { ...DEFAULT_DETECTION_CONFIG, ...options.config }
  const positions = normaliseStream(rawPositions)
  if (positions.length < 2) return []

  const flights: DetectedFlight[] = []

  for (const segment of segmentPositions(positions, config, options.elevationAt)) {
    if (segment.length < 2) continue

    const states = resolveUnknowns(
      segment.map((position) => classifyPoint(position, config, options.elevationAt)),
    )
    const spans = findFlightSpans(segment, states, config)
    const phases = labelPhases(states, spans, segment, config)

    for (const span of spans) {
      // Two slices with different jobs. `spanSlice` keeps the ground fixes at both
      // ends, because that is where the airport evidence lives. `slice` is trimmed to
      // the interval we actually claim as the flight, so duration, distance and
      // coverage all describe the same window.
      const spanSlice = segment.slice(span.startIndex, span.endIndex + 1)
      if (spanSlice.length < 2) continue

      // A ground fix minutes before the climb is a takeoff we watched. A ground fix
      // hours before it is an aircraft that was parked, disappeared, and came back
      // already airborne — reporting that as the departure time would overstate the
      // flight by hours, so we fall back to the first airborne fix and say so.
      const departureObserved = span.departureGapSeconds <= config.gapSoftSeconds
      const arrivalObserved = span.arrivalGapSeconds <= config.gapSoftSeconds
      const departureTime = departureObserved ? span.departureTs : span.firstAirborneTs
      const arrivalTime = arrivalObserved ? span.arrivalTs : span.lastAirborneTs

      const durationSeconds = Math.round(
        (arrivalTime.getTime() - departureTime.getTime()) / 1000,
      )

      const measureStart = departureObserved ? span.startIndex : span.firstAirborneIndex
      const measureEnd = arrivalObserved ? span.endIndex : span.lastAirborneIndex
      const slice = segment.slice(measureStart, measureEnd + 1)
      if (slice.length < 2) continue

      const spanStates = states.slice(span.startIndex, span.endIndex + 1)
      const sliceStates = states.slice(measureStart, measureEnd + 1)
      const coverage = computeCoverage(slice, sliceStates, config)
      const distanceKm = pathLengthKm(slice)

      if (durationSeconds < config.minFlightSeconds) continue
      if (distanceKm < config.minFlightDistanceKm) continue
      if (!sliceStates.includes('air')) continue

      const first = slice[0]!
      const last = slice[slice.length - 1]!
      // Indices relative to spanSlice, which starts at span.startIndex.
      const firstAirborneLocal = span.firstAirborneIndex - span.startIndex
      const lastAirborneLocal = span.lastAirborneIndex - span.startIndex
      const departureAnchor = anchorFor(
        spanSlice,
        spanStates,
        'departure',
        departureObserved,
        0,
        firstAirborneLocal,
      )
      const arrivalAnchor = anchorFor(
        spanSlice,
        spanStates,
        'arrival',
        arrivalObserved,
        lastAirborneLocal,
        spanSlice.length - 1,
      )

      const altitudes = slice
        .map((position) => position.altitudeBaro ?? position.altitudeGeom)
        .filter((value): value is number => value !== undefined)

      flights.push({
        departureTime,
        arrivalTime,
        departureTimeEstimated: !departureObserved,
        arrivalTimeEstimated: !arrivalObserved,
        durationSeconds,

        positions: slice,
        phases: phases.slice(measureStart, measureEnd + 1),

        distanceKm,
        distanceFromGapsKm: coverage.distanceFromGapsKm,
        greatCircleKm: haversineKm(departureAnchor.position, arrivalAnchor.position),
        maxAltitudeFt: altitudes.length > 0 ? Math.max(...altitudes) : null,
        callsign: dominantCallsign(slice),

        coverage,
        routeConfidence: routeConfidenceOf(coverage, !departureObserved, !arrivalObserved),
        touchAndGoCount: span.touchAndGoCount,

        firstPosition: first,
        lastPosition: last,
        departureAnchor,
        arrivalAnchor,

        detectorVersion: DETECTOR_VERSION,
        dataSource: first.source,
      })
    }
  }

  return flights
}

/**
 * The fix we use to identify the airport at one end of the flight.
 *
 * A ground fix adjacent to the flight is the strong case. A ground fix separated from
 * the flight by hours of lost coverage is weaker — the aircraft was there, but we did
 * not watch it leave or arrive — so it is passed on without the `onGround` privilege
 * and gets the wider search radius and the confidence ceiling instead. With no ground
 * fix at all we fall back to the end of the track, which locates where we lost the
 * aircraft, not where it landed.
 */
function anchorFor(
  slice: AdsbPosition[],
  states: PointState[],
  end: 'departure' | 'arrival',
  observed: boolean,
  searchFrom: number,
  searchTo: number,
): { position: AdsbPosition; onGround: boolean } {
  // The search window matters: ground fixes before the climb belong to the departure
  // and ground fixes after the descent belong to the arrival. Searching the whole
  // slice would happily answer "the aircraft landed where it took off" for any flight
  // whose destination we never saw.
  const from = Math.max(0, searchFrom)
  const to = Math.min(slice.length - 1, searchTo)
  if (end === 'departure') {
    for (let i = from; i <= to; i++) {
      if (states[i] === 'ground') return { position: slice[i]!, onGround: observed }
    }
  } else {
    for (let i = to; i >= from; i--) {
      if (states[i] === 'ground') return { position: slice[i]!, onGround: observed }
    }
  }
  const fallbackIndex = end === 'departure' ? from : to
  return { position: slice[fallbackIndex]!, onGround: false }
}

function dominantCallsign(slice: AdsbPosition[]): string | undefined {
  const counts = new Map<string, number>()
  for (const position of slice) {
    if (!position.callsign) continue
    counts.set(position.callsign, (counts.get(position.callsign) ?? 0) + 1)
  }
  let best: string | undefined
  let bestCount = 0
  for (const [callsign, count] of counts) {
    if (count > bestCount) {
      best = callsign
      bestCount = count
    }
  }
  return best
}

/**
 * How much we trust the shape of the track: coverage, degraded when we did not see
 * one or both ends of the flight, and when the track is built from very few fixes.
 */
function routeConfidenceOf(
  coverage: CoverageMetrics,
  departureEstimated: boolean,
  arrivalEstimated: boolean,
): number {
  const missingEdges = (departureEstimated ? 1 : 0) + (arrivalEstimated ? 1 : 0)
  const edgeFactor = missingEdges === 0 ? 1 : missingEdges === 1 ? 0.7 : 0.5
  const densityFactor = Math.min(1, coverage.positionCount / 30)
  return Math.max(0, Math.min(1, coverage.dataCoverage * edgeFactor * densityFactor))
}

export function confidenceLabel(value: number): ConfidenceLabel {
  if (value >= 0.75) return 'high'
  if (value >= 0.5) return 'medium'
  return 'low'
}

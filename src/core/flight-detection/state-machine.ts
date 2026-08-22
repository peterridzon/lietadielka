import type { AdsbPosition } from '../types.js'
import type { PointState } from './classify.js'
import type { DetectionConfig } from './config.js'

/**
 * GROUND → TAKEOFF → AIRBORNE → APPROACH → LANDED
 *
 * The published states are what a reader expects to see; the decision that actually
 * matters is narrower: which ground contacts are *stops* (a real landing) and which
 * are transient (a touch-and-go, a runway crossing, a momentary bad fix).
 */
export type FlightPhase = 'GROUND' | 'TAKEOFF' | 'AIRBORNE' | 'APPROACH' | 'LANDED'

export type StateRun = {
  state: PointState
  startIndex: number
  endIndex: number
  startTs: Date
  endTs: Date
  /** Wall-clock seconds until the next run begins — a parked aircraft stops transmitting. */
  effectiveSeconds: number
  /** Ground runs only: long enough to count as a landing rather than a touch-and-go. */
  isStop: boolean
}

export type FlightSpan = {
  /** Index of the first position belonging to the flight (inclusive). */
  startIndex: number
  /** Index of the last position belonging to the flight (inclusive). */
  endIndex: number
  /** Wheels-up: the last moment observed on the ground before the climb. */
  departureTs: Date
  /** Wheels-down: the first moment observed on the ground after the descent. */
  arrivalTs: Date
  /** First fix classified as airborne. */
  firstAirborneTs: Date
  firstAirborneIndex: number
  /** Last fix classified as airborne. */
  lastAirborneTs: Date
  lastAirborneIndex: number
  /**
   * Seconds between the last ground fix and the first airborne fix. Small means we
   * watched the aircraft leave; large means it was parked, we lost it, and it
   * reappeared already flying. Infinity means the track began airborne.
   */
  departureGapSeconds: number
  /** The mirror image at the other end. Infinity means the track ended airborne. */
  arrivalGapSeconds: number
  /** Ground contacts inside the flight that were too brief to be landings. */
  touchAndGoCount: number
}

export function buildRuns(
  positions: AdsbPosition[],
  states: PointState[],
  config: DetectionConfig,
): StateRun[] {
  const runs: StateRun[] = []
  if (positions.length === 0) return runs

  let startIndex = 0
  for (let i = 1; i <= positions.length; i++) {
    if (i < positions.length && states[i] === states[startIndex]) continue
    const endIndex = i - 1
    runs.push({
      state: states[startIndex]!,
      startIndex,
      endIndex,
      startTs: positions[startIndex]!.timestamp,
      endTs: positions[endIndex]!.timestamp,
      effectiveSeconds: 0,
      isStop: false,
    })
    startIndex = i
  }

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!
    const next = runs[i + 1]
    // A parked aircraft often stops transmitting, so the time until the next run
    // starts is a better measure of how long it sat than the run's own span.
    run.effectiveSeconds = next
      ? (next.startTs.getTime() - run.startTs.getTime()) / 1000
      : Number.POSITIVE_INFINITY
    run.isStop = run.state === 'ground' && run.effectiveSeconds >= config.minGroundSeconds
  }

  return runs
}

/**
 * Walks the runs of one continuous track and returns the flights inside it.
 * A flight runs from one stop (or the start of data) to the next stop (or its end).
 */
export function findFlightSpans(
  positions: AdsbPosition[],
  states: PointState[],
  config: DetectionConfig,
): FlightSpan[] {
  const runs = buildRuns(positions, states, config)
  const spans: FlightSpan[] = []

  type OpenFlight = {
    startIndex: number
    departureTs: Date
    departureGapSeconds: number
    firstAirborneTs: Date
    firstAirborneIndex: number
    lastAirborneTs: Date
    lastAirborneIndex: number
    touchAndGoCount: number
  }
  let open: OpenFlight | null = null

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!

    if (run.state === 'air') {
      if (open) {
        open.lastAirborneTs = run.endTs
        open.lastAirborneIndex = run.endIndex
        continue
      }

      // Any ground contact immediately before the climb gives us a real wheels-up
      // moment. The minGroundSeconds threshold exists to tell a landing from a
      // touch-and-go; it has no bearing on whether we saw a departure.
      const previous = runs[i - 1]
      const ground = previous && previous.state === 'ground' ? previous : null
      open = {
        startIndex: ground ? ground.endIndex : run.startIndex,
        departureTs: ground ? ground.endTs : run.startTs,
        departureGapSeconds: ground
          ? (run.startTs.getTime() - ground.endTs.getTime()) / 1000
          : Number.POSITIVE_INFINITY,
        firstAirborneTs: run.startTs,
        firstAirborneIndex: run.startIndex,
        lastAirborneTs: run.endTs,
        lastAirborneIndex: run.endIndex,
        touchAndGoCount: 0,
      }
      continue
    }

    // Ground run.
    if (!open) continue

    if (run.isStop) {
      spans.push({
        startIndex: open.startIndex,
        endIndex: run.startIndex,
        departureTs: open.departureTs,
        arrivalTs: run.startTs,
        firstAirborneTs: open.firstAirborneTs,
        firstAirborneIndex: open.firstAirborneIndex,
        lastAirborneTs: open.lastAirborneTs,
        lastAirborneIndex: open.lastAirborneIndex,
        departureGapSeconds: open.departureGapSeconds,
        arrivalGapSeconds: (run.startTs.getTime() - open.lastAirborneTs.getTime()) / 1000,
        touchAndGoCount: open.touchAndGoCount,
      })
      open = null
    } else {
      open.touchAndGoCount++
    }
  }

  if (open) {
    const last = positions.length - 1
    spans.push({
      startIndex: open.startIndex,
      endIndex: last,
      departureTs: open.departureTs,
      arrivalTs: positions[last]!.timestamp,
      firstAirborneTs: open.firstAirborneTs,
      firstAirborneIndex: open.firstAirborneIndex,
      lastAirborneTs: open.lastAirborneTs,
      lastAirborneIndex: open.lastAirborneIndex,
      departureGapSeconds: open.departureGapSeconds,
      arrivalGapSeconds: Number.POSITIVE_INFINITY,
      touchAndGoCount: open.touchAndGoCount,
    })
  }

  return spans
}

/** Human-readable phase per position, for debugging and for the flight detail view. */
export function labelPhases(
  states: PointState[],
  spans: FlightSpan[],
  positions: AdsbPosition[],
  config: DetectionConfig,
): FlightPhase[] {
  const phases: FlightPhase[] = states.map((state) => (state === 'ground' ? 'GROUND' : 'AIRBORNE'))

  for (const span of spans) {
    for (let i = span.startIndex; i <= span.endIndex; i++) {
      if (states[i] === 'ground') {
        phases[i] = positions[i]!.timestamp <= span.firstAirborneTs ? 'GROUND' : 'LANDED'
        continue
      }
      const altitude = positions[i]!.altitudeBaro ?? positions[i]!.altitudeGeom ?? 0
      const climbing = (positions[i]!.verticalRate ?? 0) > 0
      if (altitude < config.airborneAltFt * 3) {
        phases[i] = climbing ? 'TAKEOFF' : 'APPROACH'
      } else {
        phases[i] = 'AIRBORNE'
      }
    }
  }

  return phases
}

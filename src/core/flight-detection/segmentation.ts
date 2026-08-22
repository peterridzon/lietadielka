import { haversineKm, impliedSpeedKt } from '../geo.js'
import type { AdsbPosition } from '../types.js'
import type { ElevationLookup } from './classify.js'
import type { DetectionConfig } from './config.js'

/**
 * Splits a position stream into continuous tracks.
 *
 * Deliberately conservative. A data gap is not evidence of a landing, so a gap alone
 * never ends a track — only a gap so long that no single flight could span it, two
 * fixes that no aircraft could have flown between, or a gap whose two ends can only be
 * explained by the aircraft having been on the ground. Everything else is resolved
 * later by the ground-stop logic in the state machine, where we have actual evidence
 * of the aircraft being on the ground.
 */
export function segmentPositions(
  positions: AdsbPosition[],
  config: DetectionConfig,
  elevationAt?: ElevationLookup,
): AdsbPosition[][] {
  if (positions.length === 0) return []

  const segments: AdsbPosition[][] = []
  let current: AdsbPosition[] = [positions[0]!]

  for (let i = 1; i < positions.length; i++) {
    const previous = positions[i - 1]!
    const point = positions[i]!
    const gapSeconds = (point.timestamp.getTime() - previous.timestamp.getTime()) / 1000

    const tooLong = gapSeconds > config.gapHardSeconds

    // Only test for a teleport across a genuine gap. Applied to adjacent 2 Hz fixes the
    // test fires on coordinate rounding alone and shreds a perfectly good track.
    const jumpKm = haversineKm(previous, point)
    const impossible =
      gapSeconds >= config.teleportMinGapSeconds &&
      jumpKm >= config.teleportMinDistanceKm &&
      impliedSpeedKt(previous, point) > config.maxPlausibleSpeedKt

    if (tooLong || impossible || looksLikeGroundStop(previous, point, gapSeconds, config, elevationAt)) {
      segments.push(current)
      current = [point]
    } else {
      current.push(point)
    }
  }

  segments.push(current)
  return segments
}

/** Removes duplicate timestamps and enforces ascending order. */
export function normaliseStream(positions: AdsbPosition[]): AdsbPosition[] {
  const sorted = [...positions].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  const result: AdsbPosition[] = []
  let lastTime = Number.NEGATIVE_INFINITY
  for (const position of sorted) {
    const time = position.timestamp.getTime()
    if (time === lastTime) continue
    result.push(position)
    lastTime = time
  }
  return result
}

/**
 * Was the aircraft on the ground during this gap, even though we never saw it there?
 *
 * Surface positions are frequently not received at airports outside dense receiver
 * coverage. The signature of an unseen turnaround is unmistakable: the track descends
 * into the terminal area, disappears for an hour or more, and resumes at low level a
 * few kilometres away. Left unsplit, OM-BYK's Bratislava–Amman–Brussels rotation of
 * 2026-08-19 was reported as a single 7 000 km "Bratislava to Brussels" flight, and the
 * Amman stop disappeared from the record.
 *
 * This is an inference, not an observation. Both resulting legs therefore carry
 * estimated times and an airport that can only ever be reported as probable.
 */
function looksLikeGroundStop(
  before: AdsbPosition,
  after: AdsbPosition,
  gapSeconds: number,
  config: DetectionConfig,
  elevationAt?: ElevationLookup,
): boolean {
  if (gapSeconds < config.inferredStopMinGapSeconds) return false
  if (haversineKm(before, after) > config.inferredStopMaxDriftKm) return false
  return isTerminalArea(before, config, elevationAt) && isTerminalArea(after, config, elevationAt)
}

/** Low and slow enough to be arriving at, or leaving, an airport. */
function isTerminalArea(
  position: AdsbPosition,
  config: DetectionConfig,
  elevationAt?: ElevationLookup,
): boolean {
  if (position.onGround === true) return true

  const altitude = position.altitudeBaro ?? position.altitudeGeom
  if (altitude === undefined) return false
  const fieldElevationFt = elevationAt?.(position.latitude, position.longitude) ?? 0
  if (altitude - fieldElevationFt > config.inferredStopMaxAltitudeAglFt) return false

  // A missing ground speed at low level is not evidence either way, so require one.
  return position.groundSpeed !== undefined && position.groundSpeed < config.inferredStopMaxSpeedKt
}

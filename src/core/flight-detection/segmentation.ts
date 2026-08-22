import { haversineKm, impliedSpeedKt } from '../geo.js'
import type { AdsbPosition } from '../types.js'
import type { DetectionConfig } from './config.js'

/**
 * Splits a position stream into continuous tracks.
 *
 * Deliberately conservative. A data gap is not evidence of a landing, so a gap alone
 * never ends a track — only a gap so long that no single flight could span it, or two
 * fixes that no aircraft could have flown between, do. Everything else is resolved
 * later by the ground-stop logic in the state machine, where we have actual evidence
 * of the aircraft being on the ground.
 */
export function segmentPositions(
  positions: AdsbPosition[],
  config: DetectionConfig,
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

    if (tooLong || impossible) {
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

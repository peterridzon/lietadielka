import type { AdsbPosition } from '../types.js'
import type { DetectionConfig } from './config.js'

export type PointState = 'ground' | 'air' | 'unknown'

/** Field elevation in feet at a position, or null when unknown. */
export type ElevationLookup = (latitude: number, longitude: number) => number | null

/**
 * Classifies a single fix.
 *
 * The provider's own on-ground flag wins when present — it is derived from the
 * aircraft's own surface-position squitter, which is better evidence than anything
 * we can infer. Everything else is a physics fallback for providers that omit it.
 */
export function classifyPoint(
  position: AdsbPosition,
  config: DetectionConfig,
  elevationAt?: ElevationLookup,
): PointState {
  if (position.onGround === true) return 'ground'
  if (position.onGround === false) return 'air'

  const fieldElevationFt = elevationAt?.(position.latitude, position.longitude) ?? 0
  const altitude = position.altitudeBaro ?? position.altitudeGeom
  const aboveGroundFt = altitude === undefined ? null : altitude - fieldElevationFt
  const speed = position.groundSpeed

  if (aboveGroundFt !== null && aboveGroundFt > config.airborneAltFt) return 'air'
  if (speed !== undefined && speed > config.airborneSpeedKt) return 'air'

  const lowEnough = aboveGroundFt === null || aboveGroundFt < config.groundAltMarginFt
  const slowEnough = speed === undefined || speed < config.groundSpeedKt
  if (lowEnough && slowEnough && (aboveGroundFt !== null || speed !== undefined)) return 'ground'

  return 'unknown'
}

/**
 * Fills in `unknown` states from the nearest classified neighbour, preferring the
 * previous one. We interpolate the label, never the position.
 */
export function resolveUnknowns(states: PointState[]): PointState[] {
  const resolved = [...states]
  for (let i = 0; i < resolved.length; i++) {
    if (resolved[i] !== 'unknown') continue
    let previous: PointState = 'unknown'
    for (let j = i - 1; j >= 0; j--) {
      if (resolved[j] !== 'unknown') {
        previous = resolved[j]!
        break
      }
    }
    if (previous !== 'unknown') {
      resolved[i] = previous
      continue
    }
    for (let j = i + 1; j < resolved.length; j++) {
      if (states[j] !== 'unknown') {
        resolved[i] = states[j]!
        break
      }
    }
  }
  return resolved
}

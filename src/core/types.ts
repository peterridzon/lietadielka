/**
 * Normalised domain types.
 *
 * These are the only shapes that cross the provider boundary. No database column and
 * no algorithm is allowed to depend on a specific provider's payload format.
 */

export type AdsbPosition = {
  aircraftIcao24: string
  timestamp: Date
  latitude: number
  longitude: number
  /** Barometric altitude in feet. Absent while on the ground or when not broadcast. */
  altitudeBaro?: number
  /** Geometric (GNSS) altitude in feet. */
  altitudeGeom?: number
  /** Knots. */
  groundSpeed?: number
  /** Feet per minute; positive = climbing. */
  verticalRate?: number
  /** Degrees true. */
  track?: number
  callsign?: string
  onGround?: boolean
  /** Seconds between the fix and the message, when the provider reports it. */
  positionAgeSeconds?: number
  /** Provider flagged this as a re-broadcast of an older fix. */
  stale?: boolean
  /** Provider name, e.g. "adsblol". */
  source: string
}

export type ConfidenceLabel = 'high' | 'medium' | 'low'

export type CoverageGap = {
  fromTs: Date
  toTs: Date
  seconds: number
  /** Straight-line distance bridged by the gap, in km. */
  distanceKm: number
  /** True if the aircraft was airborne on both sides of the gap. */
  airborne: boolean
}

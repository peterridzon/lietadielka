/**
 * readsb trace decoding, shared by the live endpoint and the release archive.
 *
 * Both serve byte-identical trace files — verified by extracting 505c06 for 2026-08-15
 * from the archive and comparing it with the copy collected live: same SHA-256, same
 * 157 716 bytes, same 806 points. One decoder for both is therefore not a convenience,
 * it is the guarantee that a flight reconstructed from history is the same flight it
 * would have been if we had been watching.
 */
import type { AdsbPosition } from '../core/types.js'

/**
 * readsb trace point layout. Index 8 carries an occasional details object; the rest
 * are positional. Kept as named constants because the format has no self-description.
 */
const IDX = {
  secondsAfterBase: 0,
  latitude: 1,
  longitude: 2,
  altitudeBaro: 3, // number in feet, or the string "ground"
  groundSpeed: 4,
  track: 5,
  flags: 6,
  verticalRateBaro: 7,
  details: 8,
  positionSource: 9,
  altitudeGeom: 10,
  verticalRateGeom: 11,
  indicatedAirspeed: 12,
  rollAngle: 13,
} as const

const FLAG_STALE = 1

export type TracePoint = unknown[]
export type TraceFile = {
  icao: string
  r?: string
  t?: string
  timestamp: number
  trace: TracePoint[]
}


function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function decodeTrace(icao24: string, file: TraceFile, source: string): AdsbPosition[] {
  const base = file.timestamp * 1000
  const positions: AdsbPosition[] = []
  // The callsign only appears in the occasional details object; carry it forward
  // until it changes, which is how tar1090 renders it too.
  let callsign: string | undefined

  for (const point of file.trace) {
    const offset = numberOrUndefined(point[IDX.secondsAfterBase])
    const latitude = numberOrUndefined(point[IDX.latitude])
    const longitude = numberOrUndefined(point[IDX.longitude])
    if (offset === undefined || latitude === undefined || longitude === undefined) continue

    const details = point[IDX.details]
    if (details && typeof details === 'object') {
      const flight = (details as { flight?: unknown }).flight
      if (typeof flight === 'string' && flight.trim()) callsign = flight.trim()
    }

    const rawAltitude = point[IDX.altitudeBaro]
    const onGround = rawAltitude === 'ground'
    const flags = numberOrUndefined(point[IDX.flags]) ?? 0

    positions.push({
      aircraftIcao24: icao24.toLowerCase(),
      timestamp: new Date(base + offset * 1000),
      latitude,
      longitude,
      altitudeBaro: onGround ? undefined : numberOrUndefined(rawAltitude),
      altitudeGeom: numberOrUndefined(point[IDX.altitudeGeom]),
      groundSpeed: numberOrUndefined(point[IDX.groundSpeed]),
      verticalRate:
        numberOrUndefined(point[IDX.verticalRateBaro]) ??
        numberOrUndefined(point[IDX.verticalRateGeom]),
      track: numberOrUndefined(point[IDX.track]),
      callsign,
      onGround,
      stale: (flags & FLAG_STALE) !== 0,
      source,
    })
  }

  positions.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  return positions
}

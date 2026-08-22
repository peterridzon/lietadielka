/** Great-circle geometry. Pure functions, no dependencies. */

const EARTH_RADIUS_KM = 6371.0088
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180

export type LatLon = { latitude: number; longitude: number }

/** Great-circle distance in kilometres. */
export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = toRadians(b.latitude - a.latitude)
  const dLon = toRadians(b.longitude - a.longitude)
  const lat1 = toRadians(a.latitude)
  const lat2 = toRadians(b.latitude)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Initial bearing from a to b, in degrees true. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const lat1 = toRadians(a.latitude)
  const lat2 = toRadians(b.latitude)
  const dLon = toRadians(b.longitude - a.longitude)
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return (Math.atan2(y, x) * 180) / Math.PI
}

/** Summed great-circle length of a polyline. */
export function pathLengthKm(points: LatLon[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += haversineKm(points[i - 1]!, points[i]!)
  return total
}

export const KM_PER_NAUTICAL_MILE = 1.852

/** Implied ground speed in knots between two fixes. Infinity when they share a timestamp. */
export function impliedSpeedKt(a: LatLon & { timestamp: Date }, b: LatLon & { timestamp: Date }): number {
  const hours = Math.abs(b.timestamp.getTime() - a.timestamp.getTime()) / 3_600_000
  if (hours === 0) return Number.POSITIVE_INFINITY
  return haversineKm(a, b) / KM_PER_NAUTICAL_MILE / hours
}

/** Ramer–Douglas–Peucker simplification, tolerance in kilometres. */
export function simplifyPath<T extends LatLon>(points: T[], toleranceKm: number): T[] {
  if (points.length <= 2) return [...points]

  const first = points[0]!
  const last = points[points.length - 1]!
  let maxDistance = 0
  let index = 0

  for (let i = 1; i < points.length - 1; i++) {
    const distance = perpendicularDistanceKm(points[i]!, first, last)
    if (distance > maxDistance) {
      maxDistance = distance
      index = i
    }
  }

  if (maxDistance <= toleranceKm) return [first, last]

  const left = simplifyPath(points.slice(0, index + 1), toleranceKm)
  const right = simplifyPath(points.slice(index), toleranceKm)
  return [...left.slice(0, -1), ...right]
}

/** Cross-track distance of `point` from the segment start→end, in km. */
function perpendicularDistanceKm(point: LatLon, start: LatLon, end: LatLon): number {
  // Equirectangular projection is accurate enough at the scale of a single leg.
  const latRef = toRadians((start.latitude + end.latitude) / 2)
  const project = (p: LatLon): [number, number] => [
    toRadians(p.longitude) * Math.cos(latRef) * EARTH_RADIUS_KM,
    toRadians(p.latitude) * EARTH_RADIUS_KM,
  ]
  const [px, py] = project(point)
  const [ax, ay] = project(start)
  const [bx, by] = project(end)

  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay)

  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

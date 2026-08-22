import { haversineKm, type LatLon } from '../geo.js'

export type AirportRecord = {
  id: string
  ident: string
  icao: string | null
  iata: string | null
  name: string
  city: string | null
  country: string | null
  latitude: number
  longitude: number
  elevationFt: number | null
  type: string
  scheduledService: boolean
}

/**
 * A 1°×1° bucket index over the airport table.
 *
 * ~86k airports is small enough to hold in memory, and a nearest-airport query is a
 * scan of at most nine buckets. This is why the project does not need PostGIS.
 */
export class AirportIndex {
  private readonly buckets = new Map<string, AirportRecord[]>()
  /** Field elevation is looked up once per fix during classification; memoise it. */
  private readonly elevationCache = new Map<string, number | null>()

  constructor(airports: Iterable<AirportRecord>) {
    for (const airport of airports) {
      const key = bucketKey(airport.latitude, airport.longitude)
      const bucket = this.buckets.get(key)
      if (bucket) bucket.push(airport)
      else this.buckets.set(key, [airport])
    }
  }

  /** Every airport within `radiusKm`, nearest first. */
  near(point: LatLon, radiusKm: number): { airport: AirportRecord; distanceKm: number }[] {
    // One bucket is ~111 km tall, so widen the sweep for radii beyond that.
    const span = Math.max(1, Math.ceil(radiusKm / 100))
    const latIndex = Math.floor(point.latitude)
    const lonIndex = Math.floor(point.longitude)
    const found: { airport: AirportRecord; distanceKm: number }[] = []

    for (let dLat = -span; dLat <= span; dLat++) {
      for (let dLon = -span; dLon <= span; dLon++) {
        const bucket = this.buckets.get(`${latIndex + dLat}/${wrapLongitude(lonIndex + dLon)}`)
        if (!bucket) continue
        for (const airport of bucket) {
          const distanceKm = haversineKm(point, airport)
          if (distanceKm <= radiusKm) found.push({ airport, distanceKm })
        }
      }
    }

    found.sort((a, b) => a.distanceKm - b.distanceKm)
    return found
  }

  /**
   * Field elevation in feet at a point, from the nearest airport within 15 km.
   *
   * Cached on a ~1 km grid: terrain elevation is only used to decide whether a fix is
   * near the ground, which does not need metre precision, and the detector calls this
   * once per fix.
   */
  elevationAt(latitude: number, longitude: number): number | null {
    const key = `${latitude.toFixed(2)}/${longitude.toFixed(2)}`
    const cached = this.elevationCache.get(key)
    if (cached !== undefined) return cached
    const nearest = this.near({ latitude, longitude }, 15)[0]
    const elevation = nearest?.airport.elevationFt ?? null
    this.elevationCache.set(key, elevation)
    return elevation
  }

  get size(): number {
    let total = 0
    for (const bucket of this.buckets.values()) total += bucket.length
    return total
  }
}

function bucketKey(latitude: number, longitude: number): string {
  return `${Math.floor(latitude)}/${Math.floor(longitude)}`
}

function wrapLongitude(index: number): number {
  if (index > 180) return index - 360
  if (index < -180) return index + 360
  return index
}

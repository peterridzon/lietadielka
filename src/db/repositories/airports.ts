import { AirportIndex, type AirportRecord } from '../../core/airports/spatial-index.js'
import { getDb } from '../client.js'
import { airport } from '../schema.js'

let cached: AirportIndex | null = null

/** Loads the airport table into an in-memory index once per process. */
export async function getAirportIndex(): Promise<AirportIndex> {
  if (cached) return cached
  const { db } = await getDb()
  const rows = await db
    .select({
      id: airport.id,
      ident: airport.ident,
      icao: airport.icao,
      iata: airport.iata,
      name: airport.name,
      city: airport.city,
      country: airport.country,
      latitude: airport.latitude,
      longitude: airport.longitude,
      elevationFt: airport.elevationFt,
      type: airport.type,
      scheduledService: airport.scheduledService,
    })
    .from(airport)

  if (rows.length === 0) {
    throw new Error('airport table is empty — run "npm run airports:import" first')
  }
  cached = new AirportIndex(rows as AirportRecord[])
  return cached
}

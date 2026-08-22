import { eq, or, sql } from 'drizzle-orm'
import { getDb } from '../client.js'
import { aircraft, type Aircraft } from '../schema.js'

/** Resolves an aircraft by ICAO 24-bit address or by registration, case-insensitively. */
export async function findAircraft(identifier: string): Promise<Aircraft | undefined> {
  const { db } = await getDb()
  const needle = identifier.trim()
  const rows = await db
    .select()
    .from(aircraft)
    .where(
      or(
        eq(aircraft.icao24, needle.toLowerCase()),
        sql`upper(${aircraft.registration}) = ${needle.toUpperCase()}`,
        eq(aircraft.id, needle),
      ),
    )
    .limit(1)
  return rows[0]
}

export async function listTrackedAircraft(): Promise<Aircraft[]> {
  const { db } = await getDb()
  return db.select().from(aircraft).where(eq(aircraft.trackingEnabled, true)).orderBy(aircraft.registration)
}

export async function requireAircraft(identifier: string): Promise<Aircraft> {
  const found = await findAircraft(identifier)
  if (!found) {
    throw new Error(
      `Aircraft "${identifier}" is not in the registry. Only aircraft in data/aircraft.seed.json ` +
        `are ever imported — add it there with a source, then run "npm run seed".`,
    )
  }
  return found
}

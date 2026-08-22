import { eq, or, sql } from 'drizzle-orm'
import { isCurrentlyActive, shouldPoll } from '../../core/fleet.js'
import { getDb } from '../client.js'
import { aircraft, type Aircraft } from '../schema.js'

/**
 * Resolves an aircraft, in order of how reliably each identifier names an airframe:
 * ICAO 24-bit address, then registration (civil mark or military evidence number),
 * then MSN, then a previous registration.
 *
 * Callsigns are deliberately absent. One airframe uses several over its life and even
 * within a week, so a callsign identifies a flight, never an aircraft.
 */
export async function findAircraft(identifier: string): Promise<Aircraft | undefined> {
  const { db } = await getDb()
  const needle = identifier.trim()
  const upper = needle.toUpperCase()

  const rows = await db
    .select()
    .from(aircraft)
    .where(
      or(
        eq(aircraft.icao24, needle.toLowerCase()),
        sql`upper(${aircraft.registration}) = ${upper}`,
        sql`upper(${aircraft.msn}) = ${upper}`,
        eq(aircraft.id, needle),
      ),
    )
    .limit(1)
  if (rows[0]) return rows[0]

  // Previous marks are a research aid, so they resolve last and only on an exact match.
  const all = await db.select().from(aircraft)
  return all.find((row) => {
    const previous = (row.previousRegistrations as string[] | null) ?? []
    return previous.some((mark) => mark.toUpperCase() === upper)
  })
}

/**
 * Aircraft the collector should be polling: tracked, and part of the fleet today.
 *
 * A withdrawn aircraft is deliberately absent. Asking a provider about an airframe that
 * has not flown since February 2025 wastes the rate limit and, worse, records a run of
 * "no flights" days that read as a quiet fleet rather than a retired one.
 */
export async function listTrackedAircraft(now: Date = new Date()): Promise<Aircraft[]> {
  const { db } = await getDb()
  const rows = await db.select().from(aircraft).orderBy(aircraft.registration)
  return rows.filter((row) => shouldPoll(row, now))
}

/** The fleet as it stands today, whether or not each aircraft is being polled. */
export async function listCurrentFleet(now: Date = new Date()): Promise<Aircraft[]> {
  const { db } = await getDb()
  const rows = await db.select().from(aircraft).orderBy(aircraft.registration)
  return rows.filter((row) => isCurrentlyActive(row, now))
}

/** Everything ever registered, including withdrawn aircraft. For historical analysis. */
export async function listAllAircraft(): Promise<Aircraft[]> {
  const { db } = await getDb()
  return db.select().from(aircraft).orderBy(aircraft.registration)
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

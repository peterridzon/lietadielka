/**
 * Flight queries.
 *
 * The publication gate is expressed here once, as a SQL predicate, so that no caller
 * has to remember to apply it. Anything reaching a public reader must go through
 * `publishedOnly()`; see SECURITY.md.
 */
import { and, asc, eq, isNotNull, lte, type SQL } from 'drizzle-orm'
import { getDb } from '../client.js'
import { flight, type FlightRow } from '../schema.js'
import { env } from '../../lib/env.js'

/**
 * SQL form of `isPublishable()` from core/publication.ts: the flight has ended and the
 * publication delay has elapsed. `published_at` is materialised at write time as
 * arrival + PUBLICATION_DELAY_HOURS, and is NULL while a flight has no arrival at all.
 */
export function publishedOnly(now: Date = new Date()): SQL {
  return and(isNotNull(flight.publishedAt), lte(flight.publishedAt, now)) as SQL
}

export type FlightQuery = {
  aircraftId?: string
  /** Default true. Only set false for internal tooling that says so on screen. */
  publicOnly?: boolean
  now?: Date
  limit?: number
}

export async function listFlights(query: FlightQuery = {}): Promise<FlightRow[]> {
  const { db } = await getDb()
  const filters: SQL[] = []
  if (query.aircraftId) filters.push(eq(flight.aircraftId, query.aircraftId))
  if (query.publicOnly !== false) filters.push(publishedOnly(query.now))

  return db
    .select()
    .from(flight)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(asc(flight.departureTime))
    .limit(query.limit ?? 200)
}

/**
 * The delay currently in force. Exposed so the methodology page and the CLI report the
 * same number the gate actually uses, rather than a hardcoded 6.
 */
export function publicationDelayHours(): number {
  return env.publicationDelayHours
}

/**
 * Brief §45, at the layer that will back the public API.
 *
 * core/publication.ts is unit-tested in isolation; this exercises the SQL predicate the
 * database actually applies, against a real (embedded) PostgreSQL, because that is the
 * gate a leak would have to get past.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const NOW = new Date('2026-08-17T18:00:00Z')
let dir: string

// The db client reads its configuration from the environment at import time, so the
// temporary database has to be in place before anything imports it.
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'lietadielka-db-'))
  delete process.env.DATABASE_URL
  process.env.PGLITE_PATH = join(dir, 'pglite')
  process.env.PUBLICATION_DELAY_HOURS = '6'

  const { getDb } = await import('../src/db/client.js')
  const { db } = await getDb()
  const { migrate } = await import('drizzle-orm/pglite/migrator')
  await migrate(db as never, { migrationsFolder: './drizzle' })

  const { aircraft, flight } = await import('../src/db/schema.js')
  await db.insert(aircraft).values({
    id: 'ac-test',
    icao24: 'aaaaaa',
    registration: 'OM-TEST',
    category: 'government',
    trackingEnabled: true,
  })

  // Distinct departure times: (aircraft_id, departure_time) is unique, which is what
  // keeps a rebuild from duplicating a flight.
  const base = { aircraftId: 'ac-test', dataSource: 'test', detectorVersion: 'test' }

  await db.insert(flight).values([
    {
      ...base,
      id: 'f-in-progress',
      publicId: 'in-progress',
      departureTime: new Date('2026-08-17T16:00:00Z'),
      // Still airborne: no arrival, therefore no publication instant at all.
      arrivalTime: null,
      publishedAt: null,
    },
    {
      ...base,
      id: 'f-just-landed',
      publicId: 'just-landed',
      departureTime: new Date('2026-08-17T15:00:00Z'),
      arrivalTime: new Date('2026-08-17T17:30:00Z'),
      publishedAt: new Date('2026-08-17T23:30:00Z'),
    },
    {
      ...base,
      id: 'f-old-enough',
      publicId: 'old-enough',
      departureTime: new Date('2026-08-17T08:00:00Z'),
      arrivalTime: new Date('2026-08-17T09:21:00Z'),
      publishedAt: new Date('2026-08-17T15:21:00Z'),
    },
  ])
})

afterAll(async () => {
  const { closeDb } = await import('../src/db/client.js')
  await closeDb()
  rmSync(dir, { recursive: true, force: true })
})

describe('publication gate at the database layer', () => {
  it('hides a flight that is still in progress', async () => {
    const { listFlights } = await import('../src/db/repositories/flights.js')
    const ids = (await listFlights({ now: NOW })).map((row) => row.id)
    expect(ids).not.toContain('f-in-progress')
  })

  it('hides a flight that landed less than the delay ago', async () => {
    const { listFlights } = await import('../src/db/repositories/flights.js')
    const ids = (await listFlights({ now: NOW })).map((row) => row.id)
    expect(ids).not.toContain('f-just-landed')
  })

  it('shows only the flight that is past the delay', async () => {
    const { listFlights } = await import('../src/db/repositories/flights.js')
    const ids = (await listFlights({ now: NOW })).map((row) => row.id)
    expect(ids).toEqual(['f-old-enough'])
  })

  it('defaults to the public view when publicOnly is not specified', async () => {
    const { listFlights } = await import('../src/db/repositories/flights.js')
    const withoutFlag = await listFlights({ now: NOW })
    const explicit = await listFlights({ now: NOW, publicOnly: true })
    expect(withoutFlag.map((r) => r.id)).toEqual(explicit.map((r) => r.id))
  })

  it('only reveals the withheld flights when internal access is asked for explicitly', async () => {
    const { listFlights } = await import('../src/db/repositories/flights.js')
    const internal = await listFlights({ now: NOW, publicOnly: false })
    expect(internal).toHaveLength(3)
  })
})

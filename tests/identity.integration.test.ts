/**
 * Aircraft identity resolution, against a real database.
 *
 * Acceptance cases from the fleet correction: a Mode-S record must resolve by its ICAO
 * address alone, and a callsign must never be able to name an airframe. One Slovak Air
 * Force Global 5000 has been observed using SQF901, SQF902 and SQF911; the other has
 * also used SQF901. Any mapping from callsign to aircraft would therefore be wrong.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let dir: string

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'lietadielka-id-'))
  delete process.env.DATABASE_URL
  process.env.PGLITE_PATH = join(dir, 'pglite')

  const { getDb } = await import('../src/db/client.js')
  const { db } = await getDb()
  const { migrate } = await import('drizzle-orm/pglite/migrator')
  await migrate(db as never, { migrationsFolder: './drizzle' })

  const { aircraft, operatorOrganisation } = await import('../src/db/schema.js')
  await db.insert(operatorOrganisation).values([
    { id: 'sk-state-air-transport', name: 'SK state air transport' },
    { id: 'lu-mvsr', name: 'LU MV SR', parentId: 'sk-state-air-transport' },
    { id: 'os-sr', name: 'Slovak Air Force', parentId: 'sk-state-air-transport' },
  ])
  await db.insert(aircraft).values([
    {
      id: 'ac-om-bya', icao24: '505c06', registration: 'OM-BYA', registrationType: 'civil',
      typeCode: 'A319', category: 'government', operatorId: 'lu-mvsr',
      fleetKey: 'lu-mvsr-fixedwing', status: 'active', trackingEnabled: true,
    },
    {
      id: 'ac-om-byc', icao24: '505c08', registration: 'OM-BYC', registrationType: 'civil',
      typeCode: 'F100', category: 'government', operatorId: 'lu-mvsr',
      fleetKey: 'lu-mvsr-fixedwing', status: 'retired', activeUntil: '2025-02-11',
      trackingEnabled: false,
    },
    {
      id: 'ac-9513', icao24: '505fa0', registration: '9513', registrationType: 'military',
      msn: '9513', previousRegistrations: ['C-FDIL', 'C-FMPX', 'C-GPYF'],
      typeCode: 'GL5T', model: 'Global 5000', category: 'ministry_of_defence',
      operatorId: 'os-sr', fleetKey: 'os-sr-global5000', status: 'active', trackingEnabled: true,
    },
    {
      id: 'ac-9633', icao24: '505fa1', registration: '9633', registrationType: 'military',
      msn: '9633', previousRegistrations: ['T7-AVA', '9H-AVA', 'M-DANK', 'C-GYOF'],
      typeCode: 'GL5T', model: 'Global 5000', category: 'ministry_of_defence',
      operatorId: 'os-sr', fleetKey: 'os-sr-global5000', status: 'active', trackingEnabled: true,
    },
  ])
})

afterAll(async () => {
  const { closeDb } = await import('../src/db/client.js')
  await closeDb()
  rmSync(dir, { recursive: true, force: true })
})

describe('identity by ICAO address', () => {
  it('resolves 505fa0 to 9513, a Global 5000', async () => {
    const { findAircraft } = await import('../src/db/repositories/aircraft.js')
    const found = await findAircraft('505fa0')
    expect(found?.registration).toBe('9513')
    expect(found?.model).toBe('Global 5000')
    expect(found?.typeCode).toBe('GL5T')
  })

  it('resolves 505fa1 to 9633', async () => {
    const { findAircraft } = await import('../src/db/repositories/aircraft.js')
    expect((await findAircraft('505fa1'))?.registration).toBe('9633')
  })

  it('is case-insensitive about the address', async () => {
    const { findAircraft } = await import('../src/db/repositories/aircraft.js')
    expect((await findAircraft('505FA0'))?.registration).toBe('9513')
  })
})

describe('identity without a civil mark', () => {
  it('resolves a military evidence number', async () => {
    const { findAircraft } = await import('../src/db/repositories/aircraft.js')
    const found = await findAircraft('9513')
    expect(found?.icao24).toBe('505fa0')
    expect(found?.registrationType).toBe('military')
  })

  it('resolves an MSN', async () => {
    const { findAircraft } = await import('../src/db/repositories/aircraft.js')
    expect((await findAircraft('9633'))?.icao24).toBe('505fa1')
  })

  it('resolves a previous registration, as a research aid', async () => {
    const { findAircraft } = await import('../src/db/repositories/aircraft.js')
    expect((await findAircraft('9H-AVA'))?.registration).toBe('9633')
    expect((await findAircraft('C-FDIL'))?.registration).toBe('9513')
  })
})

describe('callsigns never name an aircraft', () => {
  // SQF901 has been observed on both airframes. If a callsign could resolve an aircraft,
  // one of these lookups would be confidently wrong.
  it.each(['SQF901', 'SQF902', 'SQF911', 'SQF003', 'SQF002'])('does not resolve %s', async (callsign) => {
    const { findAircraft } = await import('../src/db/repositories/aircraft.js')
    expect(await findAircraft(callsign)).toBeUndefined()
  })
})

describe('fleet separation', () => {
  it('keeps the Air Force out of the Ministry of Interior fleet', async () => {
    const { findAircraft } = await import('../src/db/repositories/aircraft.js')
    const global5000 = await findAircraft('505fa0')
    const a319 = await findAircraft('505c06')
    expect(global5000?.fleetKey).not.toBe(a319?.fleetKey)
    expect(global5000?.operatorId).toBe('os-sr')
    expect(a319?.operatorId).toBe('lu-mvsr')
    expect(global5000?.category).toBe('ministry_of_defence')
  })

  it('polls the current fleet and leaves the withdrawn aircraft alone', async () => {
    const { listTrackedAircraft, listCurrentFleet, listAllAircraft } = await import(
      '../src/db/repositories/aircraft.js'
    )
    const now = new Date('2026-08-22T00:00:00Z')
    const tracked = (await listTrackedAircraft(now)).map((a) => a.registration)
    expect(tracked).toEqual(['9513', '9633', 'OM-BYA'])
    expect(tracked).not.toContain('OM-BYC')

    expect((await listCurrentFleet(now)).map((a) => a.registration)).not.toContain('OM-BYC')
    // The registry still holds it, so its history stays attributable.
    expect((await listAllAircraft()).map((a) => a.registration)).toContain('OM-BYC')
  })
})

import { describe, expect, it } from 'vitest'
import { matchAirport } from '../src/core/airports/match.js'
import { AirportIndex, type AirportRecord } from '../src/core/airports/spatial-index.js'

function airport(overrides: Partial<AirportRecord> & { id: string; latitude: number; longitude: number }): AirportRecord {
  return {
    ident: overrides.id,
    icao: overrides.id.length === 4 ? overrides.id : null,
    iata: null,
    name: overrides.id,
    city: null,
    country: 'SK',
    elevationFt: 400,
    type: 'large_airport',
    scheduledService: true,
    ...overrides,
  }
}

const LZIB = airport({ id: 'LZIB', latitude: 48.1702, longitude: 17.2127, elevationFt: 436 })
const VAJNORY = airport({
  id: 'SK-0098',
  latitude: 48.2, longitude: 17.2, type: 'closed', elevationFt: 420, scheduledService: false,
})
const HELIPORT = airport({
  id: 'SK-HELI', latitude: 48.172, longitude: 17.215, type: 'heliport', elevationFt: 436, scheduledService: false,
})
const TWIN_A = airport({ id: 'AA', latitude: 48.0, longitude: 17.0, type: 'medium_airport' })
const TWIN_B = airport({ id: 'BB', latitude: 48.02, longitude: 17.0, type: 'medium_airport' })

describe('AirportIndex', () => {
  const index = new AirportIndex([LZIB, VAJNORY, HELIPORT])

  it('finds airports within the radius, nearest first', () => {
    const found = index.near({ latitude: 48.1702, longitude: 17.2127 }, 10)
    expect(found[0]!.airport.id).toBe('LZIB')
    expect(found.length).toBeGreaterThan(1)
  })

  it('returns nothing in the middle of the ocean', () => {
    expect(index.near({ latitude: 30, longitude: -40 }, 25)).toHaveLength(0)
  })

  it('reports field elevation from the nearest aerodrome', () => {
    expect(index.elevationAt(48.171, 17.213)).toBe(436)
    expect(index.elevationAt(30, -40)).toBeNull()
  })
})

describe('matchAirport', () => {
  const index = new AirportIndex([LZIB, VAJNORY, HELIPORT])

  it('identifies the airport from a fix on the ground', () => {
    const match = matchAirport(index, {
      latitude: 48.167, longitude: 17.198, onGround: true, altitudeAglFt: 0,
    })
    expect(match.airport?.id).toBe('LZIB')
    expect(match.confidence).toBeGreaterThan(0.9)
  })

  it('does not penalise a stand a kilometre from the reference point', () => {
    // The reference point of a large airport sits well away from the stands, and an
    // aircraft parked inside the perimeter is not a less certain match for it.
    const atReference = matchAirport(index, {
      latitude: 48.1702, longitude: 17.2127, onGround: true, altitudeAglFt: 0,
    })
    const atStand = matchAirport(index, {
      latitude: 48.167, longitude: 17.198, onGround: true, altitudeAglFt: 0,
    })
    expect(atStand.confidence).toBeCloseTo(atReference.confidence, 3)
  })

  it('accepts an airborne fix that is plainly on the runway', () => {
    // 150 ft below field elevation, 2 km out. A flat ceiling used to throw this away.
    const match = matchAirport(index, {
      latitude: 48.167, longitude: 17.198, onGround: false, altitudeAglFt: -150,
    })
    expect(match.airport?.id).toBe('LZIB')
    expect(match.confidence).toBeGreaterThan(0.5)
    expect(match.explanation).toMatch(/landing itself was not observed/)
  })

  it('scales confidence down as the fix gets higher', () => {
    const at = (aglFt: number) =>
      matchAirport(index, { latitude: 48.167, longitude: 17.198, onGround: false, altitudeAglFt: aglFt })
        .confidence
    expect(at(300)).toBeGreaterThan(at(1000))
    expect(at(1000)).toBeGreaterThan(at(2500))
    expect(at(2500)).toBeGreaterThan(at(5000))
  })

  it('still refuses a fix in the circuit as a certainty', () => {
    const match = matchAirport(index, {
      latitude: 48.167, longitude: 17.198, onGround: false, altitudeAglFt: 5000,
    })
    expect(match.confidence).toBeLessThan(0.5)
    expect(match.airport).toBeNull()
    expect(match.probable?.id).toBe('LZIB')
  })

  it('refuses to name an airport under a cruising aircraft', () => {
    // Brief §7: nearest is not the same as correct. A track that ends at 35 000 ft
    // tells us nothing about a destination.
    const match = matchAirport(index, {
      latitude: 48.167, longitude: 17.198, onGround: false, altitudeAglFt: 34_500,
    })
    expect(match.airport).toBeNull()
    expect(match.probable).toBeNull()
    expect(match.confidence).toBe(0)
    expect(match.explanation).toMatch(/still cruising/)
  })

  it('reduces confidence when two aerodromes are equally plausible', () => {
    const ambiguous = new AirportIndex([TWIN_A, TWIN_B])
    const match = matchAirport(ambiguous, {
      latitude: 48.01, longitude: 17.0, onGround: true, altitudeAglFt: 0,
    })
    expect(match.confidence).toBeLessThan(0.5)
    expect(match.airport).toBeNull()
    expect(match.explanation).toMatch(/comparable candidate/)
  })

  it('prefers a heliport for a helicopter and an airport for an aeroplane', () => {
    const onlyHeli = new AirportIndex([HELIPORT])
    const fixedWing = matchAirport(onlyHeli, {
      latitude: 48.172, longitude: 17.215, onGround: true, altitudeAglFt: 0,
    })
    const rotorcraft = matchAirport(
      onlyHeli,
      { latitude: 48.172, longitude: 17.215, onGround: true, altitudeAglFt: 0 },
      { isRotorcraft: true },
    )
    expect(rotorcraft.confidence).toBeGreaterThan(fixedWing.confidence)
  })

  it('returns no airport at all when nothing is nearby', () => {
    const match = matchAirport(index, {
      latitude: 30, longitude: -40, onGround: true, altitudeAglFt: 0,
    })
    expect(match.airport).toBeNull()
    expect(match.probable).toBeNull()
    expect(match.explanation).toMatch(/no airport within/)
  })
})

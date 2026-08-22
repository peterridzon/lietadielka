import { describe, expect, it } from 'vitest'
import { bearingDeg, haversineKm, impliedSpeedKt, pathLengthKm, simplifyPath } from '../src/core/geo.js'

describe('haversineKm', () => {
  it('matches the published great-circle distance Bratislava to Brussels', () => {
    // LZIB 48.1702 N 17.2127 E, EBBR 50.9014 N 4.4844 E — about 960 km.
    const distance = haversineKm(
      { latitude: 48.1702, longitude: 17.2127 },
      { latitude: 50.9014, longitude: 4.4844 },
    )
    expect(distance).toBeGreaterThan(950)
    expect(distance).toBeLessThan(975)
  })

  it('is zero for identical points and symmetric otherwise', () => {
    const a = { latitude: 48.17, longitude: 17.21 }
    const b = { latitude: 50.1, longitude: 14.26 }
    expect(haversineKm(a, a)).toBe(0)
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9)
  })

  it('handles the antimeridian without a discontinuity', () => {
    const distance = haversineKm(
      { latitude: 0, longitude: 179.9 },
      { latitude: 0, longitude: -179.9 },
    )
    expect(distance).toBeLessThan(25)
  })
})

describe('bearingDeg', () => {
  it('points due north and due east correctly', () => {
    expect(bearingDeg({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 })).toBeCloseTo(0, 5)
    expect(bearingDeg({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })).toBeCloseTo(90, 5)
  })
})

describe('pathLengthKm', () => {
  it('sums the legs of a polyline', () => {
    const points = [
      { latitude: 48, longitude: 17 },
      { latitude: 49, longitude: 17 },
      { latitude: 50, longitude: 17 },
    ]
    expect(pathLengthKm(points)).toBeCloseTo(2 * haversineKm(points[0]!, points[1]!), 6)
  })

  it('is zero for fewer than two points', () => {
    expect(pathLengthKm([])).toBe(0)
    expect(pathLengthKm([{ latitude: 1, longitude: 1 }])).toBe(0)
  })
})

describe('impliedSpeedKt', () => {
  it('computes a realistic cruise speed', () => {
    const speed = impliedSpeedKt(
      { latitude: 48, longitude: 17, timestamp: new Date('2026-03-12T06:00:00Z') },
      { latitude: 48, longitude: 19, timestamp: new Date('2026-03-12T06:15:00Z') },
    )
    expect(speed).toBeGreaterThan(250)
    expect(speed).toBeLessThan(350)
  })
})

describe('simplifyPath', () => {
  it('collapses a straight line to its endpoints', () => {
    const straight = Array.from({ length: 50 }, (_, i) => ({ latitude: 48 + i * 0.01, longitude: 17 }))
    expect(simplifyPath(straight, 0.5)).toHaveLength(2)
  })

  it('keeps a corner that exceeds the tolerance', () => {
    const corner = [
      { latitude: 48, longitude: 17 },
      { latitude: 48.5, longitude: 18 },
      { latitude: 48, longitude: 19 },
    ]
    expect(simplifyPath(corner, 0.5)).toHaveLength(3)
  })
})

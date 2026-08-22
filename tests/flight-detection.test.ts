import { describe, expect, it } from 'vitest'
import { detectFlights } from '../src/core/flight-detection/index.js'
import { normaliseStream, segmentPositions } from '../src/core/flight-detection/segmentation.js'
import { DEFAULT_DETECTION_CONFIG } from '../src/core/flight-detection/config.js'
import { leg, loadFixture, LKPR, LZIB, point } from './helpers.js'

/** A complete out-and-back: 10 min on stand, 40 min airborne, 10 min on stand. */
function simpleFlight(): ReturnType<typeof leg> {
  return [
    ...leg({ fromT: 0, toT: 600, count: 20, from: LZIB, to: LZIB, altitude: 'ground', groundSpeed: 5 }),
    ...leg({ fromT: 660, toT: 900, count: 20, from: LZIB, to: [48.6, 16.8], altitude: 12_000, groundSpeed: 300 }),
    ...leg({ fromT: 960, toT: 2_700, count: 60, from: [48.6, 16.8], to: [49.8, 14.6], altitude: 33_000, groundSpeed: 450 }),
    ...leg({ fromT: 2_760, toT: 3_000, count: 20, from: [49.8, 14.6], to: LKPR, altitude: 6_000, groundSpeed: 250 }),
    ...leg({ fromT: 3_060, toT: 3_660, count: 20, from: LKPR, to: LKPR, altitude: 'ground', groundSpeed: 5 }),
  ]
}

describe('segmentPositions', () => {
  it('keeps one continuous track together', () => {
    expect(segmentPositions(simpleFlight(), DEFAULT_DETECTION_CONFIG)).toHaveLength(1)
  })

  it('does not split on coordinate noise between rapid fixes', () => {
    // ADS-B broadcasts airborne positions at about 2 Hz. Rounding alone then produces
    // absurd implied speeds; splitting on those shreds a perfectly good track.
    const jittery = [
      point(0, { latitude: 44.3794, longitude: 27.2666, altitudeBaro: 35_000, groundSpeed: 511 }),
      point(0.43, { latitude: 44.3787, longitude: 27.2683, altitudeBaro: 35_000, groundSpeed: 511 }),
      point(0.86, { latitude: 44.3781, longitude: 27.2694, altitudeBaro: 35_000, groundSpeed: 511 }),
    ]
    expect(segmentPositions(jittery, DEFAULT_DETECTION_CONFIG)).toHaveLength(1)
  })

  it('splits when two fixes are physically unreachable across a real gap', () => {
    const teleport = [
      point(0, { latitude: 48.17, longitude: 17.21, altitudeBaro: 35_000, groundSpeed: 450 }),
      point(120, { latitude: 40.64, longitude: -73.78, altitudeBaro: 35_000, groundSpeed: 450 }),
    ]
    expect(segmentPositions(teleport, DEFAULT_DETECTION_CONFIG)).toHaveLength(2)
  })

  it('splits on a gap longer than any single flight', () => {
    const twoDays = [
      point(0, { latitude: 48.17, longitude: 17.21, onGround: true, groundSpeed: 2 }),
      point(7 * 3_600, { latitude: 48.17, longitude: 17.21, onGround: true, groundSpeed: 2 }),
    ]
    expect(segmentPositions(twoDays, DEFAULT_DETECTION_CONFIG)).toHaveLength(2)
  })
})

describe('normaliseStream', () => {
  it('sorts and removes duplicate timestamps', () => {
    const messy = [
      point(10, { latitude: 1, longitude: 1 }),
      point(0, { latitude: 0, longitude: 0 }),
      point(10, { latitude: 1, longitude: 1 }),
    ]
    const clean = normaliseStream(messy)
    expect(clean).toHaveLength(2)
    expect(clean[0]!.timestamp.getTime()).toBeLessThan(clean[1]!.timestamp.getTime())
  })
})

describe('detectFlights — takeoff and landing', () => {
  const [flight] = detectFlights(simpleFlight())

  it('finds exactly one flight', () => {
    expect(detectFlights(simpleFlight())).toHaveLength(1)
  })

  it('takes the departure from the last fix on the ground, not the first airborne one', () => {
    expect(flight!.departureTimeEstimated).toBe(false)
    // Last ground fix is at t=600, first airborne at t=660.
    expect(flight!.departureTime.toISOString()).toBe('2026-03-12T06:10:00.000Z')
  })

  it('takes the arrival from the first fix back on the ground', () => {
    expect(flight!.arrivalTimeEstimated).toBe(false)
    expect(flight!.arrivalTime.toISOString()).toBe('2026-03-12T06:51:00.000Z')
    expect(flight!.durationSeconds).toBe(2_460)
  })

  it('anchors both ends on a fix recorded on the ground', () => {
    expect(flight!.departureAnchor.onGround).toBe(true)
    expect(flight!.arrivalAnchor.onGround).toBe(true)
  })

  it('reports full coverage and high route confidence for a dense track', () => {
    expect(flight!.coverage.dataCoverage).toBeGreaterThan(0.95)
    expect(flight!.routeConfidence).toBeGreaterThan(0.9)
  })
})

describe('detectFlights — touch-and-go', () => {
  it('does not end the flight on a brief ground contact', () => {
    const withTouchAndGo = [
      ...leg({ fromT: 0, toT: 600, count: 20, from: LZIB, to: LZIB, altitude: 'ground', groundSpeed: 5 }),
      ...leg({ fromT: 660, toT: 1_100, count: 20, from: LZIB, to: [48.6, 17.6], altitude: 8_000, groundSpeed: 300 }),
      ...leg({ fromT: 1_160, toT: 1_500, count: 20, from: [48.6, 17.6], to: LZIB, altitude: 3_000, groundSpeed: 200 }),
      // 40 seconds on the runway — a touch-and-go, not a landing.
      ...leg({ fromT: 1_540, toT: 1_580, count: 5, from: LZIB, to: LZIB, altitude: 'ground', groundSpeed: 120 }),
      ...leg({ fromT: 1_620, toT: 2_000, count: 20, from: LZIB, to: [48.6, 17.6], altitude: 8_000, groundSpeed: 300 }),
      ...leg({ fromT: 2_060, toT: 2_400, count: 20, from: [48.6, 17.6], to: LZIB, altitude: 3_000, groundSpeed: 200 }),
      ...leg({ fromT: 2_460, toT: 3_200, count: 20, from: LZIB, to: LZIB, altitude: 'ground', groundSpeed: 5 }),
    ]
    const flights = detectFlights(withTouchAndGo)
    expect(flights).toHaveLength(1)
    expect(flights[0]!.touchAndGoCount).toBe(1)
  })

  it('does end the flight when the aircraft actually stops', () => {
    const twoSectors = [
      ...leg({ fromT: 0, toT: 600, count: 20, from: LZIB, to: LZIB, altitude: 'ground', groundSpeed: 5 }),
      ...leg({ fromT: 660, toT: 1_500, count: 30, from: LZIB, to: LKPR, altitude: 20_000, groundSpeed: 400 }),
      // 40 minutes on stand at Prague — a real turnaround, so two separate flights.
      ...leg({ fromT: 1_560, toT: 3_960, count: 40, from: LKPR, to: LKPR, altitude: 'ground', groundSpeed: 3 }),
      ...leg({ fromT: 4_020, toT: 4_900, count: 30, from: LKPR, to: LZIB, altitude: 20_000, groundSpeed: 400 }),
      ...leg({ fromT: 4_960, toT: 5_600, count: 20, from: LZIB, to: LZIB, altitude: 'ground', groundSpeed: 3 }),
    ]
    expect(detectFlights(twoSectors)).toHaveLength(2)
  })
})

describe('detectFlights — coverage gaps', () => {
  it('does not invent a second flight out of a mid-cruise data gap', () => {
    const withGap = [
      ...leg({ fromT: 0, toT: 600, count: 20, from: LZIB, to: LZIB, altitude: 'ground', groundSpeed: 5 }),
      ...leg({ fromT: 660, toT: 2_400, count: 30, from: LZIB, to: [50, 10], altitude: 35_000, groundSpeed: 460 }),
      // 50 minutes with no receiver coverage, then the track resumes at cruise.
      ...leg({ fromT: 5_400, toT: 7_200, count: 30, from: [52, 0], to: LKPR, altitude: 35_000, groundSpeed: 460 }),
      ...leg({ fromT: 7_260, toT: 7_900, count: 20, from: LKPR, to: LKPR, altitude: 'ground', groundSpeed: 3 }),
    ]
    const flights = detectFlights(withGap)
    expect(flights).toHaveLength(1)
    expect(flights[0]!.coverage.gaps.some((gap) => gap.airborne && gap.seconds > 2_000)).toBe(true)
    // The gap must be visible in the numbers rather than smoothed away.
    expect(flights[0]!.coverage.dataCoverage).toBeLessThan(0.7)
    expect(flights[0]!.distanceFromGapsKm).toBeGreaterThan(100)
  })

  it('marks the departure as estimated when the track begins in mid-air', () => {
    const midAir = [
      ...leg({ fromT: 0, toT: 1_800, count: 40, from: [49, 16], to: LKPR, altitude: 30_000, groundSpeed: 440 }),
      ...leg({ fromT: 1_860, toT: 2_500, count: 20, from: LKPR, to: LKPR, altitude: 'ground', groundSpeed: 3 }),
    ]
    const [flight] = detectFlights(midAir)
    expect(flight!.departureTimeEstimated).toBe(true)
    expect(flight!.departureAnchor.onGround).toBe(false)
    expect(flight!.arrivalTimeEstimated).toBe(false)
  })

  it('does not treat a ground fix hours before the climb as a witnessed departure', () => {
    // Parked at Bratislava, coverage lost, reappears airborne five hours later.
    const staleGround = [
      ...leg({ fromT: 0, toT: 600, count: 20, from: LZIB, to: LZIB, altitude: 'ground', groundSpeed: 3 }),
      ...leg({ fromT: 18_000, toT: 21_600, count: 40, from: [45, 22], to: [42, 28], altitude: 35_000, groundSpeed: 460 }),
    ]
    const [flight] = detectFlights(staleGround)
    expect(flight!.departureTimeEstimated).toBe(true)
    // Duration must describe the airborne window, not the five silent hours.
    expect(flight!.durationSeconds).toBeLessThanOrEqual(3_600)
  })
})

describe('detectFlights — noise rejection', () => {
  it('discards ground movement that never becomes a flight', () => {
    const taxiOnly = leg({
      fromT: 0,
      toT: 1_800,
      count: 40,
      from: LZIB,
      to: [48.175, 17.22],
      altitude: 'ground',
      groundSpeed: 15,
    })
    expect(detectFlights(taxiOnly)).toHaveLength(0)
  })

  it('returns nothing for an empty or single-fix stream', () => {
    expect(detectFlights([])).toHaveLength(0)
    expect(detectFlights([point(0, { latitude: 48, longitude: 17 })])).toHaveLength(0)
  })
})

describe('detectFlights — recorded real track', () => {
  const positions = loadFixture('om-bya-2026-07-20-lzib-lkpr')

  it('reconstructs one flight from the real OM-BYA track of 2026-07-20', () => {
    const flights = detectFlights(positions)
    expect(flights).toHaveLength(1)

    const [flight] = flights
    expect(flight!.callsign).toBe('SSG006')
    expect(flight!.departureTimeEstimated).toBe(false)
    expect(flight!.arrivalTimeEstimated).toBe(false)
    // Bratislava to Prague is about 290 km great-circle; the flown track is longer.
    expect(flight!.greatCircleKm).toBeGreaterThan(250)
    expect(flight!.greatCircleKm).toBeLessThan(340)
    expect(flight!.distanceKm).toBeGreaterThan(flight!.greatCircleKm)
    expect(flight!.durationSeconds).toBeGreaterThan(30 * 60)
    expect(flight!.durationSeconds).toBeLessThan(60 * 60)
    expect(flight!.maxAltitudeFt).toBeGreaterThan(20_000)
    // The fixture is subsampled 1:4 to keep the repository small, which stretches the
    // typical interval past the 60 s coverage threshold. On the full trace this is 100 %.
    expect(flight!.coverage.dataCoverage).toBeGreaterThan(0.6)
    expect(flight!.coverage.maxGapSeconds).toBeLessThan(180)
  })
})

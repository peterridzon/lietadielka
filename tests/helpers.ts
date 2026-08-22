import { readFileSync } from 'node:fs'
import type { AdsbPosition } from '../src/core/types.js'

const BASE = new Date('2026-03-12T06:00:00Z').getTime()

/** Builds a synthetic fix. `t` is seconds after a fixed base instant. */
export function point(
  t: number,
  overrides: Partial<AdsbPosition> & { latitude: number; longitude: number },
): AdsbPosition {
  return {
    aircraftIcao24: 'test01',
    timestamp: new Date(BASE + t * 1000),
    source: 'test',
    ...overrides,
  }
}

/** A straight leg of `count` fixes, interpolating position and altitude. */
export function leg(options: {
  fromT: number
  toT: number
  count: number
  from: [number, number]
  to: [number, number]
  altitude: number | 'ground'
  groundSpeed: number
}): AdsbPosition[] {
  const out: AdsbPosition[] = []
  for (let i = 0; i < options.count; i++) {
    const f = options.count === 1 ? 0 : i / (options.count - 1)
    out.push(
      point(options.fromT + f * (options.toT - options.fromT), {
        latitude: options.from[0] + f * (options.to[0] - options.from[0]),
        longitude: options.from[1] + f * (options.to[1] - options.from[1]),
        altitudeBaro: options.altitude === 'ground' ? undefined : options.altitude,
        onGround: options.altitude === 'ground',
        groundSpeed: options.groundSpeed,
      }),
    )
  }
  return out
}

export const LZIB: [number, number] = [48.1702, 17.2127]
export const LKPR: [number, number] = [50.1008, 14.26]

type FixtureRow = {
  t: string
  lat: number
  lon: number
  alt: number | null
  gs: number | null
  vr: number | null
  og: boolean | null
  cs: string | null
}

/** Loads a recorded real-world ADS-B track from tests/fixtures. */
export function loadFixture(name: string): AdsbPosition[] {
  const file = JSON.parse(readFileSync(`tests/fixtures/${name}.json`, 'utf8')) as {
    positions: FixtureRow[]
  }
  return file.positions.map((row) => ({
    aircraftIcao24: '505c06',
    timestamp: new Date(row.t),
    latitude: row.lat,
    longitude: row.lon,
    altitudeBaro: row.alt ?? undefined,
    groundSpeed: row.gs ?? undefined,
    verticalRate: row.vr ?? undefined,
    onGround: row.og ?? undefined,
    callsign: row.cs ?? undefined,
    source: 'adsblol',
  }))
}

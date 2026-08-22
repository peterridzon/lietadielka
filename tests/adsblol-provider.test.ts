/**
 * The readsb trace format is positional and undocumented in the response itself, so a
 * decoding mistake is silent and corrupts everything downstream. These tests pin the
 * layout against a handcrafted file and against a real recorded response.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { beforeAll, describe, expect, it } from 'vitest'
import { AdsbLolProvider } from '../src/adsb/providers/adsblol.js'

const DAY = new Date('2026-07-20T00:00:00Z')
const BASE_EPOCH = Date.UTC(2026, 6, 20) / 1000

let cacheDir: string

function writeCachedTrace(icao24: string, date: Date, payload: unknown): void {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  const dir = join(cacheDir, icao24)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${y}-${m}-${d}.json.gz`), gzipSync(JSON.stringify(payload)))
}

beforeAll(() => {
  cacheDir = mkdtempSync(join(tmpdir(), 'lietadielka-'))
  writeCachedTrace('505c06', DAY, {
    icao: '505c06',
    r: 'OM-BYA',
    t: 'A319',
    timestamp: BASE_EPOCH,
    trace: [
      // on stand: altitude reported as the string "ground", details carry the callsign
      [
        3_600, 48.167072, 17.198287, 'ground', 3.8, 92.8, 1, null,
        { type: 'adsb_icao', flight: 'SSG006  ' }, 'adsb_icao', null, null, null, null,
      ],
      // climbing away
      [3_700, 48.2, 17.3, 5_000, 210.5, 300.1, 0, 2_112, null, 'adsb_icao', 5_400, 2_100, 190, 1.2],
      // cruise, no fresh details object — the callsign must carry forward
      [4_500, 49.0, 16.0, 33_000, 450.2, 300.4, 0, 0, null, 'adsb_icao', 34_100, 0, 270, 0.1],
    ],
  })
})

describe('AdsbLolProvider trace decoding', () => {
  it('decodes the positional trace layout correctly', async () => {
    const provider = new AdsbLolProvider('https://example.invalid', cacheDir)
    const day = await provider.getDay('505c06', DAY)
    expect(day.status).toBe('ok')
    expect(day.positions).toHaveLength(3)

    const [stand, climb, cruise] = day.positions
    expect(stand!.timestamp.toISOString()).toBe('2026-07-20T01:00:00.000Z')
    expect(stand!.latitude).toBeCloseTo(48.167072, 6)
    expect(stand!.onGround).toBe(true)
    expect(stand!.altitudeBaro).toBeUndefined()
    expect(stand!.groundSpeed).toBe(3.8)
    expect(stand!.stale).toBe(true) // flag bit 1
    expect(stand!.callsign).toBe('SSG006')

    expect(climb!.onGround).toBe(false)
    expect(climb!.altitudeBaro).toBe(5_000)
    expect(climb!.altitudeGeom).toBe(5_400)
    expect(climb!.verticalRate).toBe(2_112)
    expect(climb!.track).toBe(300.1)
    expect(climb!.stale).toBe(false)

    // No details object on this point; tar1090 shows the last known callsign and so do we.
    expect(cruise!.callsign).toBe('SSG006')
    expect(cruise!.source).toBe('adsblol')
  })

  it('restricts getAircraftHistory to the requested window', async () => {
    const provider = new AdsbLolProvider('https://example.invalid', cacheDir)
    const positions = await provider.getAircraftHistory(
      '505c06',
      new Date('2026-07-20T01:00:30Z'),
      new Date('2026-07-20T01:10:00Z'),
    )
    // The stand fix at 01:00:00 is before the window and the cruise fix at 01:15:00
    // is after it; only the climb fix at 01:01:40 belongs.
    expect(positions).toHaveLength(1)
    expect(positions[0]!.altitudeBaro).toBe(5_000)
  })

  it('declares its measured history window rather than assuming unlimited history', () => {
    const provider = new AdsbLolProvider()
    expect(provider.capabilities.history).toBe(true)
    expect(provider.capabilities.historyWindowDays).toBeGreaterThan(0)
    expect(provider.capabilities.requiresAuth).toBe(false)
  })
})

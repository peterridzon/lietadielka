/**
 * OpenSky Network adapter.
 *
 * Anonymous access to the historical endpoints was withdrawn in 2025; the API now
 * requires OAuth2 client credentials from an OpenSky account. Without credentials
 * this adapter reports itself unhealthy rather than silently returning nothing.
 *
 * Strategy: `/flights/aircraft` lists the flights an aircraft made in a time range,
 * then `/tracks/all` returns the waypoints of each. Track waypoints are sparser than
 * an adsb.lol trace (OpenSky decimates them), so flights reconstructed from OpenSky
 * carry lower data coverage. That difference is visible in the data, not hidden.
 */
import type { AdsbPosition } from '../../core/types.js'
import { env } from '../../lib/env.js'
import { fetchWithRetry } from '../../lib/http.js'
import { log } from '../../lib/log.js'
import {
  type AdsbProvider,
  type ProviderCapabilities,
  type ProviderHealth,
  ProviderRangeUnavailableError,
} from '../provider.js'

const TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token'

type OpenSkyFlight = { icao24: string; firstSeen: number; lastSeen: number; callsign?: string | null }
/** [time, lat, lon, baroAltitudeMetres, trueTrack, onGround] */
type OpenSkyWaypoint = [number, number | null, number | null, number | null, number | null, boolean]
type OpenSkyTrack = { icao24: string; callsign?: string | null; path: OpenSkyWaypoint[] }

const METRES_TO_FEET = 3.280839895

export class OpenSkyProvider implements AdsbProvider {
  readonly name = 'opensky'
  readonly capabilities: ProviderCapabilities = {
    history: true,
    historyWindowDays: 30, // /tracks/all is documented as covering the last 30 days
    live: true,
    requiresAuth: true,
  }

  private token: { value: string; expiresAt: number } | null = null

  private async accessToken(): Promise<string> {
    if (!env.openskyClientId || !env.openskyClientSecret) {
      throw new Error('OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET are required for the opensky provider')
    }
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: env.openskyClientId,
        client_secret: env.openskyClientSecret,
      }),
    })
    if (!response.ok) throw new Error(`opensky token request failed: HTTP ${response.status}`)
    const payload = (await response.json()) as { access_token: string; expires_in: number }
    this.token = {
      value: payload.access_token,
      expiresAt: Date.now() + payload.expires_in * 1000,
    }
    return this.token.value
  }

  private async getJson<T>(path: string): Promise<T | null> {
    const token = await this.accessToken()
    const body = await fetchWithRetry(`${env.openskyBaseUrl}${path}`, {
      headers: { authorization: `Bearer ${token}` },
      emptyStatuses: [404],
    })
    if (body === null) return null
    return JSON.parse(Buffer.from(body).toString('utf8')) as T
  }

  async getAircraftHistory(icao24: string, from: Date, to: Date): Promise<AdsbPosition[]> {
    const hex = icao24.toLowerCase()
    const begin = Math.floor(from.getTime() / 1000)
    const end = Math.floor(to.getTime() / 1000)

    // The endpoint refuses ranges longer than 30 days, so walk it in chunks.
    const CHUNK = 29 * 24 * 3600
    const flights: OpenSkyFlight[] = []
    for (let start = begin; start < end; start += CHUNK) {
      const stop = Math.min(start + CHUNK, end)
      const chunk = await this.getJson<OpenSkyFlight[]>(
        `/flights/aircraft?icao24=${hex}&begin=${start}&end=${stop}`,
      )
      if (chunk) flights.push(...chunk)
    }

    if (flights.length === 0) return []

    const positions: AdsbPosition[] = []
    let unavailable = 0

    for (const flight of flights) {
      let track: OpenSkyTrack | null = null
      try {
        track = await this.getJson<OpenSkyTrack>(`/tracks/all?icao24=${hex}&time=${flight.firstSeen}`)
      } catch (error) {
        unavailable++
        log.warn(`opensky: track unavailable for ${hex} @ ${flight.firstSeen}`, error)
        continue
      }
      if (!track?.path) continue

      const callsign = (track.callsign ?? flight.callsign ?? undefined)?.trim() || undefined
      for (const [time, latitude, longitude, altitudeMetres, trueTrack, onGround] of track.path) {
        if (latitude === null || longitude === null) continue
        positions.push({
          aircraftIcao24: hex,
          timestamp: new Date(time * 1000),
          latitude,
          longitude,
          altitudeBaro:
            altitudeMetres === null ? undefined : Math.round(altitudeMetres * METRES_TO_FEET),
          track: trueTrack ?? undefined,
          onGround,
          callsign,
          source: this.name,
        })
      }
    }

    if (positions.length === 0 && unavailable === flights.length) {
      throw new ProviderRangeUnavailableError(this.name, 'all track requests failed', from, to)
    }

    positions.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    return positions
  }

  async probe(): Promise<ProviderHealth> {
    if (!env.openskyClientId || !env.openskyClientSecret) {
      return { ok: false, detail: 'no OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET configured' }
    }
    try {
      await this.accessToken()
      return { ok: true, detail: 'authenticated' }
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) }
    }
  }
}

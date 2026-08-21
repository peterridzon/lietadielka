import type { AdsbPosition } from '../core/types.js'

export type ProviderCapabilities = {
  /** Can serve positions for a past time range. */
  history: boolean
  /** How far back history reaches, in days. null = unbounded or unknown. */
  historyWindowDays: number | null
  /** Can serve current positions. Never exposed publicly — see SECURITY.md. */
  live: boolean
  requiresAuth: boolean
}

export type ProviderHealth = {
  ok: boolean
  detail: string
}

export interface AdsbProvider {
  readonly name: string
  readonly capabilities: ProviderCapabilities

  /**
   * Positions for one aircraft in [from, to), ordered by timestamp ascending.
   * Implementations must not throw for "no data" — they return an empty array.
   */
  getAircraftHistory(icao24: string, from: Date, to: Date): Promise<AdsbPosition[]>

  probe?(): Promise<ProviderHealth>
}

/**
 * Raised when a provider cannot serve a range it would normally serve — an expired
 * retention window, a rate limit, an outage. Distinct from "no data", which is an
 * empty result, because the two mean very different things for data coverage.
 */
export class ProviderRangeUnavailableError extends Error {
  constructor(
    readonly provider: string,
    readonly reason: string,
    readonly from: Date,
    readonly to: Date,
  ) {
    super(`${provider}: range unavailable (${reason}) for ${from.toISOString()}..${to.toISOString()}`)
    this.name = 'ProviderRangeUnavailableError'
  }
}

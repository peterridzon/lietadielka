/**
 * Break-even and the commercial comparison.
 *
 * The comparison must be fair. A government delegation may need a specific departure
 * time, a short booking horizon, flexibility, baggage or several destinations, so the
 * benchmark is a comparable flexible or business fare — never the cheapest ticket on the
 * internet. And where the passenger count is unknown, the engine refuses to produce a
 * per-passenger cost, a premium or a saving; it produces break-even points instead.
 */
import type { ConfidenceLabel } from '../types.js'
import type { Interval } from './types.js'

export type FareScenario = 'LOW_COST_ECONOMY' | 'STANDARD_FLEXIBLE_ECONOMY' | 'BUSINESS_FLEX'

export type CommercialFare = {
  scenario: FareScenario
  farePerPassenger: number
  roundTrip: boolean
  currency: 'EUR'
  /** historical_actual is worth far more than a current price applied to a past trip. */
  fareBasis:
    | 'historical_actual'
    | 'historical_cached'
    | 'historical_estimate'
    | 'current_equivalent'
    | 'benchmark'
    | 'manual'
  comparisonQuality: ConfidenceLabel
  directConnectionAvailable: 'yes' | 'no' | 'unknown'
  journeyTimeSeconds?: number
  sourceIds: string[]
}

export type BreakEven = {
  /** Passengers at which the state flight stops being the more expensive option. */
  directPassengers: number | null
  fullPassengers: number | null
  farePerPassenger: number
  scenario: FareScenario
}

export function breakEven(
  state: { direct: Interval | null; full: Interval | null },
  fare: CommercialFare,
): BreakEven | null {
  if (!(fare.farePerPassenger > 0)) return null
  return {
    directPassengers: state.direct ? state.direct.mid / fare.farePerPassenger : null,
    fullPassengers: state.full ? state.full.mid / fare.farePerPassenger : null,
    farePerPassenger: fare.farePerPassenger,
    scenario: fare.scenario,
  }
}

export type Comparison = {
  commercialCost: number
  statePremium: number
  premiumPercent: number | null
  stateCostPerPassenger: number
  cheaperOption: 'state' | 'commercial' | 'equal'
}

/**
 * Only computable with a known passenger count. Returns null otherwise — the caller must
 * not substitute an assumption, which is why this cannot silently default to one.
 */
export function compareWithCommercial(
  stateCost: number,
  passengerCount: number | null,
  fare: CommercialFare,
): Comparison | null {
  if (passengerCount === null || passengerCount <= 0) return null
  const commercialCost = passengerCount * fare.farePerPassenger
  const statePremium = stateCost - commercialCost
  return {
    commercialCost,
    statePremium,
    premiumPercent: commercialCost > 0 ? (stateCost / commercialCost - 1) * 100 : null,
    stateCostPerPassenger: stateCost / passengerCount,
    cheaperOption: statePremium > 0 ? 'commercial' : statePremium < 0 ? 'state' : 'equal',
  }
}

export type SensitivityRow = {
  passengers: number
  commercialCost: number
  directStateCost: number | null
  fullStateCost: number | null
  /** Which option is cheaper at this passenger count, on full cost. */
  cheaperOnFull: 'state' | 'commercial' | 'equal' | null
}

export const DEFAULT_SENSITIVITY_STEPS = [5, 10, 15, 20, 25, 30, 40, 50]

/** What replaces a verdict when the passenger count is unknown. */
export function sensitivity(
  state: { direct: Interval | null; full: Interval | null },
  fare: CommercialFare,
  steps: number[] = DEFAULT_SENSITIVITY_STEPS,
): SensitivityRow[] {
  return steps.map((passengers) => {
    const commercialCost = passengers * fare.farePerPassenger
    const full = state.full?.mid ?? null
    return {
      passengers,
      commercialCost,
      directStateCost: state.direct?.mid ?? null,
      fullStateCost: full,
      cheaperOnFull:
        full === null ? null : full < commercialCost ? 'state' : full > commercialCost ? 'commercial' : 'equal',
    }
  })
}

/** Informational only. Converting time to euros needs its own sourced methodology. */
export function timeSavedSeconds(
  commercialJourneySeconds: number | null,
  stateJourneySeconds: number | null,
): number | null {
  if (commercialJourneySeconds === null || stateJourneySeconds === null) return null
  return commercialJourneySeconds - stateJourneySeconds
}

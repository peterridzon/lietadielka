/**
 * Navigation charges.
 *
 * The abstraction exists so a EUROCONTROL route-charge model can be dropped in later:
 *
 *   ROUTE_CHARGE = DISTANCE_FACTOR × WEIGHT_FACTOR × UNIT_RATE
 *
 * Until a unit-rate table is obtained, the default implementation returns `unknown`
 * rather than a plausible-looking guess.
 *
 * One rule from the source material matters here. Commission Regulation (EU) 2019/317
 * Article 31(3) exempts flights carrying a head of state, head of government or
 * government minister from route charges, and most non-EU states apply the exemption
 * reciprocally. So a route charge of zero on such a flight is a `known_zero`, not a gap
 * in our data — provided a source establishes who was aboard.
 */
import type { FlightCostComponent } from './types.js'

export type NavigationContext = {
  distanceKm: number
  mtowKg: number | null
  date: Date
  /** True only when a source establishes that an exempt official was aboard. */
  exemptOfficialAboard: boolean | null
}

export interface NavigationCostCalculator {
  readonly name: string
  calculate(context: NavigationContext): FlightCostComponent
}

export class UnavailableNavigationCalculator implements NavigationCostCalculator {
  readonly name = 'unavailable'

  calculate(context: NavigationContext): FlightCostComponent {
    if (context.exemptOfficialAboard === true) {
      return {
        category: 'navigation',
        scope: 'direct',
        status: 'known_zero',
        valueLow: 0,
        valueMid: 0,
        valueHigh: 0,
        currency: 'EUR',
        calculationMethod: 'exempt under Commission Regulation (EU) 2019/317 Article 31(3)',
        inputs: { distanceKm: Math.round(context.distanceKm) },
        sourceIds: [],
        confidence: 'medium',
        note: 'A real zero, not a missing figure: route charges are waived for this category of flight.',
      }
    }
    return {
      category: 'navigation',
      scope: 'direct',
      status: 'unknown',
      currency: 'EUR',
      calculationMethod: 'no EUROCONTROL unit-rate table has been obtained',
      inputs: { distanceKm: Math.round(context.distanceKm), mtowKg: context.mtowKg },
      sourceIds: [],
      confidence: 'low',
      note: 'Excluded from the total rather than estimated.',
    }
  }
}

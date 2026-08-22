/**
 * Cost engine, including the acceptance tests from COST_ENGINE_SPEC_SK §65–§70.
 *
 * The theme running through these: a missing figure must never behave like a zero, and
 * a derived figure must never behave like a measurement.
 */
import { describe, expect, it } from 'vitest'
import { computeFlightCost } from '../src/core/cost/engine.js'
import {
  assertSpendingClaim,
  preferValue,
  type ContractValueType,
} from '../src/core/cost/research.js'
import { roundMoney, sumComponents, weakest } from '../src/core/cost/uncertainty.js'
import {
  breakEven,
  compareWithCommercial,
  sensitivity,
  type CommercialFare,
} from '../src/core/cost/breakeven.js'
import type {
  FlightCostComponent,
  ResolvedCostModel,
  ResolvedFixedCost,
  SourceTier,
} from '../src/core/cost/types.js'

const model: ResolvedCostModel = {
  id: 'm1',
  modelVersion: 'LU-MVSR-FW-DIRECT-2021-v1',
  mode: 'blended',
  priceYear: 2020,
  validFrom: '2021-01-01',
  validTo: null,
  currency: 'EUR',
  blendedDirect: { low: 2359.55, mid: 3802, high: 5300.75 },
  taxiAllowanceHours: 0.25,
  sourceIds: ['src-a4'],
  sourceTier: 'A4',
  includes: ['fuel', 'navigation', 'airport', 'handling', 'maintenance_hour', 'crew_variable'],
  excludes: ['insurance', 'crew_fixed', 'training'],
  stale: false,
}

const fixed: ResolvedFixedCost = {
  year: 2021,
  scopeKey: 'lu-mvsr-fixedwing',
  annualFixedCost: { low: 3558690, mid: 3558690, high: 3558690 },
  annualFlightHours: 1400,
  utilisationMethod: 'official',
  utilisationYear: 2019,
  excludedCategories: ['crew', 'capital_acquisition'],
  derivation: 'derived from the annual budget',
  sourceIds: ['src-a4'],
  sourceTier: 'A4',
  confidence: 'low',
  alternative: { annualFlightHours: 600, method: 'planning_minimum', year: 2021 },
}

const baseInput = {
  airborneSeconds: 3600,
  blockSeconds: 4200,
  departureDate: new Date('2021-06-10T08:00:00Z'),
  model,
}

describe('uncertainty', () => {
  it('sums the conservative envelope rather than a quadrature', () => {
    const components: FlightCostComponent[] = [
      { category: 'fuel', scope: 'direct', status: 'known', valueLow: 90, valueMid: 100, valueHigh: 120, currency: 'EUR', calculationMethod: '', inputs: {}, sourceIds: [], confidence: 'high' },
      { category: 'handling', scope: 'direct', status: 'estimated', valueLow: 40, valueMid: 50, valueHigh: 80, currency: 'EUR', calculationMethod: '', inputs: {}, sourceIds: [], confidence: 'low' },
    ]
    expect(sumComponents(components)).toEqual({ low: 130, mid: 150, high: 200 })
  })

  it('never sums an unknown component as zero', () => {
    const components: FlightCostComponent[] = [
      { category: 'fuel', scope: 'direct', status: 'known', valueMid: 100, currency: 'EUR', calculationMethod: '', inputs: {}, sourceIds: [], confidence: 'high' },
      { category: 'handling', scope: 'direct', status: 'unknown', currency: 'EUR', calculationMethod: '', inputs: {}, sourceIds: [], confidence: 'low' },
    ]
    expect(sumComponents(components)).toEqual({ low: 100, mid: 100, high: 100 })
  })

  it('counts a genuine zero, which is not the same as an unknown', () => {
    const components: FlightCostComponent[] = [
      { category: 'navigation', scope: 'direct', status: 'known_zero', valueLow: 0, valueMid: 0, valueHigh: 0, currency: 'EUR', calculationMethod: 'exempt', inputs: {}, sourceIds: [], confidence: 'medium' },
    ]
    expect(sumComponents(components)).toEqual({ low: 0, mid: 0, high: 0 })
  })

  it('returns nothing when every component is unknown', () => {
    expect(
      sumComponents([
        { category: 'fuel', scope: 'direct', status: 'unknown', currency: 'EUR', calculationMethod: '', inputs: {}, sourceIds: [], confidence: 'low' },
      ]),
    ).toBeNull()
  })

  it('rounds to the precision the inputs support', () => {
    expect(roundMoney(12347.29)).toBe(12300)
    expect(roundMoney(843.7)).toBe(840)
    expect(roundMoney(42.4)).toBe(42)
  })

  it('takes the weakest confidence, not an average', () => {
    expect(weakest('high', 'low', 'medium')).toBe('low')
    expect(weakest('high', 'high')).toBe('high')
  })
})

describe('acceptance §65 — direct cost', () => {
  const result = computeFlightCost(baseInput)

  it('prices from the blended rate over block hours', () => {
    // 4200 s = 1.1667 h block.
    expect(result.blockHours).toBeCloseTo(1.1667, 3)
    expect(result.blockHoursEstimated).toBe(false)
    expect(result.direct?.mid).toBe(roundMoney(1.16667 * 3802))
  })

  it('produces an interval, not a single figure', () => {
    expect(result.direct!.low).toBeLessThan(result.direct!.mid)
    expect(result.direct!.high).toBeGreaterThan(result.direct!.mid)
  })

  it('gives every component a formula and a source', () => {
    for (const component of result.components) {
      expect(component.calculationMethod.length).toBeGreaterThan(0)
      if (component.status !== 'unknown') expect(component.sourceIds.length).toBeGreaterThan(0)
    }
  })

  it('falls back to a taxi allowance when block time was not observed, and says so', () => {
    const estimated = computeFlightCost({ ...baseInput, blockSeconds: null })
    expect(estimated.blockHoursEstimated).toBe(true)
    expect(estimated.blockHours).toBeCloseTo(1 + 0.25, 6)
    expect(estimated.warnings.map((w) => w.code)).toContain('block_time_estimated')
  })
})

describe('acceptance §66 — full cost', () => {
  const result = computeFlightCost({ ...baseInput, fixed })

  it('allocates fixed cost by annual hours and adds it to direct', () => {
    const perHour = 3558690 / 1400
    expect(result.fixed?.mid).toBe(roundMoney(perHour * 1))
    expect(result.full?.mid).toBe(roundMoney(result.direct!.mid + result.fixed!.mid))
  })

  it('lets the choice of denominator become the interval', () => {
    // 600 planning hours against 1 400 official hours is a factor of 2.3, and that
    // uncertainty belongs in the published range rather than in a footnote.
    expect(result.fixed!.high).toBeGreaterThan(result.fixed!.mid * 2)
  })

  it('reports what the total does not include', () => {
    expect(result.missing).toContain('insurance')
    expect(result.missing).toContain('crew_fixed')
    expect(result.missing).toContain('capital')
    // "crew" and "crew_fixed" are the same omission in two vocabularies.
    expect(result.missing).not.toContain('crew')
  })

  it('shows only direct cost when no fixed model exists', () => {
    const directOnly = computeFlightCost(baseInput)
    expect(directOnly.fixed).toBeNull()
    expect(directOnly.full?.mid).toBe(directOnly.direct?.mid)
    expect(directOnly.warnings.map((w) => w.code)).toContain('no_fixed_cost_model')
  })
})

describe('acceptance §70 — historical price validity', () => {
  it('flags a model applied outside its validity rather than using it silently', () => {
    const result = computeFlightCost({ ...baseInput, model: { ...model, stale: true } })
    expect(result.warnings.map((w) => w.code)).toContain('stale_model')
    expect(result.confidence).toBe('low')
  })

  it('reports the gap between the price level and the flight', () => {
    const result = computeFlightCost({ ...baseInput, departureDate: new Date('2026-07-20T08:00:00Z') })
    expect(result.priceYear).toBe(2020)
    expect(result.priceYearGapYears).toBe(6)
    expect(result.warnings.map((w) => w.code)).toContain('stale_price_year')
    expect(result.confidence).toBe('low')
  })

  it('does not flag a flight priced in its own era', () => {
    const result = computeFlightCost({ ...baseInput, departureDate: new Date('2021-03-01T08:00:00Z') })
    expect(result.priceYearGapYears).toBe(1)
    expect(result.warnings.map((w) => w.code)).not.toContain('stale_price_year')
  })
})

describe('acceptance §64 — validation against a benchmark', () => {
  it('flags a model that disagrees with the published rate by more than 20 %', () => {
    const result = computeFlightCost({
      ...baseInput,
      model: { ...model, blendedDirect: { low: 8000, mid: 9000, high: 10000 } },
      benchmarks: [{ id: 'bm', kind: 'direct_hourly', low: 2359.55, mid: 3802, high: 5300.75, unit: 'eur_per_flight_hour', sourceTier: 'A4' }],
    })
    expect(result.validationWarning).toBe(true)
    expect(result.confidence).not.toBe('high')
  })

  it('does not flag a model that agrees with it', () => {
    const result = computeFlightCost({
      ...baseInput,
      benchmarks: [{ id: 'bm', kind: 'direct_hourly', low: 2359.55, mid: 3802, high: 5300.75, unit: 'eur_per_flight_hour', sourceTier: 'A4' }],
    })
    expect(result.validationWarning).toBe(false)
  })
})

describe('acceptance §67 — break-even', () => {
  const fare: CommercialFare = {
    scenario: 'STANDARD_FLEXIBLE_ECONOMY',
    farePerPassenger: 700,
    roundTrip: true,
    currency: 'EUR',
    fareBasis: 'benchmark',
    comparisonQuality: 'low',
    directConnectionAvailable: 'unknown',
    sourceIds: [],
  }

  it('produces both break-even points from the specification example', () => {
    const result = breakEven(
      { direct: { low: 8000, mid: 8000, high: 8000 }, full: { low: 14000, mid: 14000, high: 14000 } },
      fare,
    )
    expect(result!.directPassengers).toBeCloseTo(11.43, 2)
    expect(result!.fullPassengers).toBeCloseTo(20, 6)
  })

  it('refuses a zero fare rather than dividing by it', () => {
    expect(breakEven({ direct: null, full: null }, { ...fare, farePerPassenger: 0 })).toBeNull()
  })
})

describe('acceptance §68 — unknown passenger count', () => {
  const fare: CommercialFare = {
    scenario: 'BUSINESS_FLEX',
    farePerPassenger: 620,
    roundTrip: true,
    currency: 'EUR',
    fareBasis: 'benchmark',
    comparisonQuality: 'low',
    directConnectionAvailable: 'unknown',
    sourceIds: [],
  }

  it('computes no cost per passenger, premium or saving', () => {
    expect(compareWithCommercial(12000, null, fare)).toBeNull()
    expect(compareWithCommercial(12000, 0, fare)).toBeNull()
  })

  it('still offers a sensitivity table', () => {
    const rows = sensitivity(
      { direct: { low: 8000, mid: 8000, high: 8000 }, full: { low: 14000, mid: 14000, high: 14000 } },
      fare,
      [5, 30],
    )
    expect(rows[0]!.cheaperOnFull).toBe('commercial')
    expect(rows[1]!.cheaperOnFull).toBe('state')
  })

  it('reports the state aircraft as cheaper when it is', () => {
    const comparison = compareWithCommercial(12000, 40, fare)
    expect(comparison!.cheaperOption).toBe('state')
    expect(comparison!.statePremium).toBeLessThan(0)
  })
})

describe('acceptance §69 — framework contracts', () => {
  it('rejects a framework ceiling recorded as money spent', () => {
    expect(() =>
      assertSpendingClaim({ id: 'x', actualSpend: 10_000_000, contractValueType: 'maximum_framework_value' }),
    ).toThrow(/not money spent/)
  })

  it('accepts an invoice or an actual spend', () => {
    expect(() => assertSpendingClaim({ id: 'x', actualSpend: 1234, contractValueType: 'actual_spend' })).not.toThrow()
    expect(() => assertSpendingClaim({ id: 'x', actualSpend: 1234, contractValueType: 'invoice_value' })).not.toThrow()
  })

  it('prefers actual spending over a framework ceiling, and a better tier on a tie', () => {
    type Figure = { contractValueType: ContractValueType; sourceTier: SourceTier }
    const spend: Figure = { contractValueType: 'actual_spend', sourceTier: 'C' }
    const ceiling: Figure = { contractValueType: 'maximum_framework_value', sourceTier: 'A1' }
    // Even a top-tier source describing a ceiling loses to a weaker source describing
    // money that actually moved.
    expect(preferValue(spend, ceiling)).toBe(spend)

    const a4: Figure = { contractValueType: 'actual_spend', sourceTier: 'A4' }
    const d: Figure = { contractValueType: 'actual_spend', sourceTier: 'D' }
    expect(preferValue(d, a4)).toBe(a4)
  })
})

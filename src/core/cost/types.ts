/**
 * Cost engine domain types. Pure: no database, no clock, no network.
 *
 * The organising idea is that a cost is never a bare number. It is a value, an interval
 * around it, the formula that produced it, the sources behind the inputs, and an honest
 * status when we do not have it at all.
 */
import type { ConfidenceLabel } from '../types.js'

export const COST_ENGINE_VERSION = 'ce-1.0.0'

export type SourceTier = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'B1' | 'B2' | 'C' | 'D'

/** Higher is better evidence. Used to resolve conflicts between sources. */
export const SOURCE_TIER_RANK: Record<SourceTier, number> = {
  A1: 9, A2: 8, A3: 7, A4: 6, A5: 5, B1: 4, B2: 3, C: 2, D: 1,
}

/**
 * `unknown` and `known_zero` are deliberately different. A charge that was genuinely
 * waived is a real zero; a charge we simply have no figure for must never be summed as
 * zero, because that silently understates the total.
 */
export type CostStatus = 'known' | 'known_zero' | 'estimated' | 'unknown' | 'not_applicable'

export type CostCategory =
  | 'fuel' | 'navigation' | 'airport' | 'handling'
  | 'maintenance_hour' | 'maintenance_cycle' | 'crew_variable' | 'blended_direct'
  | 'insurance' | 'crew_fixed' | 'training' | 'facility' | 'software'
  | 'capital' | 'administration' | 'allocated_fixed' | 'other'

export type CostScopeKind = 'direct' | 'fixed'

export type Interval = { low: number; mid: number; high: number }

export type FlightCostComponent = {
  category: CostCategory
  scope: CostScopeKind
  status: CostStatus
  valueLow?: number
  valueMid?: number
  valueHigh?: number
  currency: 'EUR'
  /** Reproducible by hand, e.g. "0.95 h × 3 802 €/h". */
  calculationMethod: string
  inputs: Record<string, number | string | null>
  sourceIds: string[]
  sourceTier?: SourceTier
  confidence: ConfidenceLabel
  /** Why the component is unknown, when it is. */
  note?: string
}

export type CostWarning = {
  code:
    | 'stale_model'
    | 'stale_price_year'
    | 'no_fixed_cost_model'
    | 'no_utilisation_denominator'
    | 'stale_utilisation'
    | 'coverage_adjusted_denominator'
    | 'benchmark_deviation'
    | 'annual_reconciliation_deviation'
    | 'block_time_estimated'
    | 'excluded_categories'
  message: string
}

export type CalculationTraceStep = {
  label: string
  formula: string
  inputs: Record<string, number | string | null>
  result?: number | null
  /** Not every step produces euros — block hours are hours. */
  resultUnit?: 'EUR' | 'h' | 'percent'
  sourceIds: string[]
}

export type CalculationTrace = {
  engineVersion: string
  costModelVersion: string
  steps: CalculationTraceStep[]
}

export type FlightCostResult = {
  direct: Interval | null
  fixed: Interval | null
  full: Interval | null
  blockHours: number
  blockHoursEstimated: boolean
  flightHours: number
  cycles: number
  components: FlightCostComponent[]
  confidence: ConfidenceLabel
  basis: 'nominal_eur' | 'inflation_adjusted_eur'
  priceYear: number | null
  priceYearGapYears: number | null
  /** Categories the total is known not to include. Printed, never hidden. */
  missing: string[]
  warnings: CostWarning[]
  validationWarning: boolean
  trace: CalculationTrace
  costModelVersion: string
  engineVersion: string
}

// ---------------------------------------------------------------------------
// Inputs the engine is given. The caller resolves these from the database.
// ---------------------------------------------------------------------------

export type BlendedRate = { low: number; mid: number; high: number }

export type ResolvedCostModel = {
  id: string
  modelVersion: string
  mode: 'blended' | 'components'
  priceYear: number | null
  validFrom: string
  validTo: string | null
  currency: 'EUR'
  blendedDirect?: BlendedRate
  taxiAllowanceHours?: number
  sourceIds: string[]
  sourceTier?: SourceTier
  /** Cost categories the model's figure already contains. */
  includes: CostCategory[]
  /** Cost categories the model's figure is known to exclude. */
  excludes: CostCategory[]
  /** True when no model was valid at the flight date and an older one was used. */
  stale: boolean
}

export type ResolvedFixedCost = {
  year: number
  scopeKey: string
  annualFixedCost: Interval
  /** Hours the annual cost is divided by, and where that number came from. */
  annualFlightHours: number
  utilisationMethod: string
  utilisationYear: number
  excludedCategories: string[]
  derivation: string | null
  sourceIds: string[]
  sourceTier?: SourceTier
  confidence: ConfidenceLabel
  /** An alternative denominator, shown so the reader sees how much it matters. */
  alternative?: { annualFlightHours: number; method: string; year: number }
}

export type CostBenchmarkInput = {
  id: string
  kind: string
  low: number | null
  mid: number | null
  high: number | null
  unit: string
  sourceTier: SourceTier
}

export type FlightCostInput = {
  /** Airborne seconds, wheels-up to wheels-down. */
  airborneSeconds: number
  /** Measured off-block to on-block, when ground movement was observed at both ends. */
  blockSeconds: number | null
  departureDate: Date
  cycles?: number
  model: ResolvedCostModel
  fixed?: ResolvedFixedCost | null
  benchmarks?: CostBenchmarkInput[]
}

/**
 * The cost engine.
 *
 * Given a flight and the models resolved for its date, produces direct cost, allocated
 * fixed cost and full taxpayer cost as intervals, with a component breakdown, a
 * reproducible trace, an explicit list of what the total does not include, and warnings
 * wherever the inputs are stale or derived.
 *
 * Pure. The caller does the database work and hands in `FlightCostInput`.
 */
import type { ConfidenceLabel } from '../types.js'
import {
  addIntervals,
  capConfidence,
  roundInterval,
  scaleInterval,
  sumComponents,
  weakest,
} from './uncertainty.js'
import {
  COST_ENGINE_VERSION,
  type CalculationTraceStep,
  type CostWarning,
  type FlightCostComponent,
  type FlightCostInput,
  type FlightCostResult,
  type Interval,
} from './types.js'

/** Beyond this many years between the price level and the flight, confidence is capped. */
const STALE_PRICE_YEARS = 3
/** Beyond this deviation from a benchmark, the result is flagged. */
const BENCHMARK_DEVIATION = 0.2

export function computeFlightCost(input: FlightCostInput): FlightCostResult {
  const warnings: CostWarning[] = []
  const steps: CalculationTraceStep[] = []
  const components: FlightCostComponent[] = []
  const missing = new Set<string>()

  const flightHours = input.airborneSeconds / 3600
  const cycles = input.cycles ?? 1

  // --- block hours ---------------------------------------------------------
  const taxiAllowance = input.model.taxiAllowanceHours ?? 0
  const measured = input.blockSeconds != null && input.blockSeconds > input.airborneSeconds
  const blockHours = measured ? input.blockSeconds! / 3600 : flightHours + taxiAllowance
  if (!measured) {
    warnings.push({
      code: 'block_time_estimated',
      message:
        `Off-block to on-block time was not observed, so block hours are airborne time plus a ` +
        `${taxiAllowance.toFixed(2)} h taxi allowance.`,
    })
  }
  steps.push({
    label: 'Block hours',
    formula: measured ? 'measured off-block to on-block' : 'airborne hours + taxi allowance',
    inputs: {
      airborneHours: round3(flightHours),
      taxiAllowanceHours: measured ? null : taxiAllowance,
      measured: measured ? 'yes' : 'no',
    },
    result: round3(blockHours),
    resultUnit: 'h',
    sourceIds: [],
  })

  // --- model staleness -----------------------------------------------------
  if (input.model.stale) {
    warnings.push({
      code: 'stale_model',
      message:
        `No cost model was valid on the date of this flight. The nearest earlier model ` +
        `(${input.model.modelVersion}, valid from ${input.model.validFrom}) was applied instead.`,
    })
  }

  const flightYear = input.departureDate.getUTCFullYear()
  const priceYear = input.model.priceYear
  const priceYearGapYears = priceYear === null ? null : flightYear - priceYear
  if (priceYearGapYears !== null && priceYearGapYears >= STALE_PRICE_YEARS) {
    warnings.push({
      code: 'stale_price_year',
      message:
        `The inputs are at ${priceYear} price levels and the flight is from ${flightYear} — ` +
        `a gap of ${priceYearGapYears} years, not adjusted for inflation.`,
    })
  }

  // --- direct cost ---------------------------------------------------------
  if (input.model.mode === 'blended' && input.model.blendedDirect) {
    const rate = input.model.blendedDirect
    components.push({
      category: 'blended_direct',
      scope: 'direct',
      status: 'estimated',
      valueLow: blockHours * rate.low,
      valueMid: blockHours * rate.mid,
      valueHigh: blockHours * rate.high,
      currency: 'EUR',
      calculationMethod: `${blockHours.toFixed(2)} h × ${formatRate(rate.mid)} €/h`,
      inputs: {
        blockHours: round3(blockHours),
        rateLow: rate.low,
        rateMid: rate.mid,
        rateHigh: rate.high,
        includes: input.model.includes.join(', '),
      },
      sourceIds: input.model.sourceIds,
      sourceTier: input.model.sourceTier,
      confidence: 'medium',
      note:
        'A single sourced all-in hourly rate. It replaces the components it already ' +
        'contains and is never added to them.',
    })
    steps.push({
      label: 'Direct operating cost',
      formula: `block hours × blended direct rate (${formatRate(rate.low)} / ${formatRate(rate.mid)} / ${formatRate(rate.high)} €/h)`,
      inputs: { blockHours: round3(blockHours) },
      result: Math.round(blockHours * rate.mid),
      resultUnit: 'EUR',
      sourceIds: input.model.sourceIds,
    })
  }

  for (const category of input.model.excludes) missing.add(normaliseCategory(category))

  const direct = sumComponents(components.filter((c) => c.scope === 'direct'))

  // --- allocated fixed cost ------------------------------------------------
  let fixed: Interval | null = null
  if (input.fixed) {
    const f = input.fixed
    if (f.annualFlightHours <= 0) {
      warnings.push({
        code: 'no_utilisation_denominator',
        message: 'Annual flight hours are zero or missing, so fixed cost cannot be allocated.',
      })
    } else {
      // Which annual-hours figure you divide by moves this number more than anything
      // else does — 1 400 official hours against a 600-hour planning minimum is a factor
      // of 2.3. So the choice of denominator IS the interval, rather than a footnote.
      const denominators = [f.annualFlightHours]
      if (f.alternative && f.alternative.annualFlightHours > 0) {
        denominators.push(f.alternative.annualFlightHours)
      }
      const maxHours = Math.max(...denominators)
      const minHours = Math.min(...denominators)

      const perHour: Interval = {
        low: f.annualFixedCost.low / maxHours,
        mid: f.annualFixedCost.mid / f.annualFlightHours,
        high: f.annualFixedCost.high / minHours,
      }
      fixed = scaleInterval(perHour, flightHours)

      components.push({
        category: 'allocated_fixed',
        scope: 'fixed',
        status: 'estimated',
        valueLow: fixed.low,
        valueMid: fixed.mid,
        valueHigh: fixed.high,
        currency: 'EUR',
        calculationMethod:
          `${formatRate(f.annualFixedCost.mid)} € / ${formatRate(f.annualFlightHours)} h ` +
          `× ${flightHours.toFixed(2)} h`,
        inputs: {
          annualFixedCost: f.annualFixedCost.mid,
          annualFlightHours: f.annualFlightHours,
          utilisationMethod: f.utilisationMethod,
          utilisationYear: f.utilisationYear,
          flightHours: round3(flightHours),
          derivation: f.derivation,
        },
        sourceIds: f.sourceIds,
        sourceTier: f.sourceTier,
        confidence: f.confidence,
        note: f.derivation ?? undefined,
      })

      steps.push({
        label: 'Allocated fixed cost',
        formula:
          denominators.length > 1
            ? `annual fixed cost ÷ annual flight hours × flight hours (interval spans ${formatRate(minHours)}–${formatRate(maxHours)} h)`
            : 'annual fixed cost ÷ annual flight hours × flight hours',
        inputs: {
          annualFixedCost: f.annualFixedCost.mid,
          annualFlightHours: f.annualFlightHours,
          denominatorMethod: f.utilisationMethod,
          flightHours: round3(flightHours),
        },
        result: Math.round(fixed.mid),
        resultUnit: 'EUR',
        sourceIds: f.sourceIds,
      })

      // The denominator decides most of the answer, so show what the alternative gives.
      if (f.alternative && f.alternative.annualFlightHours > 0) {
        const altPerHour = f.annualFixedCost.mid / f.alternative.annualFlightHours
        steps.push({
          label: 'Allocated fixed cost — alternative denominator',
          formula: `annual fixed cost ÷ ${formatRate(f.alternative.annualFlightHours)} h (${f.alternative.method}, ${f.alternative.year})`,
          inputs: {
            annualFlightHours: f.alternative.annualFlightHours,
            method: f.alternative.method,
            perHour: Math.round(altPerHour),
          },
          result: Math.round(altPerHour * flightHours),
          resultUnit: 'EUR',
          sourceIds: f.sourceIds,
        })
      }

      if (f.utilisationMethod === 'coverage_adjusted_estimate') {
        warnings.push({
          code: 'coverage_adjusted_denominator',
          message:
            'Annual flight hours were estimated from an incomplete ADS-B dataset by dividing ' +
            'observed hours by the estimated coverage. An undercounted denominator would ' +
            'inflate the cost per hour, so this result cannot be high confidence.',
        })
      }
      if (f.utilisationYear !== flightYear) {
        warnings.push({
          code: 'stale_utilisation',
          message:
            `Fixed cost was allocated using ${f.utilisationYear} flight hours ` +
            `(${f.utilisationMethod}); the flight is from ${flightYear}.`,
        })
      }
      for (const category of f.excludedCategories) missing.add(normaliseCategory(category))
      if (f.excludedCategories.length > 0) {
        warnings.push({
          code: 'excluded_categories',
          message: `The fixed cost figure explicitly excludes: ${f.excludedCategories.join(', ')}.`,
        })
      }
    }
  } else {
    warnings.push({
      code: 'no_fixed_cost_model',
      message: 'No annual fixed cost is available for this fleet and period, so only direct cost is shown.',
    })
  }

  // Round the parts first, then add. Rounding once at the end is marginally more
  // accurate but leaves a page on which the printed direct and fixed costs do not add up
  // to the printed total, which a reader is right to read as an error.
  const roundedDirect = direct ? roundInterval(direct) : null
  const roundedFixed = fixed ? roundInterval(fixed) : null
  const full = addIntervals(roundedDirect, roundedFixed)
  if (full) {
    steps.push({
      label: 'Full taxpayer cost',
      formula: 'direct operating cost + allocated fixed cost',
      inputs: { direct: direct ? Math.round(direct.mid) : null, fixed: fixed ? Math.round(fixed.mid) : null },
      result: Math.round(full.mid),
      resultUnit: 'EUR',
      sourceIds: [],
    })
  }

  // --- validation against benchmarks --------------------------------------
  let validationWarning = false
  const hourlyBenchmark = (input.benchmarks ?? []).find((b) => b.kind === 'direct_hourly')
  if (hourlyBenchmark?.mid && direct && blockHours > 0) {
    const modelled = direct.mid / blockHours
    const deviation = Math.abs(modelled - hourlyBenchmark.mid) / hourlyBenchmark.mid
    steps.push({
      label: 'Benchmark check',
      formula: 'modelled direct cost per hour vs published benchmark',
      inputs: {
        modelledPerHour: Math.round(modelled),
        benchmarkPerHour: hourlyBenchmark.mid,
        deviationPercent: Math.round(deviation * 1000) / 10,
      },
      result: null,
      sourceIds: [hourlyBenchmark.id],
    })
    if (deviation > BENCHMARK_DEVIATION) {
      validationWarning = true
      warnings.push({
        code: 'benchmark_deviation',
        message:
          `Modelled direct cost is ${Math.round(deviation * 100)} % away from the published ` +
          `benchmark of ${formatRate(hourlyBenchmark.mid)} €/h. One of the two is wrong.`,
      })
    }
  }

  // --- confidence ----------------------------------------------------------
  let confidence: ConfidenceLabel = weakest(
    ...components.map((c) => c.confidence),
    input.fixed?.confidence,
  )
  if (input.model.stale) confidence = capConfidence(confidence, 'low')
  if (priceYearGapYears !== null && priceYearGapYears >= STALE_PRICE_YEARS) {
    confidence = capConfidence(confidence, 'low')
  }
  if (validationWarning) confidence = capConfidence(confidence, 'medium')
  if (missing.size > 0) confidence = capConfidence(confidence, 'medium')

  return {
    direct: roundedDirect,
    fixed: roundedFixed,
    full,
    blockHours,
    blockHoursEstimated: !measured,
    flightHours,
    cycles,
    components,
    confidence,
    basis: 'nominal_eur',
    priceYear,
    priceYearGapYears,
    missing: [...missing].sort(),
    warnings,
    validationWarning,
    trace: { engineVersion: COST_ENGINE_VERSION, costModelVersion: input.model.modelVersion, steps },
    costModelVersion: input.model.modelVersion,
    engineVersion: COST_ENGINE_VERSION,
  }
}

/** Research categories and cost categories name some of the same things differently. */
const CATEGORY_ALIASES: Record<string, string> = {
  crew: 'crew_fixed',
  capital_acquisition: 'capital',
  airport_services: 'airport',
  base_maintenance: 'maintenance_hour',
  line_maintenance: 'maintenance_hour',
  engine_maintenance: 'maintenance_hour',
  facilities: 'facility',
}

function normaliseCategory(category: string): string {
  return CATEGORY_ALIASES[category] ?? category
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function formatRate(value: number): string {
  return Math.round(value).toLocaleString('en-GB')
}

export { COST_ENGINE_VERSION }

/**
 * Costs every flight with the model valid on its date and stores the result.
 *
 * Recomputation inserts. Previous calculations are kept and marked not current, so a
 * number published last month can still be explained after the methodology changes.
 */
import { and, asc, desc, eq, isNull, lte, or, sql } from 'drizzle-orm'
import { computeFlightCost } from '../core/cost/engine.js'
import {
  COST_ENGINE_VERSION,
  type CostBenchmarkInput,
  type CostCategory,
  type ResolvedCostModel,
  type ResolvedFixedCost,
  type SourceTier,
} from '../core/cost/types.js'
import type { ConfidenceLabel } from '../core/types.js'
import { getDb } from '../db/client.js'
import {
  aircraft,
  annualFixedCost,
  annualUtilisation,
  costBenchmark,
  costModel,
  flight,
  flightCost,
} from '../db/schema.js'
import { log } from '../lib/log.js'

/** §16 preference order for the denominator that decides most of the full-cost answer. */
const UTILISATION_PREFERENCE = [
  'official',
  'adsb_complete',
  'coverage_adjusted_estimate',
  'planning_minimum',
  'benchmark',
]

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

type ModelRow = typeof costModel.$inferSelect

/**
 * Picks the model valid on the flight date. Falls back to the most recent earlier model
 * and flags it, rather than silently applying a rate from a different era (§70).
 */
export function selectModel(candidates: ModelRow[], date: Date): { model: ModelRow; stale: boolean } | null {
  if (candidates.length === 0) return null
  const day = isoDay(date)

  const specificity = (m: ModelRow): number =>
    m.appliesToAircraftId ? 3 : m.appliesToTypeCode ? 2 : 1

  const valid = candidates.filter(
    (m) => m.validFrom <= day && (m.validTo === null || m.validTo >= day),
  )
  if (valid.length > 0) {
    valid.sort((a, b) => specificity(b) - specificity(a) || b.version - a.version)
    return { model: valid[0]!, stale: false }
  }

  const earlier = candidates.filter((m) => m.validFrom <= day)
  if (earlier.length > 0) {
    earlier.sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1) || b.version - a.version)
    return { model: earlier[0]!, stale: true }
  }
  return null
}

async function resolveModel(
  aircraftId: string,
  typeCode: string | null,
  date: Date,
): Promise<ResolvedCostModel | null> {
  const { db } = await getDb()
  const rows = await db
    .select()
    .from(costModel)
    .where(
      or(
        eq(costModel.appliesToAircraftId, aircraftId),
        typeCode ? eq(costModel.appliesToTypeCode, typeCode) : sql`false`,
        and(isNull(costModel.appliesToAircraftId), isNull(costModel.appliesToTypeCode)),
      ),
    )
    .orderBy(desc(costModel.validFrom))

  const picked = selectModel(rows, date)
  if (!picked) return null
  const m = picked.model
  const params = (m.params ?? {}) as { includes?: string[]; excludes?: string[] }

  return {
    id: m.id,
    modelVersion: m.modelVersion,
    mode: m.mode === 'components' ? 'components' : 'blended',
    priceYear: m.priceYear,
    validFrom: m.validFrom,
    validTo: m.validTo,
    currency: 'EUR',
    blendedDirect:
      m.blendedDirectRateMid != null
        ? {
            low: m.blendedDirectRateLow ?? m.blendedDirectRateMid,
            mid: m.blendedDirectRateMid,
            high: m.blendedDirectRateHigh ?? m.blendedDirectRateMid,
          }
        : undefined,
    taxiAllowanceHours: m.taxiAllowanceHours ?? undefined,
    sourceIds: m.sourceId ? [m.sourceId] : [],
    sourceTier: (m.sourceTier ?? undefined) as SourceTier | undefined,
    includes: (params.includes ?? []) as CostCategory[],
    excludes: (params.excludes ?? []) as CostCategory[],
    stale: picked.stale,
  }
}

async function resolveFixedCost(scopeKey: string | null, date: Date): Promise<ResolvedFixedCost | null> {
  if (!scopeKey) return null
  const { db } = await getDb()
  const year = date.getUTCFullYear()

  const fixedRows = await db
    .select()
    .from(annualFixedCost)
    .where(and(eq(annualFixedCost.scopeKey, scopeKey), lte(annualFixedCost.year, year)))
    .orderBy(desc(annualFixedCost.year))
    .limit(1)
  const fixedRow = fixedRows[0]
  if (!fixedRow || fixedRow.valueMid == null) return null

  const utilisationRows = await db
    .select()
    .from(annualUtilisation)
    .where(eq(annualUtilisation.scopeKey, scopeKey))
    .orderBy(asc(annualUtilisation.year))
  if (utilisationRows.length === 0) return null

  // Best method first; within a method, the year closest to the flight.
  const ranked = [...utilisationRows].sort((a, b) => {
    const ra = UTILISATION_PREFERENCE.indexOf(a.method)
    const rb = UTILISATION_PREFERENCE.indexOf(b.method)
    if (ra !== rb) return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb)
    return Math.abs(a.year - year) - Math.abs(b.year - year)
  })
  const chosen = ranked[0]!
  const alternative = ranked.find((r) => r.method !== chosen.method)

  const mid = fixedRow.valueMid
  return {
    year: fixedRow.year,
    scopeKey,
    annualFixedCost: {
      low: fixedRow.valueLow ?? mid,
      mid,
      high: fixedRow.valueHigh ?? mid,
    },
    annualFlightHours: chosen.flightHours,
    utilisationMethod: chosen.method,
    utilisationYear: chosen.year,
    excludedCategories: (fixedRow.excludedCategories as string[] | null) ?? [],
    derivation: fixedRow.derivation,
    sourceIds: [fixedRow.sourceId, chosen.sourceId].filter((v): v is string => Boolean(v)),
    sourceTier: (fixedRow.sourceTier ?? undefined) as SourceTier | undefined,
    confidence: (fixedRow.confidence as ConfidenceLabel) ?? 'low',
    alternative: alternative
      ? { annualFlightHours: alternative.flightHours, method: alternative.method, year: alternative.year }
      : undefined,
  }
}

async function resolveBenchmarks(date: Date): Promise<CostBenchmarkInput[]> {
  const { db } = await getDb()
  const day = isoDay(date)
  const rows = await db.select().from(costBenchmark)
  return rows
    .filter((b) => b.validFrom <= day && (b.validTo === null || b.validTo >= day))
    .map((b) => ({
      id: b.id,
      kind: b.kind,
      low: b.valueLow,
      mid: b.valueMid,
      high: b.valueHigh,
      unit: b.unit,
      sourceTier: b.sourceTier as SourceTier,
    }))
}

export type RecomputeResult = {
  costed: number
  skipped: number
  reasons: Record<string, number>
}

export async function recomputeCosts(options: { aircraftId?: string } = {}): Promise<RecomputeResult> {
  const { db } = await getDb()

  const flights = await db
    .select({
      id: flight.id,
      publicId: flight.publicId,
      aircraftId: flight.aircraftId,
      typeCode: aircraft.typeCode,
      departureTime: flight.departureTime,
      durationSeconds: flight.durationSeconds,
      blockSeconds: flight.blockSeconds,
    })
    .from(flight)
    .innerJoin(aircraft, eq(aircraft.id, flight.aircraftId))
    .where(options.aircraftId ? eq(flight.aircraftId, options.aircraftId) : undefined)
    .orderBy(asc(flight.departureTime))

  const reasons: Record<string, number> = {}
  let costed = 0
  let skipped = 0

  for (const row of flights) {
    const model = await resolveModel(row.aircraftId, row.typeCode, row.departureTime)
    if (!model) {
      skipped++
      reasons['no cost model'] = (reasons['no cost model'] ?? 0) + 1
      continue
    }

    const modelRow = (await db.select().from(costModel).where(eq(costModel.id, model.id)).limit(1))[0]
    const fixed = await resolveFixedCost(modelRow?.scopeKey ?? null, row.departureTime)
    const benchmarks = await resolveBenchmarks(row.departureTime)

    const result = computeFlightCost({
      airborneSeconds: row.durationSeconds ?? 0,
      blockSeconds: row.blockSeconds,
      departureDate: row.departureTime,
      model,
      fixed,
      benchmarks,
    })

    // Previous calculations stay readable; only the current flag moves.
    await db
      .update(flightCost)
      .set({ isCurrent: false })
      .where(eq(flightCost.flightId, row.id))

    const values = {
      id: `${row.id}::${result.costModelVersion}::${result.engineVersion}`,
      flightId: row.id,
      costModelId: model.id,
      costModelVersion: result.costModelVersion,
      engineVersion: result.engineVersion,
      currency: 'EUR',
      directLow: result.direct?.low ?? null,
      directMid: result.direct?.mid ?? null,
      directHigh: result.direct?.high ?? null,
      fixedLow: result.fixed?.low ?? null,
      fixedMid: result.fixed?.mid ?? null,
      fixedHigh: result.fixed?.high ?? null,
      fullLow: result.full?.low ?? null,
      fullMid: result.full?.mid ?? null,
      fullHigh: result.full?.high ?? null,
      blockHours: result.blockHours,
      blockHoursEstimated: result.blockHoursEstimated,
      components: result.components,
      trace: result.trace,
      missing: result.missing,
      warnings: result.warnings,
      basis: result.basis,
      priceYear: result.priceYear,
      priceYearGapYears: result.priceYearGapYears,
      confidence: result.confidence,
      validationWarning: result.validationWarning,
      isCurrent: true,
      computedAt: new Date(),
    }
    await db.insert(flightCost).values(values).onConflictDoUpdate({ target: flightCost.id, set: values })
    costed++
  }

  log.info(`costs: ${costed} flights costed, ${skipped} skipped`)
  return { costed, skipped, reasons }
}

export { COST_ENGINE_VERSION }

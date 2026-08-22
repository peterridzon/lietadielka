/**
 * Loads data/aircraft.seed.json and data/cost-models.seed.json into the database.
 *
 * Idempotent: re-running updates existing rows by id/key rather than duplicating.
 * Entries under "candidates" and "rejected" are documentation, not data — they are
 * deliberately not inserted.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { assertSpendingClaim } from '../core/cost/research.js'
import { closeDb, getDb } from '../db/client.js'
import {
  aircraft,
  annualFixedCost,
  annualUtilisation,
  costBenchmark,
  costModel,
  costResearchItem,
  source,
} from '../db/schema.js'
import { runCli } from '../lib/cli.js'

type SeedSource = {
  id: string
  publisher: string
  title: string
  url?: string
  publishedAt?: string
  type: string
  sourceTier?: string
  validFrom?: string
  validTo?: string
  originalCurrency?: string
  originalValue?: number
  notes?: string
}

type SeedAircraft = {
  id: string
  icao24: string
  registration: string
  manufacturer?: string
  model?: string
  variant?: string
  typeCode?: string
  operator?: string
  category: string
  activeFrom?: string | null
  activeUntil?: string | null
  trackingEnabled: boolean
  isRotorcraft: boolean
  costModelKey?: string
  verificationStatus: string
  dataStatus: string
  sourceId?: string
  sourceUrl?: string
  notes?: string
}

type SeedCostModel = {
  key: string
  version: number
  modelVersion: string
  label: string
  appliesToTypeCode?: string | null
  appliesToAircraftId?: string
  scope: string
  scopeKey?: string
  allocationMethod: string
  validFrom: string
  validTo?: string | null
  priceYear?: number
  mode: string
  blendedDirectRateLow?: number
  blendedDirectRateHigh?: number
  blendedDirectRateMid?: number
  taxiAllowanceHours?: number
  currency: string
  verificationStatus: string
  sourceId?: string
  sourceTier?: string
  params: unknown
  notes?: string
}

type SeedResearch = {
  sources: SeedSource[]
  researchItems: Record<string, unknown>[]
  benchmarks: Record<string, unknown>[]
  annualUtilisation: Record<string, unknown>[]
  annualFixedCost: Record<string, unknown>[]
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8')) as T
}

async function main(): Promise<void> {
  const registry = readJson<{ sources: SeedSource[]; aircraft: SeedAircraft[] }>(
    'data/aircraft.seed.json',
  )
  const costs = readJson<{ costModels: SeedCostModel[] }>('data/cost-models.seed.json')

  const { db } = await getDb()

  const research = readJson<SeedResearch>('data/cost-research.seed.json')

  const upsertSource = async (entry: SeedSource): Promise<void> => {
    const values = {
      id: entry.id,
      publisher: entry.publisher,
      title: entry.title,
      url: entry.url ?? null,
      publishedAt: entry.publishedAt ? new Date(`${entry.publishedAt}T00:00:00Z`) : null,
      type: entry.type,
      sourceTier: entry.sourceTier ?? null,
      validFrom: entry.validFrom ?? null,
      validTo: entry.validTo ?? null,
      originalCurrency: entry.originalCurrency ?? null,
      originalValue: entry.originalValue ?? null,
      notes: entry.notes ?? null,
    }
    await db
      .insert(source)
      .values(values)
      .onConflictDoUpdate({ target: source.id, set: { ...values, accessedAt: new Date() } })
  }

  for (const entry of [...registry.sources, ...research.sources]) await upsertSource(entry)

  for (const entry of registry.aircraft) {
    const values = {
      id: entry.id,
      icao24: entry.icao24.toLowerCase(),
      registration: entry.registration,
      manufacturer: entry.manufacturer ?? null,
      model: entry.model ?? null,
      variant: entry.variant ?? null,
      typeCode: entry.typeCode ?? null,
      operator: entry.operator ?? null,
      category: entry.category,
      activeFrom: entry.activeFrom ?? null,
      activeUntil: entry.activeUntil ?? null,
      trackingEnabled: entry.trackingEnabled,
      isRotorcraft: entry.isRotorcraft,
      costModelKey: entry.costModelKey ?? null,
      verificationStatus: entry.verificationStatus,
      dataStatus: entry.dataStatus,
      notes: entry.notes ?? null,
      sourceUrl: entry.sourceUrl ?? null,
      sourceId: entry.sourceId ?? null,
      updatedAt: new Date(),
    }
    await db
      .insert(aircraft)
      .values(values)
      .onConflictDoUpdate({ target: aircraft.id, set: values })
  }

  for (const entry of costs.costModels) {
    const id = `${entry.key}-v${entry.version}`
    const values = {
      id,
      key: entry.key,
      version: entry.version,
      modelVersion: entry.modelVersion,
      label: entry.label,
      appliesToAircraftId: entry.appliesToAircraftId ?? null,
      appliesToTypeCode: entry.appliesToTypeCode ?? null,
      scope: entry.scope,
      scopeKey: entry.scopeKey ?? null,
      allocationMethod: entry.allocationMethod,
      validFrom: entry.validFrom,
      validTo: entry.validTo ?? null,
      priceYear: entry.priceYear ?? null,
      mode: entry.mode,
      blendedDirectRateLow: entry.blendedDirectRateLow ?? null,
      blendedDirectRateMid: entry.blendedDirectRateMid ?? null,
      blendedDirectRateHigh: entry.blendedDirectRateHigh ?? null,
      taxiAllowanceHours: entry.taxiAllowanceHours ?? null,
      currency: entry.currency,
      params: entry.params,
      sourceId: entry.sourceId ?? null,
      sourceTier: entry.sourceTier ?? null,
      verificationStatus: entry.verificationStatus,
      notes: entry.notes ?? null,
    }
    await db.insert(costModel).values(values).onConflictDoUpdate({ target: costModel.id, set: values })
  }

  for (const item of research.researchItems) {
    const row = item as Record<string, unknown>
    assertSpendingClaim({
      id: String(row.id),
      actualSpend: row.actualSpend as number | null | undefined,
      contractValueType: row.contractValueType as never,
    })
    await db
      .insert(costResearchItem)
      .values(row as typeof costResearchItem.$inferInsert)
      .onConflictDoUpdate({ target: costResearchItem.id, set: row as never })
  }

  for (const row of research.benchmarks) {
    await db
      .insert(costBenchmark)
      .values(row as typeof costBenchmark.$inferInsert)
      .onConflictDoUpdate({ target: costBenchmark.id, set: row as never })
  }
  for (const row of research.annualUtilisation) {
    await db
      .insert(annualUtilisation)
      .values(row as typeof annualUtilisation.$inferInsert)
      .onConflictDoUpdate({ target: annualUtilisation.id, set: row as never })
  }
  for (const row of research.annualFixedCost) {
    await db
      .insert(annualFixedCost)
      .values(row as typeof annualFixedCost.$inferInsert)
      .onConflictDoUpdate({ target: annualFixedCost.id, set: row as never })
  }

  const [counts] = await db
    .select({
      sources: sql<number>`(select count(*) from ${source})`,
      aircraft: sql<number>`(select count(*) from ${aircraft})`,
      tracked: sql<number>`(select count(*) from ${aircraft} where tracking_enabled)`,
      costModels: sql<number>`(select count(*) from ${costModel})`,
      research: sql<number>`(select count(*) from ${costResearchItem})`,
      benchmarks: sql<number>`(select count(*) from ${costBenchmark})`,
    })
    .from(sql`(select 1) as _`)

  console.log(
    `seeded: ${counts?.sources ?? 0} sources, ${counts?.aircraft ?? 0} aircraft ` +
      `(${counts?.tracked ?? 0} tracked), ${counts?.costModels ?? 0} cost models, ` +
      `${counts?.research ?? 0} research items, ${counts?.benchmarks ?? 0} benchmarks`,
  )
  console.log(
    'note: all aircraft are verification_status=needs_verification — see DATA_SOURCES.md',
  )
  await closeDb()
}

runCli(main)

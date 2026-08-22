/**
 * Loads data/aircraft.seed.json and data/cost-models.seed.json into the database.
 *
 * Idempotent: re-running updates existing rows by id/key rather than duplicating.
 * Entries under "candidates" and "rejected" are documentation, not data — they are
 * deliberately not inserted.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { assertSpendingClaim } from '../core/cost/research.js'
import { closeDb, getDb } from '../db/client.js'
import {
  aircraft,
  annualFixedCost,
  annualUtilisation,
  costBenchmark,
  costModel,
  costResearchItem,
  flight,
  flightPurpose,
  operatorOrganisation,
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

type SeedOperator = {
  id: string
  name: string
  shortName?: string
  parentId?: string | null
  category?: string
  country?: string
  notes?: string
}

type SeedAircraft = {
  id: string
  icao24: string
  registration: string
  registrationType?: string
  msn?: string
  previousRegistrations?: string[]
  operatorId?: string
  manufacturer?: string
  model?: string
  variant?: string
  typeCode?: string
  operator?: string
  fleetKey?: string
  category: string
  status?: string
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

type SeedPurpose = {
  flightPublicId: string
  title: string
  description?: string
  status: string
  sourceUrl?: string
  sourcePublisher?: string
  sourcePublishedAt?: string
  sourceType?: string
  verifiedBy?: string
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
  const registry = readJson<{
    sources: SeedSource[]
    operators?: SeedOperator[]
    aircraft: SeedAircraft[]
  }>('data/aircraft.seed.json')
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

  // Parents before children: an operator may reference its parent.
  for (const entry of [...(registry.operators ?? [])].sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0))) {
    const values = {
      id: entry.id,
      name: entry.name,
      shortName: entry.shortName ?? null,
      parentId: entry.parentId ?? null,
      category: entry.category ?? null,
      country: entry.country ?? null,
      notes: entry.notes ?? null,
    }
    await db
      .insert(operatorOrganisation)
      .values(values)
      .onConflictDoUpdate({ target: operatorOrganisation.id, set: values })
  }

  for (const entry of registry.aircraft) {
    const values = {
      id: entry.id,
      icao24: entry.icao24.toLowerCase(),
      registration: entry.registration,
      registrationType: entry.registrationType ?? 'civil',
      msn: entry.msn ?? null,
      previousRegistrations: entry.previousRegistrations ?? null,
      operatorId: entry.operatorId ?? null,
      manufacturer: entry.manufacturer ?? null,
      model: entry.model ?? null,
      variant: entry.variant ?? null,
      typeCode: entry.typeCode ?? null,
      operator: entry.operator ?? null,
      fleetKey: entry.fleetKey ?? null,
      category: entry.category,
      status: entry.status ?? 'active',
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

  // Purposes are research, so they live in version control and are re-applied after any
  // rebuild. A purpose whose flight has not been detected yet is reported, not dropped.
  const purposeSeed = readJson<{ purposes: SeedPurpose[] }>('data/flight-purposes.seed.json')
  let purposesApplied = 0
  const purposesPending: string[] = []

  for (const entry of purposeSeed.purposes) {
    const rows = await db
      .select({ id: flight.id })
      .from(flight)
      .where(eq(flight.publicId, entry.flightPublicId))
      .limit(1)
    const target = rows[0]
    if (!target) {
      purposesPending.push(entry.flightPublicId)
      continue
    }

    if (entry.status !== 'unknown' && (!entry.sourceUrl || !entry.sourcePublisher)) {
      throw new Error(
        `Flight purpose for ${entry.flightPublicId} is "${entry.status}" but has no source. ` +
          'An unsourced claim about why a state aircraft flew must not be published.',
      )
    }

    const sourceId = entry.sourceUrl ? `src-purpose-${entry.flightPublicId}` : null
    if (sourceId && entry.sourceUrl && entry.sourcePublisher) {
      await upsertSource({
        id: sourceId,
        publisher: entry.sourcePublisher,
        title: entry.title,
        url: entry.sourceUrl,
        publishedAt: entry.sourcePublishedAt,
        type: entry.sourceType ?? 'media',
      })
    }

    await db.delete(flightPurpose).where(eq(flightPurpose.flightId, target.id))
    await db.insert(flightPurpose).values({
      id: randomUUID(),
      flightId: target.id,
      title: entry.title,
      description: entry.description ?? null,
      status: entry.status,
      sourceUrl: entry.sourceUrl ?? null,
      sourcePublisher: entry.sourcePublisher ?? null,
      sourcePublishedAt: entry.sourcePublishedAt
        ? new Date(`${entry.sourcePublishedAt}T00:00:00Z`)
        : null,
      sourceId,
      confidence: entry.status === 'confirmed' ? 1 : entry.status === 'probable' ? 0.5 : 0,
      verifiedBy: entry.verifiedBy ?? null,
    })
    purposesApplied++
  }

  const [counts] = await db
    .select({
      sources: sql<number>`(select count(*) from ${source})`,
      aircraft: sql<number>`(select count(*) from ${aircraft})`,
      tracked: sql<number>`(select count(*) from ${aircraft} where tracking_enabled and status = 'active')`,
      operators: sql<number>`(select count(*) from ${operatorOrganisation})`,
      costModels: sql<number>`(select count(*) from ${costModel})`,
      research: sql<number>`(select count(*) from ${costResearchItem})`,
      benchmarks: sql<number>`(select count(*) from ${costBenchmark})`,
    })
    .from(sql`(select 1) as _`)

  console.log(
    `seeded: ${counts?.sources ?? 0} sources, ${counts?.operators ?? 0} operators, ` +
      `${counts?.aircraft ?? 0} aircraft ` +
      `(${counts?.tracked ?? 0} tracked), ${counts?.costModels ?? 0} cost models, ` +
      `${counts?.research ?? 0} research items, ${counts?.benchmarks ?? 0} benchmarks`,
  )
  console.log(
    `flight purposes: ${purposesApplied} applied` +
      (purposesPending.length
        ? `, ${purposesPending.length} waiting for their flight to be detected ` +
          `(re-run "npm run seed" after flights:rebuild)`
        : ''),
  )
  console.log(
    'note: all aircraft are verification_status=needs_verification — see DATA_SOURCES.md',
  )
  await closeDb()
}

runCli(main)

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
import { closeDb, getDb } from '../db/client.js'
import { aircraft, costModel, source } from '../db/schema.js'
import { runCli } from '../lib/cli.js'

type SeedSource = {
  id: string
  publisher: string
  title: string
  url?: string
  publishedAt?: string
  type: string
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
  label: string
  appliesToTypeCode?: string
  appliesToAircraftId?: string
  validFrom: string
  validTo?: string | null
  currency: string
  verificationStatus: string
  params: unknown
  notes?: string
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

  for (const entry of registry.sources) {
    await db
      .insert(source)
      .values({
        id: entry.id,
        publisher: entry.publisher,
        title: entry.title,
        url: entry.url ?? null,
        publishedAt: entry.publishedAt ? new Date(`${entry.publishedAt}T00:00:00Z`) : null,
        type: entry.type,
        notes: entry.notes ?? null,
      })
      .onConflictDoUpdate({
        target: source.id,
        set: {
          publisher: entry.publisher,
          title: entry.title,
          url: entry.url ?? null,
          type: entry.type,
          notes: entry.notes ?? null,
          accessedAt: new Date(),
        },
      })
  }

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
      label: entry.label,
      appliesToAircraftId: entry.appliesToAircraftId ?? null,
      appliesToTypeCode: entry.appliesToTypeCode ?? null,
      validFrom: entry.validFrom,
      validTo: entry.validTo ?? null,
      currency: entry.currency,
      params: entry.params,
      verificationStatus: entry.verificationStatus,
      notes: entry.notes ?? null,
    }
    await db.insert(costModel).values(values).onConflictDoUpdate({ target: costModel.id, set: values })
  }

  const [counts] = await db
    .select({
      sources: sql<number>`(select count(*) from ${source})`,
      aircraft: sql<number>`(select count(*) from ${aircraft})`,
      tracked: sql<number>`(select count(*) from ${aircraft} where tracking_enabled)`,
      costModels: sql<number>`(select count(*) from ${costModel})`,
    })
    .from(sql`(select 1) as _`)

  console.log(
    `seeded: ${counts?.sources ?? 0} sources, ${counts?.aircraft ?? 0} aircraft ` +
      `(${counts?.tracked ?? 0} tracked), ${counts?.costModels ?? 0} cost models`,
  )
  console.log(
    'note: all aircraft are verification_status=needs_verification — see DATA_SOURCES.md',
  )
  await closeDb()
}

runCli(main)

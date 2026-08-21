/**
 * Imports the OurAirports reference dataset (public domain) into `airport`.
 *
 * The dataset is cached on disk so a rebuild does not re-download 12 MB, and so the
 * exact file a given import used stays inspectable.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { closeDb, getDb } from '../db/client.js'
import { airport, source } from '../db/schema.js'
import { flag, parseArgs, runCli } from '../lib/cli.js'
import { parseCsv } from '../lib/csv.js'
import { env } from '../lib/env.js'
import { log } from '../lib/log.js'

const CACHE_FILE = './data/cache/airports.csv'
const SOURCE_ID = 'src-ourairports'
const BATCH = 500

async function fetchDataset(force: boolean): Promise<string> {
  const path = resolve(process.cwd(), CACHE_FILE)
  if (!force && existsSync(path)) {
    log.info(`using cached airport dataset: ${CACHE_FILE}`)
    return readFileSync(path, 'utf8')
  }
  log.info(`downloading ${env.airportsDataUrl}`)
  const response = await fetch(env.airportsDataUrl)
  if (!response.ok) throw new Error(`airport dataset download failed: HTTP ${response.status}`)
  const text = await response.text()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
  return text
}

async function main(): Promise<void> {
  const args = parseArgs()
  const text = await fetchDataset(flag(args, 'force'))
  const rows = parseCsv(text)
  const header = rows.shift()
  if (!header) throw new Error('airport dataset is empty')

  const col = (name: string): number => {
    const index = header.indexOf(name)
    if (index === -1) throw new Error(`airport dataset is missing column "${name}"`)
    return index
  }
  const cIdent = col('ident')
  const cType = col('type')
  const cName = col('name')
  const cLat = col('latitude_deg')
  const cLon = col('longitude_deg')
  const cElev = col('elevation_ft')
  const cCountry = col('iso_country')
  const cMunicipality = col('municipality')
  const cScheduled = col('scheduled_service')
  const cIcao = col('icao_code')
  const cIata = col('iata_code')

  const { db } = await getDb()

  await db
    .insert(source)
    .values({
      id: SOURCE_ID,
      publisher: 'OurAirports',
      title: 'OurAirports global airport database (public domain)',
      url: env.airportsDataUrl,
      type: 'airport',
      notes: 'Community-maintained, public domain. Used for airport identification only.',
    })
    .onConflictDoUpdate({ target: source.id, set: { accessedAt: new Date(), url: env.airportsDataUrl } })

  const values: (typeof airport.$inferInsert)[] = []
  let skipped = 0

  for (const row of rows) {
    const ident = row[cIdent]?.trim()
    const lat = Number(row[cLat])
    const lon = Number(row[cLon])
    const type = row[cType]?.trim() ?? ''
    if (!ident || !Number.isFinite(lat) || !Number.isFinite(lon) || type === 'balloonport') {
      skipped++
      continue
    }
    const elevation = Number(row[cElev])
    values.push({
      id: ident,
      ident,
      icao: row[cIcao]?.trim() || null,
      iata: row[cIata]?.trim() || null,
      name: row[cName]?.trim() || ident,
      city: row[cMunicipality]?.trim() || null,
      country: row[cCountry]?.trim() || null,
      latitude: lat,
      longitude: lon,
      elevationFt: Number.isFinite(elevation) ? elevation : null,
      type,
      scheduledService: row[cScheduled]?.trim() === 'yes',
      sourceId: SOURCE_ID,
    })
  }

  for (let i = 0; i < values.length; i += BATCH) {
    const chunk = values.slice(i, i + BATCH)
    await db
      .insert(airport)
      .values(chunk)
      .onConflictDoUpdate({
        target: airport.id,
        set: {
          icao: sql`excluded.icao`,
          iata: sql`excluded.iata`,
          name: sql`excluded.name`,
          city: sql`excluded.city`,
          country: sql`excluded.country`,
          latitude: sql`excluded.latitude`,
          longitude: sql`excluded.longitude`,
          elevationFt: sql`excluded.elevation_ft`,
          type: sql`excluded.type`,
          scheduledService: sql`excluded.scheduled_service`,
        },
      })
    if (i % 10_000 === 0 && i > 0) log.info(`  ${i}/${values.length}`)
  }

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(airport)
  console.log(`airports imported: ${values.length} rows written, ${skipped} skipped, ${count} in table`)
  await closeDb()
}

runCli(main)

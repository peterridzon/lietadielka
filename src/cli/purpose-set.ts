/**
 * npm run purpose:set -- --flight 2026-07-12-om-bya-lzib-kewr \
 *   --title "..." --status probable --source-url https://... --publisher "..."
 *
 * Records why a flight took place. Brief §21: the purpose is never inferred by the
 * software. It is entered by a person, always with a source, and always with an
 * explicit status — and `confirmed` means a source states this aircraft carried this
 * mission, not that the dates happen to line up.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { closeDb, getDb } from '../db/client.js'
import { flight, flightPurpose, source } from '../db/schema.js'
import { optionalString, parseArgs, requireString, runCli } from '../lib/cli.js'

const STATUSES = ['confirmed', 'probable', 'unknown'] as const

async function main(): Promise<void> {
  const args = parseArgs()
  const publicId = requireString(args, 'flight')
  const title = requireString(args, 'title')
  const status = requireString(args, 'status')
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
    throw new Error(`--status must be one of: ${STATUSES.join(', ')}`)
  }

  const sourceUrl = optionalString(args, 'source-url')
  const publisher = optionalString(args, 'publisher')
  if (status !== 'unknown' && (!sourceUrl || !publisher)) {
    throw new Error(
      'A purpose that is not "unknown" needs --source-url and --publisher. ' +
        'An unsourced claim about why a state aircraft flew is exactly what this project must not publish.',
    )
  }

  const { db } = await getDb()
  const rows = await db.select().from(flight).where(eq(flight.publicId, publicId)).limit(1)
  const target = rows[0]
  if (!target) throw new Error(`No flight with public id "${publicId}"`)

  let sourceId: string | null = null
  if (sourceUrl && publisher) {
    sourceId = `src-purpose-${publicId}`
    await db
      .insert(source)
      .values({
        id: sourceId,
        publisher,
        title: optionalString(args, 'source-title') ?? title,
        url: sourceUrl,
        publishedAt: optionalString(args, 'source-date')
          ? new Date(`${optionalString(args, 'source-date')}T00:00:00Z`)
          : null,
        type: optionalString(args, 'source-type') ?? 'government',
        notes: optionalString(args, 'notes') ?? null,
      })
      .onConflictDoUpdate({
        target: source.id,
        set: { publisher, url: sourceUrl, accessedAt: new Date() },
      })
  }

  await db.delete(flightPurpose).where(eq(flightPurpose.flightId, target.id))
  await db.insert(flightPurpose).values({
    id: randomUUID(),
    flightId: target.id,
    title,
    description: optionalString(args, 'description') ?? null,
    status,
    sourceUrl: sourceUrl ?? null,
    sourcePublisher: publisher ?? null,
    sourcePublishedAt: optionalString(args, 'source-date')
      ? new Date(`${optionalString(args, 'source-date')}T00:00:00Z`)
      : null,
    sourceId,
    confidence: status === 'confirmed' ? 1 : status === 'probable' ? 0.5 : 0,
    verifiedBy: optionalString(args, 'by') ?? null,
  })

  console.log(`${publicId}: purpose recorded as ${status.toUpperCase()}`)
  console.log(`  ${title}`)
  if (sourceUrl) console.log(`  source: ${publisher} — ${sourceUrl}`)
  if (status === 'probable') {
    console.log(
      '  note: "probable" means the evidence is circumstantial. It must not be presented\n' +
        '        as an established fact anywhere in the interface.',
    )
  }
  await closeDb()
}

runCli(main)

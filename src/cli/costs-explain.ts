/**
 * npm run costs:explain -- --flight 2026-07-20-om-bya-lzib-lkpr
 *
 * The command-line form of "Ako sme toto vypočítali?" (§77): the formula, the inputs,
 * the source of every value, the period it is valid for, what is missing, and the model
 * version — everything needed to check the number by hand or to reject it.
 */
import { and, desc, eq } from 'drizzle-orm'
import { closeDb, getDb } from '../db/client.js'
import { aircraft, flight, flightCost, source } from '../db/schema.js'
import { parseArgs, requireString, runCli } from '../lib/cli.js'

type Component = {
  category: string
  scope: string
  status: string
  valueLow?: number
  valueMid?: number
  valueHigh?: number
  calculationMethod: string
  sourceIds: string[]
  sourceTier?: string
  confidence: string
  note?: string
}
type Step = {
  label: string
  formula: string
  inputs: Record<string, unknown>
  result?: number | null
  resultUnit?: 'EUR' | 'h' | 'percent'
  sourceIds: string[]
}
type Warning = { code: string; message: string }

const eur = (v: number | null | undefined): string =>
  v == null ? '—' : `${Math.round(v).toLocaleString('sk-SK')} €`

function interval(low: number | null, mid: number | null, high: number | null): string {
  if (mid == null) return 'dáta nedostupné'
  if (low == null || high == null) return eur(mid)
  // A single sourced figure has no spread; printing "1 800 € – 1 800 €" would suggest
  // an interval we did not actually establish.
  if (Math.round(low) === Math.round(high)) return eur(mid)
  return `${eur(low)} – ${eur(high)}   (stred ${eur(mid)})`
}

async function main(): Promise<void> {
  const args = parseArgs()
  const publicId = requireString(args, 'flight')
  const { db } = await getDb()

  const rows = await db
    .select({ flight, registration: aircraft.registration, cost: flightCost })
    .from(flight)
    .innerJoin(aircraft, eq(aircraft.id, flight.aircraftId))
    .leftJoin(flightCost, and(eq(flightCost.flightId, flight.id), eq(flightCost.isCurrent, true)))
    .where(eq(flight.publicId, publicId))
    .orderBy(desc(flightCost.computedAt))
    .limit(1)

  const row = rows[0]
  if (!row) throw new Error(`No flight with public id "${publicId}"`)
  if (!row.cost) {
    console.log(`${publicId}: no cost calculation. Run "npm run costs:recompute" first.`)
    await closeDb()
    return
  }

  const c = row.cost
  const sourceIds = new Set<string>()
  const components = (c.components ?? []) as Component[]
  for (const comp of components) for (const id of comp.sourceIds) sourceIds.add(id)
  const sources = sourceIds.size
    ? await db.select().from(source).where(eq(source.id, [...sourceIds][0]!))
    : []
  const allSources = sourceIds.size
    ? (await db.select().from(source)).filter((s) => sourceIds.has(s.id))
    : sources

  console.log(`\n${publicId}   ${row.registration ?? ''}`)
  console.log('─'.repeat(78))
  console.log(`Odhadované priame prevádzkové náklady   ${interval(c.directLow, c.directMid, c.directHigh)}`)
  console.log(`Odhadované alokované fixné náklady      ${interval(c.fixedLow, c.fixedMid, c.fixedHigh)}`)
  console.log(`Odhadované celkové náklady daňovníka    ${interval(c.fullLow, c.fullMid, c.fullHigh)}`)
  console.log(
    `\nKvalita odhadu: ${({ high: 'VYSOKÁ', medium: 'STREDNÁ', low: 'NÍZKA' } as Record<string, string>)[c.confidence] ?? c.confidence}` +
      `${c.validationWarning ? '   (validačné upozornenie)' : ''}`,
  )
  console.log(
    `Cenová úroveň vstupov: ${c.priceYear ?? 'neznáma'}` +
      (c.priceYearGapYears ? `, let o ${c.priceYearGapYears} r. neskôr, neupravené o infláciu` : ''),
  )
  console.log(
    `Block time: ${(c.blockHours ?? 0).toFixed(2)} h ${c.blockHoursEstimated ? '(odhad: čas vo vzduchu + rolovanie)' : '(meraný)'}`,
  )
  console.log(`Verzia cost modelu: ${c.costModelVersion}   engine: ${c.engineVersion}`)
  console.log(`Prepočítané: ${c.computedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`)

  console.log('\nVÝPOČET')
  for (const step of (c.trace as { steps: Step[] }).steps) {
    console.log(`\n  ${step.label}`)
    console.log(`    ${step.formula}`)
    for (const [k, v] of Object.entries(step.inputs)) {
      if (v === null || v === undefined) continue
      console.log(`      ${k.padEnd(22)} ${String(v)}`)
    }
    if (step.result != null) {
      const unit = step.resultUnit ?? 'EUR'
      const rendered =
        unit === 'EUR' ? eur(step.result) : unit === 'h' ? `${step.result} h` : `${step.result} %`
      console.log(`    = ${rendered}`)
    }
  }

  console.log('\nPOLOŽKY')
  for (const comp of components) {
    const value = comp.status === 'unknown' ? 'dáta nedostupné' : eur(comp.valueMid)
    console.log(
      `  ${comp.category.padEnd(18)} ${comp.scope.padEnd(7)} ${comp.status.padEnd(12)} ${value.padStart(14)}` +
        `   ${comp.sourceTier ?? '--'}  ${comp.calculationMethod}`,
    )
    if (comp.note) console.log(`      ${comp.note}`)
  }

  const missing = (c.missing ?? []) as string[]
  if (missing.length) {
    console.log('\nCELKOVÝ ODHAD NEZAHŔŇA')
    for (const m of missing) console.log(`  – ${m}`)
  }

  const warnings = (c.warnings ?? []) as Warning[]
  if (warnings.length) {
    console.log('\nUPOZORNENIA')
    for (const w of warnings) console.log(`  [${w.code}] ${w.message}`)
  }

  if (allSources.length) {
    console.log('\nZDROJE')
    for (const s of allSources) {
      console.log(`  ${(s.sourceTier ?? '--').padEnd(3)} ${s.publisher} — ${s.title}`)
      if (s.url) console.log(`      ${s.url}`)
    }
  }
  console.log()

  await closeDb()
}

runCli(main)

/**
 * npm run costs:recompute [-- --aircraft OM-BYA]
 *
 * Reprices every flight with the model valid on its date. Previous calculations are
 * retained and marked not current — the audit trail is the table itself.
 */
import { closeDb } from '../db/client.js'
import { findAircraft } from '../db/repositories/aircraft.js'
import { recomputeCosts } from '../pipeline/recompute-costs.js'
import { optionalString, parseArgs, runCli } from '../lib/cli.js'

async function main(): Promise<void> {
  const args = parseArgs()
  const identifier = optionalString(args, 'aircraft')
  let aircraftId: string | undefined
  if (identifier) {
    const target = await findAircraft(identifier)
    if (!target) throw new Error(`Aircraft "${identifier}" is not in the registry`)
    aircraftId = target.id
  }

  const result = await recomputeCosts({ aircraftId })
  console.log(`\ncosted   ${result.costed}\nskipped  ${result.skipped}`)
  for (const [reason, count] of Object.entries(result.reasons)) {
    console.log(`  ${reason}: ${count}`)
  }
  await closeDb()
}

runCli(main)

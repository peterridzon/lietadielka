/** npm run missions:rebuild — groups flights into trips. */
import { closeDb } from '../db/client.js'
import { rebuildMissions } from '../pipeline/rebuild-missions.js'
import { runCli } from '../lib/cli.js'

async function main(): Promise<void> {
  const result = await rebuildMissions()
  console.log(`missions ${result.missions}, legs ${result.legs}`)
  await closeDb()
}

runCli(main)

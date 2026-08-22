/**
 * npm run db:reset -- --derived     drop flights and everything computed from them
 * npm run db:reset -- --all         also drop raw observations (asks for --yes)
 *
 * Dropping derived data is routine: it is how a detector change is rolled out. Dropping
 * raw observations is not — they are the record the whole project rests on, and they
 * cannot be re-downloaded once the provider's retention window has moved past them.
 */
import { sql } from 'drizzle-orm'
import { closeDb, getDb } from '../db/client.js'
import { flag, parseArgs, runCli } from '../lib/cli.js'

async function main(): Promise<void> {
  const args = parseArgs()
  const { db } = await getDb()

  if (flag(args, 'all')) {
    if (!flag(args, 'yes')) {
      throw new Error(
        'Refusing to delete raw ADS-B observations without --yes. ' +
          'Provider archives are short-lived; deleted history is usually unrecoverable.',
      )
    }
    await db.execute(
      sql`truncate raw_adsb_position, import_job, flight_track, flight_cost, flight_purpose, flight, route restart identity cascade`,
    )
    console.log('raw observations and all derived data deleted')
  } else {
    await db.execute(
      sql`truncate flight_track, flight_cost, flight_purpose, flight, route restart identity cascade`,
    )
    console.log('derived data deleted — run "npm run flights:rebuild -- --all" to recreate it')
  }

  await closeDb()
}

runCli(main)

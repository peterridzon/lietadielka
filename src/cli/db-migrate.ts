/** Applies the checked-in SQL migrations to whichever driver is configured. */
import { closeDb, getDb } from '../db/client.js'
import { log } from '../lib/log.js'

async function main(): Promise<void> {
  const { db, driver } = await getDb()
  const folder = './drizzle'

  if (driver === 'postgres') {
    const { migrate } = await import('drizzle-orm/node-postgres/migrator')
    await migrate(db as never, { migrationsFolder: folder })
  } else {
    const { migrate } = await import('drizzle-orm/pglite/migrator')
    await migrate(db as never, { migrationsFolder: folder })
  }

  log.info(`migrations applied (${driver})`)
  await closeDb()
}

main().catch((error: unknown) => {
  log.error('migration failed', error)
  process.exit(1)
})

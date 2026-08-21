/**
 * Database driver selection.
 *
 * Production target is PostgreSQL (`DATABASE_URL`). When it is absent we fall back to
 * PGlite — the same Postgres engine compiled to WASM and embedded in this process —
 * so the pipeline runs with no Docker and no service to install. Same dialect, same
 * migrations, no second schema to keep in sync.
 */
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite'
import { env } from '../lib/env.js'
import { log } from '../lib/log.js'
import * as schema from './schema.js'

export type Database = NodePgDatabase<typeof schema> | PgliteDatabase<typeof schema>
export type DriverKind = 'postgres' | 'pglite'

type Handle = {
  db: Database
  driver: DriverKind
  close: () => Promise<void>
  /** Escape hatch for the migrator, which needs the driver-specific client. */
  raw: unknown
}

let handle: Handle | null = null

export async function getDb(): Promise<Handle> {
  if (handle) return handle

  if (env.databaseUrl) {
    const { Pool } = await import('pg')
    const pool = new Pool({ connectionString: env.databaseUrl })
    log.debug(`database: postgres (${env.databaseUrl.replace(/:[^:@/]*@/, ':***@')})`)
    handle = {
      db: drizzlePg(pool, { schema }),
      driver: 'postgres',
      close: async () => {
        await pool.end()
      },
      raw: pool,
    }
  } else {
    const { PGlite } = await import('@electric-sql/pglite')
    const client = new PGlite(env.pglitePath)
    log.debug(`database: pglite (${env.pglitePath})`)
    handle = {
      db: drizzlePglite(client, { schema }),
      driver: 'pglite',
      close: async () => {
        await client.close()
      },
      raw: client,
    }
  }

  return handle
}

export async function closeDb(): Promise<void> {
  if (!handle) return
  await handle.close()
  handle = null
}

export { schema }

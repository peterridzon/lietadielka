import type { Config } from 'drizzle-kit'

/**
 * Migrations are always generated against the PostgreSQL dialect. PGlite runs the
 * exact same SQL, so a single set of migrations covers both drivers.
 */
export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  strict: true,
  verbose: true,
} satisfies Config

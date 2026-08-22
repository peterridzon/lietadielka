/**
 * Central environment configuration.
 *
 * Every tunable in the pipeline is reachable from here, so that a reviewer can see
 * the full parameter surface of the algorithms in one file (see ARCHITECTURE.md §12).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Minimal .env loader — we do not want a dependency for six lines.
function loadDotEnv(file: string): void {
  let text: string
  try {
    text = readFileSync(resolve(process.cwd(), file), 'utf8')
  } catch {
    return
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    if (process.env[key] !== undefined) continue
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

loadDotEnv('.env.local')
loadDotEnv('.env')

const str = (key: string, fallback: string): string => process.env[key] ?? fallback
const opt = (key: string): string | undefined => process.env[key] || undefined
const num = (key: string, fallback: number): number => {
  const raw = process.env[key]
  if (raw === undefined || raw === '') return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) throw new Error(`Environment variable ${key} is not a number: ${raw}`)
  return parsed
}
const bool = (key: string, fallback: boolean): boolean => {
  const raw = process.env[key]
  if (raw === undefined || raw === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase())
}

export const env = {
  databaseUrl: opt('DATABASE_URL'),
  pglitePath: str('PGLITE_PATH', './data/pglite'),

  publicationDelayHours: num('PUBLICATION_DELAY_HOURS', 6),

  adsbProvider: str('ADSB_PROVIDER', 'adsblol'),
  adsblolHistoryBaseUrl: str('ADSBLOL_HISTORY_BASE_URL', 'https://globe.adsb.lol'),
  adsblolApiBaseUrl: str('ADSBLOL_API_BASE_URL', 'https://api.adsb.lol'),
  adsbRateLimitRps: num('ADSB_RATE_LIMIT_RPS', 2),
  adsbHttpTimeoutMs: num('ADSB_HTTP_TIMEOUT_MS', 45_000),
  adsbCacheDir: str('ADSB_CACHE_DIR', './data/cache/adsb'),
  /** Busy airframes used to prove a day exists in the adsb.lol archive. */
  adsblolDaySentinels: (opt('ADSBLOL_DAY_SENTINELS') ?? '4ca766,4853d2,3c6444')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),

  openskyClientId: opt('OPENSKY_CLIENT_ID'),
  openskyClientSecret: opt('OPENSKY_CLIENT_SECRET'),
  openskyBaseUrl: str('OPENSKY_BASE_URL', 'https://opensky-network.org/api'),

  airportsDataUrl: str(
    'AIRPORTS_DATA_URL',
    'https://davidmegginson.github.io/ourairports-data/airports.csv',
  ),

  detect: {
    gapSoftSeconds: num('DETECT_GAP_SOFT_SECONDS', 1_800),
    gapHardSeconds: num('DETECT_GAP_HARD_SECONDS', 21_600),
    minGroundSeconds: num('DETECT_MIN_GROUND_SECONDS', 300),
    minFlightSeconds: num('DETECT_MIN_FLIGHT_SECONDS', 240),
  },
  airportMatch: {
    searchRadiusKm: num('AIRPORT_SEARCH_RADIUS_KM', 10),
    minConfidence: num('AIRPORT_MIN_CONFIDENCE', 0.5),
  },

  allowUnverifiedCostModels: bool('ALLOW_UNVERIFIED_COST_MODELS', false),
  demoDataEnabled: bool('DEMO_DATA_ENABLED', false),
  logLevel: str('LOG_LEVEL', 'info'),
} as const

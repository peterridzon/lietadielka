/** Minimal argv parser: `--key value`, `--flag`, `--key=value`. */
export type Args = Record<string, string | boolean>

export function parseArgs(argv: string[] = process.argv.slice(2)): Args {
  const args: Args = {}
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token || !token.startsWith('--')) continue
    const body = token.slice(2)
    const eq = body.indexOf('=')
    if (eq !== -1) {
      args[body.slice(0, eq)] = body.slice(eq + 1)
      continue
    }
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      args[body] = next
      i++
    } else {
      args[body] = true
    }
  }
  return args
}

export function requireString(args: Args, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing required argument --${key}`)
  }
  return value
}

export function optionalString(args: Args, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function flag(args: Args, key: string): boolean {
  return args[key] === true || args[key] === 'true'
}

/** Parses YYYY-MM-DD as UTC midnight; rejects anything else so ranges stay unambiguous. */
export function parseUtcDate(value: string, endOfDay = false): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Expected a date as YYYY-MM-DD, got "${value}"`)
  }
  const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`)
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`)
  return date
}

export function runCli(main: () => Promise<void>): void {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`\nerror: ${message}\n`)
    if (process.env.LOG_LEVEL === 'debug' && error instanceof Error) console.error(error.stack)
    process.exit(1)
  })
}

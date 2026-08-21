import { env } from './env.js'

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const
type Level = keyof typeof LEVELS

const threshold = LEVELS[(env.logLevel as Level) in LEVELS ? (env.logLevel as Level) : 'info']

function emit(level: Level, message: string, extra?: unknown): void {
  if (LEVELS[level] > threshold) return
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}`
  if (extra === undefined) console.error(line)
  else console.error(line, extra)
}

export const log = {
  error: (m: string, e?: unknown) => emit('error', m, e),
  warn: (m: string, e?: unknown) => emit('warn', m, e),
  info: (m: string, e?: unknown) => emit('info', m, e),
  debug: (m: string, e?: unknown) => emit('debug', m, e),
}

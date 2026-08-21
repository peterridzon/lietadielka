import { env } from './env.js'
import { log } from './log.js'

/** Simple token-bucket-free limiter: serialises calls and spaces them evenly. */
export class RateLimiter {
  private next = 0
  constructor(private readonly minIntervalMs: number) {}

  async wait(): Promise<void> {
    const now = Date.now()
    const at = Math.max(now, this.next)
    this.next = at + this.minIntervalMs
    if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now))
  }
}

export const adsbLimiter = new RateLimiter(Math.ceil(1000 / Math.max(env.adsbRateLimitRps, 0.1)))

export type FetchOptions = {
  attempts?: number
  timeoutMs?: number
  headers?: Record<string, string>
  /** HTTP statuses that mean "definitively no data", returned as null rather than thrown. */
  emptyStatuses?: number[]
}

/**
 * Fetch with a timeout, rate limiting and exponential backoff.
 * Returns the raw body, or null when the server answered with an "empty" status.
 */
export async function fetchWithRetry(
  url: string,
  options: FetchOptions = {},
): Promise<Uint8Array | null> {
  const attempts = options.attempts ?? 3
  const timeoutMs = options.timeoutMs ?? env.adsbHttpTimeoutMs
  const emptyStatuses = options.emptyStatuses ?? [404, 410]

  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt++) {
    await adsbLimiter.wait()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'user-agent': 'lietadielka/0.1 (+transparency research)', ...options.headers },
      })
      if (emptyStatuses.includes(response.status)) return null
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return new Uint8Array(await response.arrayBuffer())
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      if (attempt < attempts) {
        const delay = 500 * 2 ** (attempt - 1)
        log.debug(`fetch failed (${message}), retry ${attempt}/${attempts - 1} in ${delay}ms: ${url}`)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    } finally {
      clearTimeout(timer)
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

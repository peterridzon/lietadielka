/**
 * Publication delay — the project's central safety rule.
 *
 * No public surface may reveal where a state aircraft is now, where it is going, or
 * that it is in the air at all. A flight becomes public only once it has ended and
 * PUBLICATION_DELAY_HOURS have passed since the landing.
 *
 * Every public query goes through this module. It is deliberately tiny, pure and
 * clock-injectable so it can be exhaustively tested (see tests/publication.test.ts).
 */

export type PublishableFlight = {
  arrivalTime: Date | null
  /** True when the landing was never observed — the aircraft may still have been airborne. */
  arrivalTimeEstimated?: boolean
}

/**
 * The instant a flight may first be shown publicly, or null when it never can be
 * (no arrival at all — the flight has not ended as far as we know).
 */
export function publishableAt(flight: PublishableFlight, delayHours: number): Date | null {
  if (!flight.arrivalTime) return null
  return new Date(flight.arrivalTime.getTime() + delayHours * 3_600_000)
}

export function isPublishable(
  flight: PublishableFlight,
  delayHours: number,
  now: Date = new Date(),
): boolean {
  const at = publishableAt(flight, delayHours)
  if (at === null) return false
  return at.getTime() <= now.getTime()
}

/**
 * Guard for anything about to leave the process. Throws rather than filtering,
 * because a leak here is a safety failure and should never be silently absorbed.
 */
export function assertPublishable(
  flight: PublishableFlight,
  delayHours: number,
  now: Date = new Date(),
): void {
  if (!isPublishable(flight, delayHours, now)) {
    throw new Error(
      'Refusing to expose a flight that is not yet publishable. ' +
        'See SECURITY.md: state aircraft positions are never published in real time.',
    )
  }
}

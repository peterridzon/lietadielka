/**
 * What counts as the current fleet.
 *
 * A withdrawn aircraft stays in the registry so its historical flights remain
 * attributable, but it must not appear in anything describing the fleet today —
 * headline counts, cost allocation, utilisation denominators, route analytics or the
 * collector's polling list. Getting this wrong inflates the apparent size of the fleet
 * and dilutes every per-aircraft figure.
 */

export type FleetMember = {
  status: string
  activeFrom?: string | null
  activeUntil?: string | null
  trackingEnabled?: boolean
}

function toDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Was this aircraft in service on the given date? */
export function isActiveAt(aircraft: FleetMember, date: Date): boolean {
  const day = toDay(date)
  if (aircraft.activeFrom && aircraft.activeFrom > day) return false
  if (aircraft.activeUntil && aircraft.activeUntil < day) return false
  // `planned` has not entered service; `retired` and `stored` describe a state that a
  // date range alone does not capture, so an explicit status wins where it says "no".
  if (aircraft.status === 'planned') return false
  if ((aircraft.status === 'retired' || aircraft.status === 'stored') && !aircraft.activeUntil) {
    return false
  }
  return true
}

/** Is this aircraft part of the fleet as it stands now? */
export function isCurrentlyActive(aircraft: FleetMember, now: Date = new Date()): boolean {
  return aircraft.status === 'active' && isActiveAt(aircraft, now)
}

/**
 * Should the collector be asking a provider about this aircraft on this date?
 *
 * The question is whether the aircraft was flying THEN, not whether it belongs to the
 * fleet now. Those coincide for the daily run and part company the moment history is
 * filled in: OM-BYC flew until February 2025 and is retired today, and asking
 * `isCurrentlyActive` would have quietly left its flights out of 2025 — with nothing on
 * the coverage calendar to show an aircraft had been skipped, which is worse than a
 * wrong number.
 */
export function shouldPoll(aircraft: FleetMember, when: Date = new Date()): boolean {
  return aircraft.trackingEnabled === true && isActiveAt(aircraft, when)
}

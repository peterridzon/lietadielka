/**
 * Mission grouping.
 *
 * A round trip is one mission. Comparing a single outbound leg against a return ticket
 * would be meaningless, so cost and commercial comparison happen at mission level.
 *
 * Grouping here is `automatic` and carries a confidence. A source that states the trip
 * makes it `confirmed`; a person can override it to `manual`.
 */

export type MissionLegInput = {
  flightId: string
  publicId: string
  aircraftId: string
  departureTime: Date
  arrivalTime: Date
  /** Identified airport ident, or null when it was never established. */
  departureAirport: string | null
  arrivalAirport: string | null
  airborneSeconds: number
  blockSeconds: number | null
  distanceKm: number
}

export type MissionGroup = {
  aircraftId: string
  legs: MissionLegInput[]
  startedAt: Date
  endedAt: Date
  routeKey: string
  airborneSeconds: number
  blockSeconds: number | null
  distanceKm: number
  grouping: 'automatic'
  confidence: number
}

export type MissionGroupingConfig = {
  /** Airport the fleet returns to; arriving there closes a mission. */
  homeBase: string
  /** Longest turnaround that still counts as the same trip. */
  maxTurnaroundHours: number
}

export const DEFAULT_MISSION_CONFIG: MissionGroupingConfig = {
  homeBase: 'LZIB',
  maxTurnaroundHours: 24 * 10,
}

export function groupMissions(
  legs: MissionLegInput[],
  config: Partial<MissionGroupingConfig> = {},
): MissionGroup[] {
  const cfg = { ...DEFAULT_MISSION_CONFIG, ...config }
  const byAircraft = new Map<string, MissionLegInput[]>()
  for (const leg of legs) {
    const list = byAircraft.get(leg.aircraftId)
    if (list) list.push(leg)
    else byAircraft.set(leg.aircraftId, [leg])
  }

  const missions: MissionGroup[] = []

  for (const [aircraftId, all] of byAircraft) {
    const ordered = [...all].sort((a, b) => a.departureTime.getTime() - b.departureTime.getTime())
    let current: MissionLegInput[] = []

    const close = (): void => {
      if (current.length > 0) missions.push(finish(aircraftId, current))
      current = []
    }

    for (const leg of ordered) {
      if (current.length === 0) {
        current.push(leg)
      } else {
        const previous = current[current.length - 1]!
        const turnaroundHours = (leg.departureTime.getTime() - previous.arrivalTime.getTime()) / 3_600_000
        // The chain continues only if the aircraft left from where it last arrived, and
        // did so soon enough. Anything else starts a new trip.
        const continues =
          turnaroundHours >= 0 &&
          turnaroundHours <= cfg.maxTurnaroundHours &&
          previous.arrivalAirport !== null &&
          leg.departureAirport !== null &&
          previous.arrivalAirport === leg.departureAirport

        if (continues) current.push(leg)
        else {
          close()
          current.push(leg)
        }
      }

      // Back at base: the trip is over, even if the aircraft goes out again tomorrow.
      if (leg.arrivalAirport === cfg.homeBase) close()
    }

    close()
  }

  missions.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
  return missions
}

function finish(aircraftId: string, legs: MissionLegInput[]): MissionGroup {
  const first = legs[0]!
  const last = legs[legs.length - 1]!
  const stops = [first.departureAirport ?? 'UNKNOWN', ...legs.map((l) => l.arrivalAirport ?? 'UNKNOWN')]

  const anyUnknown = legs.some((l) => l.departureAirport === null || l.arrivalAirport === null)
  const anyBlockMissing = legs.some((l) => l.blockSeconds === null)

  // A single leg is trivially a correct group. A chain is only as certain as the
  // airports that link it, so an unidentified endpoint drags the confidence down.
  const confidence = legs.length === 1 ? (anyUnknown ? 0.6 : 0.95) : anyUnknown ? 0.5 : 0.85

  return {
    aircraftId,
    legs,
    startedAt: first.departureTime,
    endedAt: last.arrivalTime,
    routeKey: stops.join('-'),
    airborneSeconds: legs.reduce((s, l) => s + l.airborneSeconds, 0),
    blockSeconds: anyBlockMissing ? null : legs.reduce((s, l) => s + (l.blockSeconds ?? 0), 0),
    distanceKm: legs.reduce((s, l) => s + l.distanceKm, 0),
    grouping: 'automatic',
    confidence,
  }
}

/**
 * Date, aircraft and route are not unique: an aircraft that flies two round trips out of
 * its home base in one day produces two missions keyed 2026-02-05-9633-lzib-lzib, and the
 * second one fails to insert. Flight ids already carry the departure time for exactly this
 * reason; missions were left without it, and only a fuller record made it show.
 */
export function missionPublicId(group: MissionGroup, registration: string): string {
  const iso = group.startedAt.toISOString()
  const date = iso.slice(0, 10)
  const time = iso.slice(11, 16).replace(':', '')
  const slug = (v: string): string => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${date}-${time}-${slug(registration)}-${slug(group.routeKey)}`
}

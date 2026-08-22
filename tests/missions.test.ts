import { describe, expect, it } from 'vitest'
import { groupMissions, type MissionLegInput } from '../src/core/missions/group.js'

let counter = 0
function leg(
  from: string | null,
  to: string | null,
  departure: string,
  arrival: string,
  aircraftId = 'ac-1',
): MissionLegInput {
  counter++
  return {
    flightId: `f${counter}`,
    publicId: `f${counter}`,
    aircraftId,
    departureTime: new Date(departure),
    arrivalTime: new Date(arrival),
    departureAirport: from,
    arrivalAirport: to,
    airborneSeconds: 3600,
    blockSeconds: 4200,
    distanceKm: 500,
  }
}

describe('groupMissions', () => {
  it('treats an out-and-back as one mission', () => {
    const missions = groupMissions([
      leg('LZIB', 'EBBR', '2026-05-14T06:00:00Z', '2026-05-14T07:45:00Z'),
      leg('EBBR', 'LZIB', '2026-05-14T16:00:00Z', '2026-05-14T17:40:00Z'),
    ])
    expect(missions).toHaveLength(1)
    expect(missions[0]!.legs).toHaveLength(2)
    expect(missions[0]!.routeKey).toBe('LZIB-EBBR-LZIB')
  })

  it('keeps a multi-stop trip together until it reaches home', () => {
    const missions = groupMissions([
      leg('LZIB', 'EBBR', '2026-05-14T06:00:00Z', '2026-05-14T07:45:00Z'),
      leg('EBBR', 'LFPG', '2026-05-15T09:00:00Z', '2026-05-15T10:00:00Z'),
      leg('LFPG', 'LZIB', '2026-05-16T14:00:00Z', '2026-05-16T16:00:00Z'),
    ])
    expect(missions).toHaveLength(1)
    expect(missions[0]!.routeKey).toBe('LZIB-EBBR-LFPG-LZIB')
  })

  it('starts a new mission after the aircraft has come home', () => {
    const missions = groupMissions([
      leg('LZIB', 'EBBR', '2026-05-14T06:00:00Z', '2026-05-14T07:45:00Z'),
      leg('EBBR', 'LZIB', '2026-05-14T16:00:00Z', '2026-05-14T17:40:00Z'),
      leg('LZIB', 'LKPR', '2026-05-15T06:00:00Z', '2026-05-15T06:40:00Z'),
      leg('LKPR', 'LZIB', '2026-05-15T16:00:00Z', '2026-05-15T16:35:00Z'),
    ])
    expect(missions).toHaveLength(2)
  })

  it('does not chain legs that do not join up', () => {
    const missions = groupMissions([
      leg('LZIB', 'EBBR', '2026-05-14T06:00:00Z', '2026-05-14T07:45:00Z'),
      // Departs from somewhere else entirely: coverage was lost in between.
      leg('EDDF', 'LZIB', '2026-05-14T16:00:00Z', '2026-05-14T17:40:00Z'),
    ])
    expect(missions).toHaveLength(2)
  })

  it('never merges two aircraft', () => {
    const missions = groupMissions([
      leg('LZIB', 'EBBR', '2026-05-14T06:00:00Z', '2026-05-14T07:45:00Z', 'ac-1'),
      leg('EBBR', 'LZIB', '2026-05-14T16:00:00Z', '2026-05-14T17:40:00Z', 'ac-2'),
    ])
    expect(missions).toHaveLength(2)
  })

  it('breaks the chain when the turnaround is implausibly long', () => {
    const missions = groupMissions(
      [
        leg('LZIB', 'EBBR', '2026-05-14T06:00:00Z', '2026-05-14T07:45:00Z'),
        leg('EBBR', 'LZIB', '2026-07-20T16:00:00Z', '2026-07-20T17:40:00Z'),
      ],
      { maxTurnaroundHours: 24 * 10 },
    )
    expect(missions).toHaveLength(2)
  })

  it('lowers confidence when an endpoint was never identified', () => {
    const [certain] = groupMissions([leg('LZIB', 'EBBR', '2026-05-14T06:00:00Z', '2026-05-14T07:45:00Z')])
    const [uncertain] = groupMissions([leg('LZIB', null, '2026-05-14T06:00:00Z', '2026-05-14T07:45:00Z')])
    expect(uncertain!.confidence).toBeLessThan(certain!.confidence)
  })

  it('sums airborne time and distance across the mission', () => {
    const [missionGroup] = groupMissions([
      leg('LZIB', 'EBBR', '2026-05-14T06:00:00Z', '2026-05-14T07:45:00Z'),
      leg('EBBR', 'LZIB', '2026-05-14T16:00:00Z', '2026-05-14T17:40:00Z'),
    ])
    expect(missionGroup!.airborneSeconds).toBe(7200)
    expect(missionGroup!.distanceKm).toBe(1000)
    expect(missionGroup!.blockSeconds).toBe(8400)
  })

  it('reports block time as unknown when any leg lacks it', () => {
    const legs = [
      leg('LZIB', 'EBBR', '2026-05-14T06:00:00Z', '2026-05-14T07:45:00Z'),
      leg('EBBR', 'LZIB', '2026-05-14T16:00:00Z', '2026-05-14T17:40:00Z'),
    ]
    legs[1]!.blockSeconds = null
    expect(groupMissions(legs)[0]!.blockSeconds).toBeNull()
  })
})

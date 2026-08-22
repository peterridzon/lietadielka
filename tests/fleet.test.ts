/**
 * Fleet membership and aircraft identity.
 *
 * Two failure modes these guard against, both of which distort every per-aircraft
 * figure: counting a withdrawn aircraft as part of the fleet, and treating a callsign
 * as if it named an airframe.
 */
import { describe, expect, it } from 'vitest'
import { isActiveAt, isCurrentlyActive, shouldPoll } from '../src/core/fleet.js'

const NOW = new Date('2026-08-22T00:00:00Z')

const active = { status: 'active', activeFrom: '2016-06-14', activeUntil: null, trackingEnabled: true }
const retired = { status: 'retired', activeFrom: '2016-09-26', activeUntil: '2025-02-11', trackingEnabled: false }

describe('current fleet', () => {
  it('counts an in-service aircraft', () => {
    expect(isCurrentlyActive(active, NOW)).toBe(true)
    expect(shouldPoll(active, NOW)).toBe(true)
  })

  it('excludes an aircraft withdrawn last year', () => {
    expect(isCurrentlyActive(retired, NOW)).toBe(false)
    expect(shouldPoll(retired, NOW)).toBe(false)
  })

  it('still counts it on a date before it was withdrawn', () => {
    expect(isActiveAt(retired, new Date('2024-06-01T00:00:00Z'))).toBe(true)
    expect(isActiveAt(retired, new Date('2025-06-01T00:00:00Z'))).toBe(false)
  })

  it('treats the withdrawal date itself as the last day in service', () => {
    expect(isActiveAt(retired, new Date('2025-02-11T00:00:00Z'))).toBe(true)
    expect(isActiveAt(retired, new Date('2025-02-12T00:00:00Z'))).toBe(false)
  })

  it('excludes an aircraft not yet delivered', () => {
    expect(isCurrentlyActive({ status: 'planned', activeFrom: null, activeUntil: null }, NOW)).toBe(false)
  })

  it('excludes a stored aircraft even with no end date recorded', () => {
    expect(isCurrentlyActive({ status: 'stored', activeFrom: '2020-01-01', activeUntil: null }, NOW)).toBe(false)
  })

  it('does not poll an active aircraft whose tracking is switched off', () => {
    expect(shouldPoll({ ...active, trackingEnabled: false }, NOW)).toBe(false)
  })

  it('excludes an aircraft before its in-service date', () => {
    expect(isActiveAt(active, new Date('2015-01-01T00:00:00Z'))).toBe(false)
  })
})

/**
 * The publication delay is the project's safety rule, so these tests are deliberately
 * exhaustive around the boundary. Brief §45: nothing in flight, and nothing that has
 * only just landed, may ever be reachable.
 */
import { describe, expect, it } from 'vitest'
import { assertPublishable, isPublishable, publishableAt } from '../src/core/publication.js'

const DELAY = 6
const landed = new Date('2026-08-17T09:21:00Z')
const at = (offsetHours: number): Date => new Date(landed.getTime() + offsetHours * 3_600_000)

describe('publishableAt', () => {
  it('is the arrival plus the configured delay', () => {
    expect(publishableAt({ arrivalTime: landed }, DELAY)?.toISOString()).toBe(
      '2026-08-17T15:21:00.000Z',
    )
  })

  it('is null for a flight with no arrival', () => {
    expect(publishableAt({ arrivalTime: null }, DELAY)).toBeNull()
  })
})

describe('isPublishable', () => {
  it('refuses a flight that has not landed, no matter how old the departure', () => {
    expect(isPublishable({ arrivalTime: null }, DELAY, at(1000))).toBe(false)
  })

  it('refuses a flight that landed less than the delay ago', () => {
    expect(isPublishable({ arrivalTime: landed }, DELAY, at(0))).toBe(false)
    expect(isPublishable({ arrivalTime: landed }, DELAY, at(5.99))).toBe(false)
  })

  it('allows a flight exactly at the boundary and after', () => {
    expect(isPublishable({ arrivalTime: landed }, DELAY, at(6))).toBe(true)
    expect(isPublishable({ arrivalTime: landed }, DELAY, at(6.01))).toBe(true)
    expect(isPublishable({ arrivalTime: landed }, DELAY, at(1000))).toBe(true)
  })

  it('honours a longer configured delay', () => {
    expect(isPublishable({ arrivalTime: landed }, 24, at(12))).toBe(false)
    expect(isPublishable({ arrivalTime: landed }, 24, at(24))).toBe(true)
  })

  it('never publishes a future arrival', () => {
    expect(isPublishable({ arrivalTime: at(10) }, DELAY, at(0))).toBe(false)
  })
})

describe('assertPublishable', () => {
  it('throws rather than silently filtering', () => {
    expect(() => assertPublishable({ arrivalTime: landed }, DELAY, at(1))).toThrow(
      /not yet publishable/,
    )
    expect(() => assertPublishable({ arrivalTime: null }, DELAY, at(1))).toThrow()
  })

  it('passes a flight that is old enough', () => {
    expect(() => assertPublishable({ arrivalTime: landed }, DELAY, at(7))).not.toThrow()
  })
})

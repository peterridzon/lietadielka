import type { ConfidenceLabel } from '../types.js'
import type { FlightCostComponent, Interval } from './types.js'

/**
 * Sums components into a low/mid/high envelope.
 *
 * The conservative envelope — Σ lows and Σ highs — rather than a quadrature sum. These
 * inputs are not independent measurements of the same quantity, and treating them as if
 * they were would produce a narrower interval than the evidence supports.
 *
 * Components with status `unknown` contribute nothing and are reported separately, so a
 * missing figure never silently becomes a zero.
 */
export function sumComponents(components: FlightCostComponent[]): Interval | null {
  const counted = components.filter(
    (c) => c.status === 'known' || c.status === 'known_zero' || c.status === 'estimated',
  )
  if (counted.length === 0) return null

  let low = 0
  let mid = 0
  let high = 0
  for (const c of counted) {
    const m = c.valueMid ?? 0
    low += c.valueLow ?? m
    mid += m
    high += c.valueHigh ?? m
  }
  return { low, mid, high }
}

export function addIntervals(a: Interval | null, b: Interval | null): Interval | null {
  if (!a) return b
  if (!b) return a
  return { low: a.low + b.low, mid: a.mid + b.mid, high: a.high + b.high }
}

export function scaleInterval(v: Interval, factor: number): Interval {
  return { low: v.low * factor, mid: v.mid * factor, high: v.high * factor }
}

/**
 * Rounds to the precision the inputs support: nearest 100 € above 1 000 €, nearest 10 €
 * above 100 €, nearest euro below that. `€12 347.29` claims an accuracy we do not have.
 */
export function roundInterval(v: Interval): Interval {
  return { low: roundMoney(v.low), mid: roundMoney(v.mid), high: roundMoney(v.high) }
}

export function roundMoney(value: number): number {
  const magnitude = Math.abs(value)
  if (magnitude >= 1_000) return Math.round(value / 100) * 100
  if (magnitude >= 100) return Math.round(value / 10) * 10
  return Math.round(value)
}

const RANK: Record<ConfidenceLabel, number> = { low: 0, medium: 1, high: 2 }
const LABEL: ConfidenceLabel[] = ['low', 'medium', 'high']

/** The weakest link. A total is never more trustworthy than its shakiest input. */
export function weakest(...values: (ConfidenceLabel | undefined)[]): ConfidenceLabel {
  let rank = 2
  for (const v of values) if (v && RANK[v] < rank) rank = RANK[v]
  return LABEL[rank]!
}

export function capConfidence(value: ConfidenceLabel, ceiling: ConfidenceLabel): ConfidenceLabel {
  return RANK[value] <= RANK[ceiling] ? value : ceiling
}

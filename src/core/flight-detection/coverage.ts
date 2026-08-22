import { haversineKm } from '../geo.js'
import type { AdsbPosition, CoverageGap } from '../types.js'
import type { PointState } from './classify.js'
import type { DetectionConfig } from './config.js'

export type CoverageMetrics = {
  /** 0..1 — share of the flight's duration that is actually covered by fixes. */
  dataCoverage: number
  positionCount: number
  maxGapSeconds: number
  medianIntervalSeconds: number
  gaps: CoverageGap[]
  /** Kilometres of the measured distance that were bridged across a gap. */
  distanceFromGapsKm: number
}

/**
 * Coverage is the share of the flight's wall-clock duration for which we hold fixes.
 * Any interval longer than `coverageGapSeconds` counts in full against it, which is
 * pessimistic on purpose: we would rather understate coverage than overstate it.
 */
export function computeCoverage(
  positions: AdsbPosition[],
  states: PointState[],
  config: DetectionConfig,
): CoverageMetrics {
  if (positions.length < 2) {
    return {
      dataCoverage: 0,
      positionCount: positions.length,
      maxGapSeconds: 0,
      medianIntervalSeconds: 0,
      gaps: [],
      distanceFromGapsKm: 0,
    }
  }

  const intervals: number[] = []
  const gaps: CoverageGap[] = []
  let uncoveredSeconds = 0
  let maxGapSeconds = 0
  let distanceFromGapsKm = 0

  for (let i = 1; i < positions.length; i++) {
    const previous = positions[i - 1]!
    const point = positions[i]!
    const seconds = (point.timestamp.getTime() - previous.timestamp.getTime()) / 1000
    intervals.push(seconds)
    if (seconds > maxGapSeconds) maxGapSeconds = seconds

    if (seconds > config.coverageGapSeconds) {
      const distanceKm = haversineKm(previous, point)
      uncoveredSeconds += seconds
      distanceFromGapsKm += distanceKm
      gaps.push({
        fromTs: previous.timestamp,
        toTs: point.timestamp,
        seconds,
        distanceKm,
        airborne: states[i - 1] === 'air' && states[i] === 'air',
      })
    }
  }

  const totalSeconds =
    (positions[positions.length - 1]!.timestamp.getTime() - positions[0]!.timestamp.getTime()) / 1000

  return {
    dataCoverage: totalSeconds > 0 ? Math.max(0, Math.min(1, 1 - uncoveredSeconds / totalSeconds)) : 0,
    positionCount: positions.length,
    maxGapSeconds: Math.round(maxGapSeconds),
    medianIntervalSeconds: median(intervals),
    gaps,
    distanceFromGapsKm,
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!
}

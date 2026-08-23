/**
 * Airport identification for the two ends of a flight.
 *
 * Being the closest airport is never enough on its own. The score combines distance,
 * how plausible the aerodrome is for the aircraft, and — decisively — whether we saw
 * the aircraft on the ground there at all. Two aerodromes side by side reduce each
 * other's confidence rather than one silently winning.
 */
import type { AirportIndex, AirportRecord } from './spatial-index.js'

export type AirportMatchOptions = {
  /** Search radius when the anchor fix was recorded on the ground. */
  groundRadiusKm: number
  /** Wider radius when we only know where the track ended, not where it landed. */
  airborneRadiusKm: number
  /** Below this the airport is reported as "unknown / probable" instead of certain. */
  minConfidence: number
  /**
   * Confidence ceiling for an airborne anchor, by height above field elevation.
   *
   * A flat ceiling was wrong, and wrong in a way that threw away good evidence: it sat
   * below the acceptance threshold, so no airborne anchor could ever name an airport —
   * not even one 2 km from Düsseldorf at 150 ft below field elevation, which is an
   * aircraft on the runway. How convincing an airborne fix is depends entirely on how
   * low it is, so the ceiling does too.
   */
  airborneCeilingByAgl: { maxAglFt: number; ceiling: number }[]
  /** Distance beyond the aerodrome footprint at which the score falls to 1/e. */
  distanceDecayKm: number
  /**
   * The same, for an airborne anchor — deliberately looser. A parked aircraft is metres
   * from its stand; one on final approach is routinely ten kilometres out and still
   * unambiguously landing there.
   */
  airborneDistanceDecayKm: number
  /**
   * Above this height above field elevation, the fix says nothing about which airport
   * was used. A track that ends at cruise altitude gets no airport at all — not even a
   * "probable" one, because naming the nearest airstrip under the flight path invents
   * a destination out of an overflight.
   */
  maxAnchorAltitudeAglFt: number
  /** Below this score, a candidate is too weak to be worth showing as "probable". */
  minProbableConfidence: number
  isRotorcraft: boolean
}

export const DEFAULT_MATCH_OPTIONS: AirportMatchOptions = {
  groundRadiusKm: 10,
  airborneRadiusKm: 25,
  minConfidence: 0.5,
  airborneCeilingByAgl: [
    { maxAglFt: 500, ceiling: 0.9 },    // on or just off the runway
    { maxAglFt: 1500, ceiling: 0.78 },  // final approach or initial climb
    { maxAglFt: 3000, ceiling: 0.62 },  // in the circuit
    { maxAglFt: 6000, ceiling: 0.45 },  // terminal area, could be passing through
  ],
  distanceDecayKm: 2.5,
  airborneDistanceDecayKm: 8,
  maxAnchorAltitudeAglFt: 5_000,
  minProbableConfidence: 0.15,
  isRotorcraft: false,
}

export type AirportCandidate = {
  airport: AirportRecord
  distanceKm: number
  score: number
}

export type AirportMatch = {
  /** Set only when confidence reaches the threshold. */
  airport: AirportRecord | null
  /** Best candidate regardless of threshold — shown as "probable" in the UI. */
  probable: AirportRecord | null
  confidence: number
  candidates: AirportCandidate[]
  /** Why the result looks the way it does, for the methodology panel. */
  explanation: string
}

/** Runner-up share of the winner's score above which the two become hard to tell apart. */
const AMBIGUITY_THRESHOLD = 0.7

const TYPE_WEIGHTS: Record<string, number> = {
  large_airport: 1.0,
  medium_airport: 0.95,
  small_airport: 0.8,
  seaplane_base: 0.4,
  heliport: 0.5,
  closed: 0.2,
}

/**
 * Approximate radius of the aerodrome itself, in kilometres.
 *
 * Reference datasets give an airport as a single point, usually the aerodrome
 * reference point, while an aircraft parks on a stand a kilometre or more away. Inside
 * this footprint the distance to the reference point carries no information, so it must
 * not be penalised — that alone was costing a correct match at Bratislava a third of
 * its confidence.
 */
const TYPE_FOOTPRINT_KM: Record<string, number> = {
  large_airport: 4,
  medium_airport: 3,
  small_airport: 1.5,
  seaplane_base: 1.5,
  heliport: 0.3,
  closed: 1.5,
}

export function matchAirport(
  index: AirportIndex,
  anchor: {
    latitude: number
    longitude: number
    onGround: boolean
    /** Height above field elevation at the anchor fix, when known. */
    altitudeAglFt?: number | null
  },
  options: Partial<AirportMatchOptions> = {},
): AirportMatch {
  const config = { ...DEFAULT_MATCH_OPTIONS, ...options }

  if (
    !anchor.onGround &&
    anchor.altitudeAglFt != null &&
    anchor.altitudeAglFt > config.maxAnchorAltitudeAglFt
  ) {
    return {
      airport: null,
      probable: null,
      confidence: 0,
      candidates: [],
      explanation:
        `coverage ends at ${Math.round(anchor.altitudeAglFt).toLocaleString('en-GB')} ft above ground — ` +
        'the aircraft was still cruising, so no airport can be identified from this track',
    }
  }

  const radiusKm = anchor.onGround ? config.groundRadiusKm : config.airborneRadiusKm
  const nearby = index.near(anchor, radiusKm)

  if (nearby.length === 0) {
    return {
      airport: null,
      probable: null,
      confidence: 0,
      candidates: [],
      explanation: `no airport within ${radiusKm} km of the ${anchor.onGround ? 'ground' : 'final'} position`,
    }
  }

  // How much an airborne fix is worth, by how low it is. This replaces a flat 0.45
  // penalty that was applied here AND again as a ceiling, which together guaranteed no
  // airborne anchor could ever clear the acceptance threshold.
  const edgeWeight = anchor.onGround ? 1 : airborneFactor(anchor.altitudeAglFt, config)
  const candidates: AirportCandidate[] = nearby
    .map(({ airport, distanceKm }) => ({
      airport,
      distanceKm,
      score:
        distanceScore(
          distanceKm,
          airport.type,
          anchor.onGround ? config.distanceDecayKm : config.airborneDistanceDecayKm,
        ) *
        typeWeight(airport.type, config.isRotorcraft) *
        edgeWeight,
    }))
    .sort((a, b) => b.score - a.score)

  const best = candidates[0]!
  const runnerUp = candidates[1]

  // Two aerodromes of comparable plausibility means we are not sure which one it was.
  let confidence = best.score
  let ambiguity = ''
  if (runnerUp && best.score > 0) {
    const ratio = runnerUp.score / best.score
    if (ratio > AMBIGUITY_THRESHOLD) {
      // A dead heat should not be reported as an identification. At an equal score
      // this drops the winner to 0.4 of its value, well under the acceptance threshold.
      confidence *= Math.max(0, 1 - 2 * (ratio - AMBIGUITY_THRESHOLD))
      ambiguity = `; ${runnerUp.airport.ident} is a comparable candidate at ${runnerUp.distanceKm.toFixed(1)} km`
    }
  }

  confidence = Math.max(0, Math.min(1, confidence))

  const accepted = confidence >= config.minConfidence

  const worthShowing = confidence >= config.minProbableConfidence

  return {
    airport: accepted ? best.airport : null,
    probable: worthShowing ? best.airport : null,
    confidence,
    candidates: candidates.slice(0, 5),
    explanation:
      `${best.airport.ident} at ${best.distanceKm.toFixed(1)} km, type ${best.airport.type}` +
      (anchor.onGround
        ? ', matched from a position recorded on the ground'
        : `, matched from an airborne position at ${Math.round(anchor.altitudeAglFt ?? 0).toLocaleString('en-GB')} ft above the field — the landing itself was not observed`) +
      ambiguity +
      (accepted
        ? ''
        : worthShowing
          ? `; below the ${config.minConfidence} confidence threshold, reported as probable only`
          : '; too weak to report even as a probable airport'),
  }
}

/**
 * What an airborne fix is worth as evidence of which airport was used.
 *
 * An aircraft 150 ft below field elevation is on the runway. One at 5 000 ft may simply
 * be passing overhead. Height above the field is the whole difference, so it sets the
 * weight rather than a single number standing in for every case.
 */
function airborneFactor(altitudeAglFt: number | null | undefined, config: AirportMatchOptions): number {
  if (altitudeAglFt == null) return 0.35
  const band = config.airborneCeilingByAgl.find((b) => altitudeAglFt <= b.maxAglFt)
  return band ? band.ceiling : 0
}

/** Flat inside the aerodrome footprint, exponential decay outside it. */
function distanceScore(distanceKm: number, type: string, decayKm: number): number {
  const footprintKm = TYPE_FOOTPRINT_KM[type] ?? 1.5
  if (distanceKm <= footprintKm) return 1
  return Math.exp(-(distanceKm - footprintKm) / decayKm)
}

/**
 * How plausible an aerodrome type is as the endpoint of this flight. Heliports are
 * unlikely for a fixed-wing aircraft and entirely normal for a helicopter.
 */
function typeWeight(type: string, isRotorcraft: boolean): number {
  if (isRotorcraft && type === 'heliport') return 1.0
  return TYPE_WEIGHTS[type] ?? 0.3
}

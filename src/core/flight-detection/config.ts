/**
 * Every tunable of the flight detector, in one place.
 *
 * The detector is versioned: any change to these defaults or to the algorithm must
 * bump DETECTOR_VERSION, because `flight.detector_version` is what tells us which
 * flights need rebuilding.
 */
export const DETECTOR_VERSION = 'fd-1.2.0'

export type DetectionConfig = {
  /** Above this gap, two fixes are never part of one continuous track. */
  gapHardSeconds: number
  /** Gaps beyond this are reported as coverage gaps rather than ignored. */
  gapSoftSeconds: number
  /** Intervals longer than this count against data coverage. */
  coverageGapSeconds: number
  /** Time on the ground that separates a landing from a touch-and-go. */
  minGroundSeconds: number
  /** Flights shorter than this are discarded as noise. */
  minFlightSeconds: number
  /** Flights covering less ground than this are discarded as taxi noise. */
  minFlightDistanceKm: number

  /** Height above field elevation, in feet, below which a fix can still be "ground". */
  groundAltMarginFt: number
  /** Ground speed, in knots, below which a fix can still be "ground". */
  groundSpeedKt: number
  /** Height above field elevation, in feet, that definitely means airborne. */
  airborneAltFt: number
  /** Ground speed, in knots, that definitely means airborne. */
  airborneSpeedKt: number

  /** Beyond this implied speed two fixes cannot belong to the same track. */
  maxPlausibleSpeedKt: number
  /**
   * The implausible-speed test is only meaningful across a real gap. ADS-B broadcasts
   * airborne positions at about 2 Hz, and over half a second coordinate rounding alone
   * produces wild implied speeds — so the test is skipped below this interval.
   */
  teleportMinGapSeconds: number
  /** ...and below this jump distance, for the same reason. */
  teleportMinDistanceKm: number

  /**
   * Above this height above field elevation, a fix tells us nothing about which airport
   * the aircraft used. A track that ends at cruise altitude gets no airport, not a guess.
   */
  maxAnchorAltitudeAglFt: number

  // --- inferred ground stop ---
  // An intermediate landing is invisible when no surface positions are received: the
  // track descends, disappears for an hour, and resumes climbing. Without this the two
  // legs merge into one impossible flight, and the intermediate airport vanishes from
  // the record entirely.
  /** Minimum gap before a stop may be inferred rather than observed. */
  inferredStopMinGapSeconds: number
  /** Both sides of the gap must be below this height above field elevation. */
  inferredStopMaxAltitudeAglFt: number
  /** ...and below this ground speed. */
  inferredStopMaxSpeedKt: number
  /** ...and the aircraft must not have gone anywhere during the gap. */
  inferredStopMaxDriftKm: number
}

export const DEFAULT_DETECTION_CONFIG: DetectionConfig = {
  gapHardSeconds: 21_600,
  gapSoftSeconds: 1_800,
  coverageGapSeconds: 60,
  minGroundSeconds: 300,
  minFlightSeconds: 240,
  minFlightDistanceKm: 5,

  groundAltMarginFt: 400,
  groundSpeedKt: 60,
  airborneAltFt: 1_000,
  airborneSpeedKt: 100,

  maxPlausibleSpeedKt: 700,
  teleportMinGapSeconds: 60,
  teleportMinDistanceKm: 20,

  maxAnchorAltitudeAglFt: 5_000,

  inferredStopMinGapSeconds: 900,
  inferredStopMaxAltitudeAglFt: 6_000,
  inferredStopMaxSpeedKt: 250,
  inferredStopMaxDriftKm: 30,
}

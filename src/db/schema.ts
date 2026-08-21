/**
 * Database schema — single source of truth.
 *
 * Layering rule (see ARCHITECTURE.md §2): raw observations are append-only and are
 * never mutated by the pipeline. Everything downstream of `raw_adsb_position` is
 * derived and can be dropped and rebuilt from raw at any time.
 */
import {
  bigint,
  bigserial,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'

/** `real` = collected from a provider, `demo` = synthetic, `manual` = hand-entered. */
export const DATA_STATUS = ['real', 'demo', 'manual'] as const
export type DataStatus = (typeof DATA_STATUS)[number]

export const VERIFICATION_STATUS = ['verified', 'needs_verification', 'disputed'] as const
export type VerificationStatus = (typeof VERIFICATION_STATUS)[number]

export const AIRCRAFT_CATEGORY = [
  'government',
  'ministry_of_interior',
  'ministry_of_defence',
  'other_state_aircraft',
] as const
export type AircraftCategory = (typeof AIRCRAFT_CATEGORY)[number]

export const SOURCE_TYPE = [
  'government',
  'procurement',
  'adsb',
  'airport',
  'manufacturer',
  'media',
  'manual',
] as const

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

export const source = pgTable(
  'source',
  {
    id: text('id').primaryKey(),
    publisher: text('publisher').notNull(),
    title: text('title').notNull(),
    url: text('url'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    accessedAt: timestamp('accessed_at', { withTimezone: true }).notNull().defaultNow(),
    type: text('type').notNull(),
    notes: text('notes'),
  },
  (t) => [index('source_type_idx').on(t.type)],
)

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const aircraft = pgTable(
  'aircraft',
  {
    id: text('id').primaryKey(),
    /** ICAO 24-bit address, lowercase hex, no prefix. */
    icao24: varchar('icao24', { length: 6 }).notNull(),
    registration: text('registration'),
    manufacturer: text('manufacturer'),
    model: text('model'),
    variant: text('variant'),
    /** ICAO type designator (A319, F100, H60 …) as broadcast / registered. */
    typeCode: varchar('type_code', { length: 8 }),
    operator: text('operator'),
    category: text('category').notNull(),
    activeFrom: date('active_from'),
    activeUntil: date('active_until'),
    trackingEnabled: boolean('tracking_enabled').notNull().default(false),
    /** Rotorcraft match heliports differently — see core/airports/match.ts. */
    isRotorcraft: boolean('is_rotorcraft').notNull().default(false),
    costModelKey: text('cost_model_key'),
    verificationStatus: text('verification_status').notNull().default('needs_verification'),
    dataStatus: text('data_status').notNull().default('real'),
    notes: text('notes'),
    sourceUrl: text('source_url'),
    sourceId: text('source_id').references(() => source.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('aircraft_icao24_uq').on(t.icao24),
    index('aircraft_tracking_idx').on(t.trackingEnabled),
  ],
)

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

export const airport = pgTable(
  'airport',
  {
    id: text('id').primaryKey(),
    /** OurAirports `ident` — ICAO code where one exists, otherwise a local code. */
    ident: text('ident').notNull(),
    icao: varchar('icao', { length: 4 }),
    iata: varchar('iata', { length: 3 }),
    name: text('name').notNull(),
    city: text('city'),
    country: varchar('country', { length: 2 }),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    elevationFt: integer('elevation_ft'),
    /** large_airport | medium_airport | small_airport | heliport | seaplane_base */
    type: text('type').notNull(),
    scheduledService: boolean('scheduled_service').notNull().default(false),
    sourceId: text('source_id').references(() => source.id),
  },
  (t) => [
    uniqueIndex('airport_ident_uq').on(t.ident),
    index('airport_icao_idx').on(t.icao),
    index('airport_iata_idx').on(t.iata),
  ],
)

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

export const importJob = pgTable(
  'import_job',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull(),
    aircraftIcao24: varchar('aircraft_icao24', { length: 6 }).notNull(),
    rangeFrom: timestamp('range_from', { withTimezone: true }).notNull(),
    rangeTo: timestamp('range_to', { withTimezone: true }).notNull(),
    /** pending | running | completed | failed | empty */
    status: text('status').notNull().default('pending'),
    positionsDownloaded: integer('positions_downloaded').notNull().default(0),
    positionsStored: integer('positions_stored').notNull().default(0),
    flightsDetected: integer('flights_detected').notNull().default(0),
    error: text('error'),
    params: jsonb('params'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('import_job_aircraft_idx').on(t.aircraftIcao24, t.rangeFrom),
    index('import_job_status_idx').on(t.status),
  ],
)

/**
 * Append-only. Never updated, never deleted — the whole pipeline is rebuildable
 * from this table, which is what lets the detection algorithm improve over time.
 *
 * Narrow column types on purpose: this is the only table that grows without bound.
 */
export const rawAdsbPosition = pgTable(
  'raw_adsb_position',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    aircraftIcao24: varchar('aircraft_icao24', { length: 6 }).notNull(),
    ts: timestamp('ts', { withTimezone: true }).notNull(),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    altitudeBaro: integer('altitude_baro'),
    altitudeGeom: integer('altitude_geom'),
    groundSpeed: real('ground_speed'),
    verticalRate: integer('vertical_rate'),
    track: real('track'),
    callsign: varchar('callsign', { length: 12 }),
    onGround: boolean('on_ground'),
    /** Seconds since the position was actually received; high values = stale/interpolated. */
    positionAgeSeconds: real('position_age_seconds'),
    source: text('source').notNull(),
    dataStatus: text('data_status').notNull().default('real'),
    importJobId: text('import_job_id').references(() => importJob.id),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('raw_pos_dedup_uq').on(t.aircraftIcao24, t.ts, t.source),
    index('raw_pos_aircraft_ts_idx').on(t.aircraftIcao24, t.ts),
  ],
)

// ---------------------------------------------------------------------------
// Derived: flights
// ---------------------------------------------------------------------------

export const route = pgTable(
  'route',
  {
    id: text('id').primaryKey(),
    originAirportId: text('origin_airport_id').references(() => airport.id),
    destinationAirportId: text('destination_airport_id').references(() => airport.id),
    /** Direction-insensitive key, alphabetically ordered: "EBBR|LZIB". */
    cityPairKey: text('city_pair_key').notNull(),
  },
  (t) => [
    uniqueIndex('route_pair_uq').on(t.originAirportId, t.destinationAirportId),
    index('route_city_pair_idx').on(t.cityPairKey),
  ],
)

export const flight = pgTable(
  'flight',
  {
    id: text('id').primaryKey(),
    /** URL slug, e.g. 2026-08-17-om-bya-lzib-ebbr */
    publicId: text('public_id').notNull(),
    aircraftId: text('aircraft_id')
      .notNull()
      .references(() => aircraft.id),

    departureTime: timestamp('departure_time', { withTimezone: true }).notNull(),
    arrivalTime: timestamp('arrival_time', { withTimezone: true }),
    departureTimeEstimated: boolean('departure_time_estimated').notNull().default(false),
    arrivalTimeEstimated: boolean('arrival_time_estimated').notNull().default(false),

    departureAirportId: text('departure_airport_id').references(() => airport.id),
    arrivalAirportId: text('arrival_airport_id').references(() => airport.id),
    /** Best candidate when confidence was below the publication threshold. */
    probableDepartureAirportId: text('probable_departure_airport_id').references(() => airport.id),
    probableArrivalAirportId: text('probable_arrival_airport_id').references(() => airport.id),
    routeId: text('route_id').references(() => route.id),

    durationSeconds: integer('duration_seconds'),
    distanceKm: real('distance_km'),
    /** How much of `distance_km` was bridged across a coverage gap. */
    distanceFromGapsKm: real('distance_from_gaps_km'),
    greatCircleKm: real('great_circle_km'),
    maxAltitudeFt: integer('max_altitude_ft'),
    callsign: varchar('callsign', { length: 12 }),

    // --- data quality (brief §8) ---
    dataCoverage: real('data_coverage'),
    routeConfidence: real('route_confidence'),
    departureAirportConfidence: real('departure_airport_confidence'),
    arrivalAirportConfidence: real('arrival_airport_confidence'),
    confidence: text('confidence'), // high | medium | low
    positionCount: integer('position_count').notNull().default(0),
    maxGapSeconds: integer('max_gap_seconds'),
    medianIntervalSeconds: real('median_interval_seconds'),

    /** Estimate only — never asserted as an empty flight. See brief §20. */
    positioningLikelihood: real('positioning_likelihood'),

    dataSource: text('data_source').notNull(),
    dataStatus: text('data_status').notNull().default('real'),
    detectorVersion: text('detector_version').notNull(),

    /** Materialised arrival_time + PUBLICATION_DELAY_HOURS. NULL while in progress. */
    publishedAt: timestamp('published_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('flight_public_id_uq').on(t.publicId),
    uniqueIndex('flight_natural_uq').on(t.aircraftId, t.departureTime),
    index('flight_aircraft_dep_idx').on(t.aircraftId, t.departureTime),
    index('flight_published_idx').on(t.publishedAt),
    index('flight_dep_airport_idx').on(t.departureAirportId),
    index('flight_arr_airport_idx').on(t.arrivalAirportId),
  ],
)

/**
 * Published geometry for one flight: a simplified (Douglas–Peucker) line, plus the
 * coverage gaps so a map can draw them as dashed/uncertain rather than solid.
 */
export const flightTrack = pgTable('flight_track', {
  flightId: text('flight_id')
    .primaryKey()
    .references(() => flight.id, { onDelete: 'cascade' }),
  /** [[lon, lat, altFt, epochSeconds], …] */
  points: jsonb('points').notNull(),
  pointCount: integer('point_count').notNull(),
  simplifiedFrom: integer('simplified_from').notNull(),
  gaps: jsonb('gaps'),
})

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

export const costModel = pgTable(
  'cost_model',
  {
    id: text('id').primaryKey(),
    /** Stable key shared by all versions of one model, e.g. "a319cj-gov-sk". */
    key: text('key').notNull(),
    version: integer('version').notNull().default(1),
    label: text('label').notNull(),
    appliesToAircraftId: text('applies_to_aircraft_id').references(() => aircraft.id),
    appliesToTypeCode: varchar('applies_to_type_code', { length: 8 }),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
    currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
    /** AircraftCostModelParams — unknown inputs stay absent, never zero. */
    params: jsonb('params').notNull(),
    verificationStatus: text('verification_status').notNull().default('needs_verification'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: text('created_by'),
  },
  (t) => [
    uniqueIndex('cost_model_key_version_uq').on(t.key, t.version),
    index('cost_model_validity_idx').on(t.key, t.validFrom),
  ],
)

/** Audit trail for brief §32: what changed, from what, to what, by whom, on what basis. */
export const costModelChange = pgTable(
  'cost_model_change',
  {
    id: text('id').primaryKey(),
    costModelKey: text('cost_model_key').notNull(),
    fromVersion: integer('from_version'),
    toVersion: integer('to_version').notNull(),
    field: text('field').notNull(),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    validFrom: date('valid_from').notNull(),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
    changedBy: text('changed_by'),
    sourceId: text('source_id').references(() => source.id),
    notes: text('notes'),
  },
  (t) => [index('cost_model_change_key_idx').on(t.costModelKey, t.changedAt)],
)

export const flightCost = pgTable(
  'flight_cost',
  {
    flightId: text('flight_id')
      .primaryKey()
      .references(() => flight.id, { onDelete: 'cascade' }),
    costModelId: text('cost_model_id').references(() => costModel.id),
    currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
    estimatedCostLow: real('estimated_cost_low'),
    estimatedCostMid: real('estimated_cost_mid'),
    estimatedCostHigh: real('estimated_cost_high'),
    /** CostBreakdownEntry[] — formula, inputs, sources and status per component. */
    breakdown: jsonb('breakdown').notNull(),
    costConfidence: real('cost_confidence'),
    engineVersion: text('engine_version').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('flight_cost_model_idx').on(t.costModelId)],
)

// ---------------------------------------------------------------------------
// Manual enrichment
// ---------------------------------------------------------------------------

export const flightPurpose = pgTable(
  'flight_purpose',
  {
    id: text('id').primaryKey(),
    flightId: text('flight_id')
      .notNull()
      .references(() => flight.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    /** confirmed | probable | unknown — never inferred automatically. */
    status: text('status').notNull().default('unknown'),
    sourceUrl: text('source_url'),
    sourcePublisher: text('source_publisher'),
    sourcePublishedAt: timestamp('source_published_at', { withTimezone: true }),
    sourceId: text('source_id').references(() => source.id),
    confidence: real('confidence'),
    verifiedBy: text('verified_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('flight_purpose_flight_idx').on(t.flightId)],
)

export type Aircraft = typeof aircraft.$inferSelect
export type Airport = typeof airport.$inferSelect
export type RawAdsbPositionRow = typeof rawAdsbPosition.$inferSelect
export type FlightRow = typeof flight.$inferSelect
export type ImportJobRow = typeof importJob.$inferSelect

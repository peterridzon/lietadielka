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

/**
 * Operational state. Separate from `tracking_enabled`, which is a collector switch:
 * an aircraft can be active but untracked, or retired and still worth polling briefly.
 */
export const AIRCRAFT_STATUS = ['active', 'retired', 'stored', 'planned'] as const
export type AircraftStatus = (typeof AIRCRAFT_STATUS)[number]

export const AIRCRAFT_CATEGORY = [
  'government',
  'ministry_of_interior',
  'ministry_of_defence',
  'other_state_aircraft',
] as const
export type AircraftCategory = (typeof AIRCRAFT_CATEGORY)[number]

/**
 * Source credibility, highest first (COST_ENGINE_SPEC §3). On conflict the higher tier
 * wins, and the tier is carried all the way through to the number shown to a reader.
 */
export const SOURCE_TIER = ['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'C', 'D'] as const
export type SourceTier = (typeof SOURCE_TIER)[number]

/**
 * What a monetary figure in a document actually is. A framework ceiling is not spending,
 * and conflating the two is the single easiest way to overstate public cost by an order
 * of magnitude — so every figure has to declare which it is.
 */
export const CONTRACT_VALUE_TYPE = [
  'actual_spend',
  'invoice_value',
  'executed_contract_value',
  'awarded_contract_value',
  'maximum_framework_value',
  'annual_budget',
  'estimated_value',
  'industry_benchmark',
] as const
export type ContractValueType = (typeof CONTRACT_VALUE_TYPE)[number]

/** Preference order when several figures describe the same thing. Lower index wins. */
export const CONTRACT_VALUE_PRIORITY: ContractValueType[] = [
  'actual_spend',
  'invoice_value',
  'executed_contract_value',
  'awarded_contract_value',
  'maximum_framework_value',
  'industry_benchmark',
]

export const COST_STATUS = ['known', 'known_zero', 'estimated', 'unknown', 'not_applicable'] as const
export type CostStatus = (typeof COST_STATUS)[number]

export const COST_SCOPE = ['aircraft', 'aircraft_type', 'fleet', 'organization'] as const
export const ALLOCATION_METHOD = ['equal_by_aircraft', 'by_flight_hours', 'by_aircraft_value', 'manual'] as const

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
    /** A1..D — see SOURCE_TIER. Absent for non-cost sources. */
    sourceTier: varchar('source_tier', { length: 2 }),
    /** Period the figures in this source describe, not when it was published. */
    validFrom: date('valid_from'),
    validTo: date('valid_to'),
    originalCurrency: varchar('original_currency', { length: 3 }),
    originalValue: doublePrecision('original_value'),
    notes: text('notes'),
  },
  (t) => [index('source_type_idx').on(t.type), index('source_tier_idx').on(t.sourceTier)],
)

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Who operates an aircraft, as a hierarchy.
 *
 * Slovak state air transport is not one fleet. The Ministry of Interior air unit and the
 * Air Force are separate operators with separate budgets, and merging them would apply
 * one ministry's operating rate to the other's aircraft.
 */
export const operatorOrganisation = pgTable(
  'operator_organisation',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    shortName: text('short_name'),
    parentId: text('parent_id'),
    category: text('category'),
    country: varchar('country', { length: 2 }),
    notes: text('notes'),
  },
  (t) => [index('operator_parent_idx').on(t.parentId)],
)

export const aircraft = pgTable(
  'aircraft',
  {
    id: text('id').primaryKey(),
    /**
     * ICAO 24-bit address, lowercase hex, no prefix. THE primary identity.
     *
     * Registrations change and callsigns change per flight; the address is assigned with
     * entry into a national register and is what the aircraft actually broadcasts.
     */
    icao24: varchar('icao24', { length: 6 }).notNull(),
    /** Civil mark (OM-BYA) or military evidence number (9513). */
    registration: text('registration'),
    /** civil | military — a military aircraft has no OM- mark and needs none. */
    registrationType: text('registration_type').notNull().default('civil'),
    /** Manufacturer's serial number, stable across every change of registration. */
    msn: text('msn'),
    /**
     * Earlier marks, for provenance research only. A flight recorded under a previous
     * registration is NOT evidence of a Slovak state operation — it predates the sale.
     */
    previousRegistrations: jsonb('previous_registrations'),
    manufacturer: text('manufacturer'),
    model: text('model'),
    variant: text('variant'),
    /** ICAO type designator (A319, F100, H60 …) as broadcast / registered. */
    typeCode: varchar('type_code', { length: 8 }),
    operator: text('operator'),
    operatorId: text('operator_id').references(() => operatorOrganisation.id),
    /**
     * The fleet this aircraft belongs to for cost allocation and utilisation.
     * Keeps one ministry's cost model from being applied to another's aircraft.
     */
    fleetKey: text('fleet_key'),
    category: text('category').notNull(),
    status: text('status').notNull().default('active'),
    activeFrom: date('active_from'),
    activeUntil: date('active_until'),
    trackingEnabled: boolean('tracking_enabled').notNull().default(false),
    /** Rotorcraft match heliports differently — see core/airports/match.ts. */
    isRotorcraft: boolean('is_rotorcraft').notNull().default(false),
    costModelKey: text('cost_model_key'),
    verificationStatus: text('verification_status').notNull().default('needs_verification'),
    dataStatus: text('data_status').notNull().default('real'),

    // --- third-party registry data, namespaced so it never masquerades as ours ---
    // Filled from Bellingcat's modes.csv by `npm run registry:sync`. Kept separate from
    // the curated fields above: these are someone else's data, at someone else's tier,
    // and are used to cross-check our registry and to surface aircraft we have missed.
    /** hexdb.io via modes.csv — tier C. */
    registryOwner: text('registry_owner'),
    registryOperatorCode: text('registry_operator_code'),
    registryType: text('registry_type'),
    registryYear: text('registry_year'),
    /** LLM-generated in modes.csv — tier D. A hint for triage, never a published claim. */
    registryCategory: text('registry_category'),
    registryMilitary: boolean('registry_military'),
    registrySyncedAt: timestamp('registry_synced_at', { withTimezone: true }),

    notes: text('notes'),
    sourceUrl: text('source_url'),
    sourceId: text('source_id').references(() => source.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('aircraft_icao24_uq').on(t.icao24),
    index('aircraft_tracking_idx').on(t.trackingEnabled),
    index('aircraft_status_idx').on(t.status),
    index('aircraft_fleet_idx').on(t.fleetKey),
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
    /** Provider marked the position as stale (re-broadcast of an older fix). */
    stale: boolean('stale'),
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
    /** Off-block to on-block, measured from ground movement where it was observed. */
    blockSeconds: integer('block_seconds'),
    blockSecondsEstimated: boolean('block_seconds_estimated').notNull().default(false),
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
    /** Stable key shared by all versions of one model, e.g. "lu-mvsr-fixedwing-direct". */
    key: text('key').notNull(),
    version: integer('version').notNull().default(1),
    /** Human version label carried onto every calculation, e.g. "A319-SK-2026-v1". */
    modelVersion: text('model_version').notNull(),
    label: text('label').notNull(),
    appliesToAircraftId: text('applies_to_aircraft_id').references(() => aircraft.id),
    appliesToTypeCode: varchar('applies_to_type_code', { length: 8 }),
    scope: text('scope').notNull().default('fleet'),
    /** Which fleet/aircraft the annual fixed cost and utilisation rows are keyed by. */
    scopeKey: text('scope_key'),
    allocationMethod: text('allocation_method').notNull().default('by_flight_hours'),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
    /** Which year's prices the figures are in — often older than validFrom. */
    priceYear: integer('price_year'),
    /**
     * 'blended' = one sourced all-in hourly rate; 'components' = a build-up.
     * A blended rate replaces the components it contains and is never added to them.
     */
    mode: text('mode').notNull().default('blended'),
    blendedDirectRateLow: doublePrecision('blended_direct_rate_low'),
    blendedDirectRateMid: doublePrecision('blended_direct_rate_mid'),
    blendedDirectRateHigh: doublePrecision('blended_direct_rate_high'),
    /** Hours added to airborne time when block time was not observed. */
    taxiAllowanceHours: real('taxi_allowance_hours'),
    currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
    /** AircraftCostModelParams — unknown inputs stay absent, never zero. */
    params: jsonb('params').notNull(),
    sourceId: text('source_id').references(() => source.id),
    sourceTier: varchar('source_tier', { length: 2 }),
    verificationStatus: text('verification_status').notNull().default('needs_verification'),
    supersededById: text('superseded_by_id'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: text('created_by'),
  },
  (t) => [
    uniqueIndex('cost_model_key_version_uq').on(t.key, t.version),
    uniqueIndex('cost_model_version_uq').on(t.modelVersion),
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

/**
 * One costing of one flight by one model version.
 *
 * Recomputation INSERTS; it never updates or deletes. `is_current` marks the live row
 * and every superseded calculation stays readable, which is the audit trail the
 * specification asks for in §52.
 */
export const flightCost = pgTable(
  'flight_cost',
  {
    id: text('id').primaryKey(),
    flightId: text('flight_id')
      .notNull()
      .references(() => flight.id, { onDelete: 'cascade' }),
    costModelId: text('cost_model_id').references(() => costModel.id),
    costModelVersion: text('cost_model_version').notNull(),
    engineVersion: text('engine_version').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('EUR'),

    directLow: real('direct_low'),
    directMid: real('direct_mid'),
    directHigh: real('direct_high'),
    fixedLow: real('fixed_low'),
    fixedMid: real('fixed_mid'),
    fixedHigh: real('fixed_high'),
    fullLow: real('full_low'),
    fullMid: real('full_mid'),
    fullHigh: real('full_high'),

    blockHours: real('block_hours'),
    blockHoursEstimated: boolean('block_hours_estimated').notNull().default(false),

    /** FlightCostComponent[] — formula, inputs, sources and status for each. */
    components: jsonb('components').notNull(),
    /** Reproducible record of every step, for "how did we calculate this?". */
    trace: jsonb('trace').notNull(),
    /** Categories the total is known not to include. Printed, never hidden. */
    missing: jsonb('missing'),
    warnings: jsonb('warnings'),

    /** nominal_eur | inflation_adjusted_eur */
    basis: text('basis').notNull().default('nominal_eur'),
    /** Price level of the inputs — may be years older than the flight. */
    priceYear: integer('price_year'),
    priceYearGapYears: integer('price_year_gap_years'),

    confidence: text('confidence').notNull().default('low'),
    validationWarning: boolean('validation_warning').notNull().default(false),

    isCurrent: boolean('is_current').notNull().default(true),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('flight_cost_flight_idx').on(t.flightId, t.isCurrent),
    index('flight_cost_model_idx').on(t.costModelId),
    uniqueIndex('flight_cost_unique_calc').on(t.flightId, t.costModelVersion, t.engineVersion),
  ],
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

// ---------------------------------------------------------------------------
// Cost research (COST_ENGINE_SPEC §53) — the inbox between a document and a model
// ---------------------------------------------------------------------------

export const COST_CATEGORY = [
  'fuel',
  'base_maintenance',
  'line_maintenance',
  'engine_maintenance',
  'parts',
  'insurance',
  'training',
  'crew',
  'airport_services',
  'handling',
  'navigation',
  'software',
  'facilities',
  'capital_acquisition',
  'administration',
  'other',
] as const

/**
 * One sourced figure, exactly as the document states it. Nothing here is interpreted:
 * interpretation happens when a cost model is built from these rows, and the model
 * points back at them.
 */
export const costResearchItem = pgTable(
  'cost_research_item',
  {
    id: text('id').primaryKey(),
    aircraftType: varchar('aircraft_type', { length: 8 }),
    aircraftRegistration: text('aircraft_registration'),
    operator: text('operator'),
    category: text('category').notNull(),
    description: text('description').notNull(),
    value: doublePrecision('value'),
    currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
    /** Unit the value is expressed in: 'eur_per_flight_hour', 'eur_per_year', 'eur'… */
    unit: text('unit').notNull(),
    periodStart: date('period_start'),
    periodEnd: date('period_end'),
    /** Which prices this figure is in, when it differs from the period. */
    priceYear: integer('price_year'),
    scope: text('scope').notNull().default('fleet'),
    /** 'fixed' | 'variable' | 'mixed' */
    fixedVariable: text('fixed_variable').notNull().default('mixed'),
    contractValueType: text('contract_value_type').notNull(),
    /** Only ever set when the source states money actually spent. */
    actualSpend: doublePrecision('actual_spend'),
    sourceId: text('source_id').references(() => source.id),
    sourceTier: varchar('source_tier', { length: 2 }).notNull(),
    confidence: text('confidence').notNull().default('low'),
    notes: text('notes'),
    /** unreviewed | accepted | rejected | superseded */
    reviewStatus: text('review_status').notNull().default('unreviewed'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('cost_research_category_idx').on(t.category),
    index('cost_research_tier_idx').on(t.sourceTier),
  ],
)

/** Time-bounded fuel price. A June 2025 flight must be priced with June 2025 fuel. */
export const fuelPrice = pgTable(
  'fuel_price',
  {
    id: text('id').primaryKey(),
    fuelType: text('fuel_type').notNull().default('JET-A1'),
    pricePerKg: doublePrecision('price_per_kg').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
    /** actual_contract_price | monthly_average | quarterly_average | annual_average | benchmark */
    method: text('method').notNull(),
    sourceId: text('source_id').references(() => source.id),
    sourceTier: varchar('source_tier', { length: 2 }).notNull(),
    confidence: text('confidence').notNull().default('low'),
  },
  (t) => [index('fuel_price_validity_idx').on(t.fuelType, t.validFrom)],
)

/**
 * A published figure used to sanity-check the model rather than to feed it.
 * If our own model disagrees with an official rate by a wide margin, one of them is wrong.
 */
export const costBenchmark = pgTable(
  'cost_benchmark',
  {
    id: text('id').primaryKey(),
    label: text('label').notNull(),
    /** direct_hourly | fixed_share | full_hourly | annual_budget */
    kind: text('kind').notNull(),
    appliesToTypeCode: varchar('applies_to_type_code', { length: 8 }),
    appliesToCategory: text('applies_to_category'),
    valueLow: doublePrecision('value_low'),
    valueMid: doublePrecision('value_mid'),
    valueHigh: doublePrecision('value_high'),
    unit: text('unit').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
    priceYear: integer('price_year'),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
    sourceId: text('source_id').references(() => source.id),
    sourceTier: varchar('source_tier', { length: 2 }).notNull(),
    confidence: text('confidence').notNull().default('medium'),
    notes: text('notes'),
  },
  (t) => [index('cost_benchmark_kind_idx').on(t.kind, t.validFrom)],
)

/**
 * Annual flight hours — the denominator that decides the fixed cost per hour, and
 * therefore most of the full-cost answer. Its method and tier travel with it.
 */
export const annualUtilisation = pgTable(
  'annual_utilisation',
  {
    id: text('id').primaryKey(),
    year: integer('year').notNull(),
    scope: text('scope').notNull(),
    scopeKey: text('scope_key').notNull(),
    flightHours: doublePrecision('flight_hours').notNull(),
    flights: integer('flights'),
    cycles: integer('cycles'),
    /** official | adsb_complete | coverage_adjusted_estimate | planning_minimum | benchmark */
    method: text('method').notNull(),
    /** For coverage-adjusted estimates: the coverage the adjustment assumed. */
    assumedCoverage: real('assumed_coverage'),
    sourceId: text('source_id').references(() => source.id),
    sourceTier: varchar('source_tier', { length: 2 }).notNull(),
    confidence: text('confidence').notNull().default('low'),
    notes: text('notes'),
  },
  (t) => [uniqueIndex('annual_utilisation_uq').on(t.year, t.scope, t.scopeKey, t.method)],
)

/** Annual fixed cost for a scope, with an explicit list of what it leaves out. */
export const annualFixedCost = pgTable(
  'annual_fixed_cost',
  {
    id: text('id').primaryKey(),
    year: integer('year').notNull(),
    scope: text('scope').notNull(),
    scopeKey: text('scope_key').notNull(),
    valueLow: doublePrecision('value_low'),
    valueMid: doublePrecision('value_mid'),
    valueHigh: doublePrecision('value_high'),
    currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
    priceYear: integer('price_year'),
    /** Breakdown by category where the source gives one. */
    categories: jsonb('categories'),
    /** Categories this figure is known NOT to include — printed, never hidden. */
    excludedCategories: jsonb('excluded_categories'),
    contractValueType: text('contract_value_type').notNull(),
    /** How this figure reaches one aircraft: see ALLOCATION_METHOD. */
    allocationMethod: text('allocation_method').notNull().default('by_flight_hours'),
    /** Set when the row is derived from other figures rather than stated outright. */
    derivation: text('derivation'),
    sourceId: text('source_id').references(() => source.id),
    sourceTier: varchar('source_tier', { length: 2 }).notNull(),
    confidence: text('confidence').notNull().default('low'),
    notes: text('notes'),
  },
  (t) => [uniqueIndex('annual_fixed_cost_uq').on(t.year, t.scope, t.scopeKey)],
)

/** Published airport charges. Empty until a tariff is actually obtained. */
export const airportFeeModel = pgTable(
  'airport_fee_model',
  {
    id: text('id').primaryKey(),
    airportId: text('airport_id').references(() => airport.id),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
    mtowMinKg: integer('mtow_min_kg'),
    mtowMaxKg: integer('mtow_max_kg'),
    /** { landing, parkingPerHour, passenger, security, terminal, handling, … } */
    fees: jsonb('fees').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
    sourceId: text('source_id').references(() => source.id),
    sourceTier: varchar('source_tier', { length: 2 }).notNull(),
    confidence: text('confidence').notNull().default('medium'),
  },
  (t) => [index('airport_fee_airport_idx').on(t.airportId, t.validFrom)],
)

// ---------------------------------------------------------------------------
// Missions, passengers, commercial comparison
// ---------------------------------------------------------------------------

/** A trip. Comparing a single leg against a return ticket would be meaningless. */
export const mission = pgTable(
  'mission',
  {
    id: text('id').primaryKey(),
    publicId: text('public_id').notNull(),
    aircraftId: text('aircraft_id').references(() => aircraft.id),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    legCount: integer('leg_count').notNull().default(0),
    /** confirmed | automatic | manual */
    grouping: text('grouping').notNull().default('automatic'),
    groupingConfidence: real('grouping_confidence'),
    /** Ordered airport idents, e.g. ["LZIB","KEWR","LZIB"]. */
    routeKey: text('route_key'),
    airborneSeconds: integer('airborne_seconds'),
    blockSeconds: integer('block_seconds'),
    distanceKm: real('distance_km'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('mission_public_id_uq').on(t.publicId),
    index('mission_aircraft_idx').on(t.aircraftId, t.startedAt),
  ],
)

export const missionLeg = pgTable(
  'mission_leg',
  {
    missionId: text('mission_id')
      .notNull()
      .references(() => mission.id, { onDelete: 'cascade' }),
    flightId: text('flight_id')
      .notNull()
      .references(() => flight.id, { onDelete: 'cascade' }),
    legIndex: integer('leg_index').notNull(),
  },
  (t) => [
    uniqueIndex('mission_leg_uq').on(t.missionId, t.flightId),
    index('mission_leg_flight_idx').on(t.flightId),
  ],
)

/**
 * Passenger count, with its source. Deliberately a separate table: the default state
 * is "we do not know", and a NULL column invites someone to fill it with a guess.
 */
export const flightPassengers = pgTable(
  'flight_passengers',
  {
    flightId: text('flight_id')
      .primaryKey()
      .references(() => flight.id, { onDelete: 'cascade' }),
    passengerCount: integer('passenger_count').notNull(),
    crewCount: integer('crew_count'),
    /** confirmed | reported | estimated */
    status: text('status').notNull().default('reported'),
    sourceUrl: text('source_url'),
    sourcePublisher: text('source_publisher'),
    sourceId: text('source_id').references(() => source.id),
    confidence: text('confidence').notNull().default('low'),
    notes: text('notes'),
  },
)

/** A comparable commercial fare. Never a scraped cheapest ticket. */
export const commercialFare = pgTable(
  'commercial_fare',
  {
    id: text('id').primaryKey(),
    originAirportId: text('origin_airport_id').references(() => airport.id),
    destinationAirportId: text('destination_airport_id').references(() => airport.id),
    /** LOW_COST_ECONOMY | STANDARD_FLEXIBLE_ECONOMY | BUSINESS_FLEX */
    scenario: text('scenario').notNull(),
    roundTrip: boolean('round_trip').notNull().default(true),
    farePerPassenger: doublePrecision('fare_per_passenger').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
    /** historical_actual | historical_cached | historical_estimate | current_equivalent | benchmark | manual */
    fareBasis: text('fare_basis').notNull(),
    /** high | medium | low — schedule match and fare vintage, see spec §43. */
    comparisonQuality: text('comparison_quality').notNull().default('low'),
    directConnectionAvailable: text('direct_connection_available').notNull().default('unknown'),
    journeyTimeSeconds: integer('journey_time_seconds'),
    sourceId: text('source_id').references(() => source.id),
    sourceTier: varchar('source_tier', { length: 2 }).notNull().default('D'),
    notes: text('notes'),
  },
  (t) => [index('commercial_fare_pair_idx').on(t.originAirportId, t.destinationAirportId, t.validFrom)],
)

export type CostResearchItemRow = typeof costResearchItem.$inferSelect
export type CostBenchmarkRow = typeof costBenchmark.$inferSelect
export type AnnualUtilisationRow = typeof annualUtilisation.$inferSelect
export type AnnualFixedCostRow = typeof annualFixedCost.$inferSelect
export type MissionRow = typeof mission.$inferSelect

# Architecture — Lietadielka

> Transparency platform for the use of Slovak state aircraft, built on public ADS-B data.
>
> Priority order for every design decision in this document:
> **DATA CORRECTNESS > TRANSPARENCY > FUNCTIONALITY > DESIGN.**

---

## 1. Design principles

1. **Never publish live positions.** The public surface only ever sees flights that
   have *ended*, and only after `PUBLICATION_DELAY_HOURS` (default `6`) have elapsed
   since the detected landing. This is enforced in one place (`src/core/publication.ts`)
   and covered by an automated test (§45 of the brief).
2. **Raw data is immutable and never deleted.** `raw_adsb_position` is an append-only
   store. Every derived artefact (flights, tracks, costs, analytics) is reproducible
   from raw + a versioned algorithm, and can be rebuilt with a CLI command.
3. **Nothing is invented.** If a value is unknown, it is `NULL` and rendered as
   *"not included / data unavailable"*. Estimates are always labelled as estimates and
   carry a confidence value and an interval.
4. **Every number has a provenance.** Cost inputs, aircraft identities and flight
   purposes all reference rows in `source`.
5. **Portable core.** `src/core/**` is pure TypeScript with no database and no network
   access. It is unit-testable in isolation and can later be lifted into a separate
   collector service unchanged.

---

## 2. Component architecture

```
                       ┌──────────────────────────────┐
                       │  ADS-B providers (external)  │
                       │  adsb.lol · OpenSky · files  │
                       └───────────────┬──────────────┘
                                       │  AdsbProvider interface
                       ┌───────────────▼──────────────┐
   CLI / cron ───────► │  collector  (src/pipeline)   │
                       │  backfill · rebuild · costs  │
                       └───────────────┬──────────────┘
                                       │
                       ┌───────────────▼──────────────┐
                       │  PostgreSQL                  │
                       │  raw → flight → cost → stats │
                       └───────────────┬──────────────┘
                                       │  repositories (src/db)
                       ┌───────────────▼──────────────┐
                       │  publication gate            │  ← the only public door
                       │  src/core/publication.ts     │
                       └───────────────┬──────────────┘
                                       │
                   ┌───────────────────┴────────────────────┐
                   │                                        │
        ┌──────────▼──────────┐                  ┌──────────▼──────────┐
        │  read-only JSON API │                  │  Next.js web UI     │
        │  /api/*             │                  │  dashboard, flights │
        └─────────────────────┘                  └─────────────────────┘
```

Three deployables are *already* separable, they are just co-located for now:

| Concern    | Lives in                     | Can be split into                     |
| ---------- | ---------------------------- | ------------------------------------- |
| collector  | `src/pipeline`, `src/adsb`   | a worker process / cron container     |
| API        | `src/app/api` (Phase 10)     | a standalone HTTP service             |
| web        | `src/app` (Phase 10)         | a static/SSR frontend on the API      |
| shared     | `src/core`, `src/db`         | an internal npm workspace package     |

Nothing in `src/core` imports from `src/db`, `src/adsb` or `src/app`. That constraint
is what makes the split cheap later; it is worth keeping.

---

## 3. Directory structure

```
lietadielka/
├── ARCHITECTURE.md            this file
├── README.md  METHODOLOGY.md  DATA_SOURCES.md  COST_MODEL.md
├── SECURITY.md  CONTRIBUTING.md  LICENSE
├── docker-compose.yml         PostgreSQL 17 for local dev
├── drizzle.config.ts          migration config
├── .env.example
├── data/
│   ├── aircraft.seed.json     registry seed (with verification status)
│   ├── cost-models.seed.json  cost model seed (unverified until sourced)
│   └── cache/                 downloaded reference data (gitignored)
├── drizzle/                   generated SQL migrations (checked in)
├── src/
│   ├── core/                  PURE domain logic — no I/O
│   │   ├── types.ts               normalised domain types
│   │   ├── geo.ts                 haversine, bearing, path length
│   │   ├── publication.ts         publication-delay gate
│   │   ├── flight-detection/
│   │   │   ├── config.ts          all tunables in one place
│   │   │   ├── classify.ts        per-point GROUND/AIR classification
│   │   │   ├── segmentation.ts    gap handling → track segments
│   │   │   ├── state-machine.ts   GROUND→TAKEOFF→AIRBORNE→APPROACH→LANDED
│   │   │   ├── coverage.ts        data-coverage + gap metrics
│   │   │   └── index.ts           detectFlights() entry point
│   │   ├── airports/
│   │   │   ├── spatial-index.ts   grid index over ~80k airports
│   │   │   └── match.ts           scoring + confidence
│   │   ├── cost/
│   │   │   ├── model.ts           AircraftCostModel type + validation
│   │   │   └── engine.ts          explainable cost computation
│   │   └── analytics/
│   │       ├── recurring-routes.ts  recurring-route scoring
│   │       └── stats.ts             aggregations
│   ├── db/
│   │   ├── schema.ts          Drizzle schema (single source of truth)
│   │   ├── client.ts          driver selection: postgres | pglite
│   │   └── repositories/      typed data access
│   ├── adsb/
│   │   ├── provider.ts        AdsbProvider interface + normalised point
│   │   ├── providers/adsblol.ts
│   │   ├── providers/opensky.ts
│   │   └── registry.ts        provider factory from env
│   ├── pipeline/
│   │   ├── backfill.ts        raw import for one aircraft / range
│   │   ├── rebuild-flights.ts raw → flights (idempotent, versioned)
│   │   └── recompute-costs.ts flights → costs
│   ├── cli/                   thin argv wrappers around pipeline/
│   └── app/                   Next.js — Phase 10, not yet present
└── tests/
    ├── fixtures/              recorded ADS-B tracks (real + synthetic)
    └── *.test.ts
```

---

## 4. Database

### 4.1 Engine choice

Target engine is **PostgreSQL 17** (`docker-compose.yml`). For contributors without
Docker the same schema runs on **PGlite** (Postgres compiled to WASM, embedded in the
Node process) — identical SQL dialect, zero setup, selected automatically when
`DATABASE_URL` is absent. This keeps "runs locally in one command" true without
forking the schema.

**PostGIS is deliberately not used.** The only geographic operations we need are
great-circle distance and nearest-airport lookup over a ~80k-row static table. Both
are cheap in TypeScript (haversine + a 1°×1° grid index), and avoiding the extension
keeps the PGlite path viable. Revisit if we ever need polygon/airspace queries.

### 4.2 Tables

```
source                 provenance for everything else
aircraft               tracked registry (admin-configured)
airport                reference data (OurAirports)
import_job             one run of the collector, for /admin/imports
raw_adsb_position      append-only normalised observations
flight                 detected flight (derived, rebuildable)
flight_track           simplified published geometry for one flight
route                  ordered airport pair + city-pair key (derived)
cost_model             versioned, time-bounded cost parameters
cost_model_change      audit log: old value, new value, who, when, source
flight_cost            computed cost interval + explainable breakdown
flight_purpose         manual enrichment, always sourced
```

Key columns beyond the brief:

* `aircraft.verification_status` — `verified | needs_verification | disputed`.
  Nothing enters the tracked set as "verified" without a `source_id`.
* `*.data_status` — `real | demo | manual` on `aircraft`, `raw_adsb_position` and
  `flight`. Queries never mix statuses; the public API defaults to `real`.
* `flight.detector_version` — flights detected by an older algorithm are visibly
  stale and can be selectively rebuilt.
* `flight.published_at` — materialised `arrival_time + PUBLICATION_DELAY_HOURS`;
  the publication gate compares against it, so the delay is also queryable/indexable.

### 4.3 Indexing strategy

`raw_adsb_position` is the only table that grows without bound, so it drives the
index design:

* `PRIMARY KEY (id bigserial)`
* `UNIQUE (aircraft_icao24, ts, source)` — makes ingest idempotent; re-running a
  backfill over the same range inserts nothing new (`ON CONFLICT DO NOTHING`).
* `INDEX (aircraft_icao24, ts)` — the only access pattern the pipeline uses
  (fetch one aircraft over one time range, in order).
* No index on lat/lon. We never query raw positions spatially; we stream them
  ordered by time and do geometry in memory.
* Columns are narrow (`real`/`integer`/`smallint`, not `numeric`), and per-point
  provider payloads are **not** stored as JSON — the normalised columns are the
  contract. Roughly 60 bytes/row: one aircraft-year of dense coverage is
  ~10–20 M rows, which a single Postgres node handles comfortably.
* Partitioning by month on `ts` is the documented escape hatch once the table
  passes ~100 M rows. Not needed for the Slovak fleet.

`flight` gets `(aircraft_id, departure_time)`, `(published_at)`,
`(departure_airport_id)`, `(arrival_airport_id)`.

---

## 5. ADS-B provider abstraction

```ts
export interface AdsbProvider {
  readonly name: string
  readonly capabilities: {
    history: boolean
    historyWindowDays: number | null   // null = unbounded / unknown
    live: boolean
    requiresAuth: boolean
  }
  getAircraftHistory(icao24: string, from: Date, to: Date): Promise<AdsbPosition[]>
  probe?(): Promise<ProviderHealth>
}
```

`AdsbPosition` is the normalised point from the brief plus two fields the pipeline
needs to stay honest: `source` (provider name) and `positionAgeSeconds` (staleness
flag from the trace format, so interpolated/stale points can be down-weighted).

**No database column is ever shaped by a provider payload.** Adapters translate into
`AdsbPosition` and nothing else crosses the boundary.

### Implemented adapters

| Provider    | Mode                  | History window       | Auth        |
| ----------- | --------------------- | -------------------- | ----------- |
| `adsblol`   | daily trace archive   | **~45 days rolling** | none        |
| `opensky`   | REST `/tracks`,`/flights` | months (rate-limited) | OAuth2 client credentials |

`adsb.lol` serves `readsb`-format daily traces at
`globe_history/YYYY/MM/DD/traces/<last2hex>/trace_full_<icao>.json` (gzip). The
adapter decodes the positional array format into `AdsbPosition[]`.

> **Measured constraint (2026-08-21):** the adsb.lol history archive only goes back
> roughly 45 days. Dates older than that return `504`. Deep backfill to 2025 is
> therefore *not possible from adsb.lol* — see `DATA_SOURCES.md` for the options.
> The append-only raw store means coverage grows from the day we start collecting.

---

## 6. Historical backfill

```bash
npm run adsb:backfill -- --aircraft 505C06 --from 2026-07-08 --to 2026-08-21
npm run flights:rebuild -- --aircraft 505C06
npm run flights:list   -- --aircraft 505C06
```

Backfill is deliberately **narrow and resumable**:

* only ICAO addresses present in `aircraft` with `tracking_enabled = true`,
* one aircraft × one day is the unit of work, recorded in `import_job`,
* days already fully imported are skipped unless `--force`,
* rate-limited (`ADSB_RATE_LIMIT_RPS`, default 2/s) and retried with backoff,
* a failed day fails *that day*, not the run.

We never import a bounding box or "all of Europe".

---

## 7. Flight detection algorithm

Input: all `raw_adsb_position` for one aircraft, ordered by `ts`.

### Step 1 — point classification

Each point is `GROUND`, `AIR` or `UNKNOWN`:

* `onGround = true` from the source → `GROUND` (strongest signal),
* altitude reported as ground / `alt_baro` within `GROUND_ALT_MARGIN_FT` (400 ft) of
  the nearest airport elevation **and** `groundSpeed < GROUND_SPEED_KT` (60) → `GROUND`,
* `altBaro > 1000 ft AGL` or `groundSpeed > 100 kt` → `AIR`,
* otherwise `UNKNOWN` (resolved by neighbours, never by guessing).

### Step 2 — segmentation with gap tolerance

Consecutive points are split into segments only when the evidence supports it:

* gap > `GAP_HARD_SECONDS` (default 6 h) → always split,
* `GAP_SOFT_SECONDS` (30 min) < gap ≤ `GAP_HARD_SECONDS` → split **only if** the
  points on both sides are `GROUND` and within ~5 km of each other,
* gap while airborne, or gap where the implied ground speed between endpoints is
  plausible (≤ 700 kt) → **do not split**; record a `CoverageGap` instead.

This is the direct answer to "*neoddeľ dva úseky jedného letu iba preto, že na
niekoľko minút zmizli dáta*": a data gap degrades `dataCoverage`, it does not create
a phantom flight.

### Step 3 — state machine

```
GROUND ──(gs>60kt ∧ (vr>300fpm ∨ alt rising))──► TAKEOFF
TAKEOFF ──(AGL>1000ft sustained ≥2 pts)──────────► AIRBORNE
AIRBORNE ──(AGL<3000ft ∧ descending ∧ gs falling)► APPROACH
APPROACH ──(GROUND sustained ≥ MIN_GROUND_SEC)───► LANDED ──► GROUND
APPROACH ──(climbs back >3000ft AGL)─────────────► AIRBORNE   (go-around)
```

* `MIN_GROUND_SECONDS` (default 300 s) is what separates a **landing** from a
  **touch-and-go**. Below the threshold the flight continues.
* A segment that starts already airborne yields `departureTimeEstimated = true` and a
  departure airport confidence capped at `UNKNOWN_EDGE_MAX_CONFIDENCE` (0.45).
  Same for a segment that ends airborne. We report what we saw, not what we assume.

### Step 4 — measurements

* `distanceKm` = Σ haversine over consecutive airborne points; segments spanning a
  coverage gap contribute a straight great-circle leg, and the amount of distance
  that came from gap-bridging is stored separately (`distanceFromGapsKm`) so the
  number can be qualified rather than quietly overstated.
* `greatCircleKm` = origin → destination direct distance.
* `durationSeconds` = arrival − departure.

### Step 5 — coverage & confidence

```
dataCoverage = 1 − (Σ gap seconds > 60 s) / durationSeconds
routeConfidence  ← dataCoverage, maxGapSeconds, point density, edge completeness
airportConfidence ← §8 matching score (separately for departure and arrival)
confidence (overall) = min(routeConfidence, airportConfidence) → HIGH/MEDIUM/LOW
```

---

## 8. Airport matching

Reference data: **OurAirports** (public domain), ~83 000 rows, loaded into `airport`
and into an in-memory 1°×1° grid index.

For each flight edge, take the representative ground point (first/last `GROUND` point,
falling back to the lowest-and-slowest point), then score every airport within
`AIRPORT_SEARCH_RADIUS_KM` (10 km, widened to 25 km for airborne edges):

```
distanceScore = exp(−distanceKm / 2.5)
typeWeight    = large 1.0 · medium 0.95 · small 0.8 · heliport 0.5 (1.0 for rotorcraft)
edgeWeight    = 1.0 if the edge has ground evidence, else 0.45
score         = distanceScore × typeWeight × edgeWeight
```

Then an **ambiguity penalty**: if the runner-up scores > 70 % of the winner (two
airfields side by side), confidence is reduced proportionally. Below
`AIRPORT_MIN_CONFIDENCE` (0.5) the flight stores `NULL` for the airport and keeps the
best candidate as `probable_*_airport_id` — rendered as *"Unknown / probable airport"*.

Being nearest is never sufficient on its own; that is exactly what the penalty and the
`edgeWeight` encode.

---

## 9. Cost engine

A cost model is **versioned and time-bounded**; a historical flight is always priced
with the model that was valid on its departure date (`cost_model.valid_from/valid_to`).
Any change writes a `cost_model_change` row (old value, new value, valid from, source,
who) — the audit requirement in §32.

Components, each independently `included` or `unavailable`:

| Component            | Formula                                                       |
| -------------------- | ------------------------------------------------------------- |
| fuel                 | `fuelBurnKgPerHour × hours × fuelPricePerKg`                   |
| maintenance          | `maintenancePerFlightHour × hours + maintenancePerCycle × 1`   |
| crew                 | `crewHourlyCost × hours`                                       |
| → **direct operating cost** | sum of the above                                       |
| allocated fixed      | `fixedAnnualCost / expectedAnnualFlightHours × hours`          |
| depreciation         | `acquisitionCost / depreciationYears / expectedAnnualFlightHours × hours` |
| airport & handling   | only from recorded invoices/known fees, else `unavailable`     |

`hourlyVariableCost`, when a sourced all-in figure exists, replaces fuel+maintenance+crew
rather than adding to them.

**Intervals, not false precision.** Every input carries an `uncertaintyPct`
(defaults: fuel 10 %, maintenance 25 %, crew 20 %, fixed 30 %, depreciation 30 %).
`low`/`high` are the conservative envelope (Σ of component lows / Σ of component highs)
— deliberately not a quadrature sum, because the inputs are not independent estimates.
Output is rounded to 2 significant-ish figures (nearest €100 above €1 000):

```
Estimated cost €7,200–€8,900
```

The engine returns a `breakdown[]` where every entry carries its formula string, its
inputs, its source references and its status. Nothing is a black box, and any
component we cannot source is printed as `not included / data unavailable` rather than
being silently treated as zero.

`costConfidence` = f(share of cost that is `included`, width of the interval).

---

## 10. Recurring-route detection

Over a rolling window (default 365 days), for every ordered pair `A→B` and every
unordered city pair `A⇄B`:

```
n            = number of legs
months       = distinct calendar months containing ≥1 leg
monthSpread  = months / months in window
intervals    = days between consecutive legs
regularity   = 1 − clamp(MAD(intervals) / median(intervals), 0, 1)
symmetry     = min(n(A→B), n(B→A)) / max(n(A→B), n(B→A))
volume       = min(1, ln(1+n) / ln(1+24))

score = 100 × (0.35·volume + 0.30·monthSpread + 0.20·regularity + 0.15·symmetry)
```

Classification:

* `recurring` — `score ≥ 60` **and** `n ≥ 6` **and** `months ≥ 4`
* `occasional` — `n ≥ 2`
* `one-off` — `n = 1`

Each output carries the component values, so a score can be explained, not just shown.

---

## 11. Publication delay

```ts
publishableAt(flight) = flight.arrivalTime + PUBLICATION_DELAY_HOURS
isPublishable(flight, now) = flight.arrivalTime != null && publishableAt <= now
```

Enforced in `src/core/publication.ts`, applied as a SQL predicate in every public
repository method, and asserted by tests that call the public API with an in-progress
flight and a just-landed flight in the database and require both to be absent.

---

## 12. Environment variables

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `DATABASE_URL` | *(unset)* | Postgres connection string. If unset, PGlite is used. |
| `PGLITE_PATH` | `./data/pglite` | On-disk location of the embedded database. |
| `PUBLICATION_DELAY_HOURS` | `6` | Delay between detected landing and public visibility. |
| `ADSB_PROVIDER` | `adsblol` | Active provider (`adsblol` \| `opensky`). |
| `ADSBLOL_HISTORY_BASE_URL` | `https://globe.adsb.lol` | Trace archive host. |
| `ADSBLOL_API_BASE_URL` | `https://api.adsb.lol` | Live API host (not used publicly). |
| `ADSB_RATE_LIMIT_RPS` | `2` | Requests per second against any provider. |
| `ADSB_HTTP_TIMEOUT_MS` | `45000` | Per-request timeout. |
| `ADSB_CACHE_DIR` | `./data/cache/adsb` | Raw provider responses, for reproducibility. |
| `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` | *(unset)* | OAuth2 credentials. |
| `OPENSKY_BASE_URL` | `https://opensky-network.org/api` | |
| `AIRPORTS_DATA_URL` | OurAirports CSV | Airport reference dataset. |
| `DETECT_GAP_SOFT_SECONDS` | `1800` | Soft split threshold. |
| `DETECT_GAP_HARD_SECONDS` | `21600` | Hard split threshold. |
| `DETECT_MIN_GROUND_SECONDS` | `300` | Landing vs touch-and-go. |
| `DETECT_MIN_FLIGHT_SECONDS` | `240` | Discard sub-4-minute "flights". |
| `AIRPORT_SEARCH_RADIUS_KM` | `10` | Ground-edge search radius. |
| `AIRPORT_MIN_CONFIDENCE` | `0.5` | Below this the airport is "unknown/probable". |
| `ALLOW_UNVERIFIED_COST_MODELS` | `false` | Refuse to price flights with unsourced models. |
| `DEMO_DATA_ENABLED` | `false` | Allow `data_status = 'demo'` rows to be created. |
| `LOG_LEVEL` | `info` | |

---

## 13. Implementation plan

| Phase | Scope | Status |
| ----- | ----- | ------ |
| 1 | Database schema + migrations + driver selection | ✅ |
| 2 | Aircraft registry, seed, sources, verification status | ✅ |
| 3 | `AdsbProvider` abstraction + adsb.lol adapter (+ OpenSky) | ✅ |
| 4 | Historical import of one aircraft, `import_job` tracking | ✅ |
| 5 | Flight reconstruction (segmentation + state machine) | ✅ |
| 6 | Airport matching with confidence | ✅ |
| 7 | CLI listing of detected flights | ✅ |
| 8 | Cost engine + versioned models + audit | planned |
| 9 | Analytics: routes, recurring routes, calendar, insights | planned |
| 10 | Web UI, public API, methodology pages, export | planned |

Phases 8–10 are deliberately *after* a verified pipeline. A dashboard over unproven
data would be the failure mode this project exists to avoid.

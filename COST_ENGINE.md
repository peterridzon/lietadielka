# Cost engine — design

The §73 deliverable of `COST_ENGINE_SPEC_SK.md`: data model, interfaces, equations,
calculation flow, source hierarchy, uncertainty model, worked examples and edge cases.

Priority order, from the specification:
**AUDITABILITY > ECONOMIC CORRECTNESS > TRANSPARENCY > FALSE PRECISION.**

The goal is not to show that state aircraft are expensive. It is to produce a number
about which we can say exactly where it came from, what it contains, what it omits, and
how much it can be trusted — including when that number favours the state aircraft.

---



## What a number is, before what it is worth

Public records give figures of very different standing, and treating them alike is the
fastest way to publish something indefensible. Every recorded figure carries its nature,
and the rule is that a figure may never be promoted to a stronger one without a source
that proves the promotion:

| Nature | Meaning | Example here |
| --- | --- | --- |
| Confirmed expenditure | an invoice, or a record of payment | none yet |
| Ordered | a commitment placed, not evidence it was paid | pilot type training, 164 800 € |
| Contracted | a signed agreement | — |
| Procurement ceiling | the most a framework may draw, often largely undrawn | maintenance, 10 000 000 € |
| Budgeted | planned, not spent | LÚ MV SR annual budget |
| Estimated | a figure the document itself calls an estimate | acquisition, "takmer 46 mil." |
| Modelled | derived by us from something above | every per-flight cost |

Two of these bite in practice. A framework ceiling divided by four years produces a rate
that looks like data and is not, which is why the ten million is deliberately used by
nothing. And an order is a commitment: the training order names 164 800 €, while reporting
puts the whole training package near 1.2 million, so even the order is a fragment.

Allocation is tracked separately from the figure. Most Defence orders name no airframe —
two Bombardier documentation orders and a navigation unit are almost certainly for these
aircraft, but "almost certainly" is recorded as probable, not confirmed, and a probable
allocation feeds no total. The navigation unit carries a further warning: it may already
sit inside the maintenance framework, and counting both would double-count.


## The Global 5000 rate is a benchmark, not a Slovak figure

No operating cost for the two Air Force Global 5000s has been obtained. The only Slovak
numbers in hand are a four-year maintenance framework with a ten-million ceiling — a
ceiling is not spending, and dividing it by four would invent a rate — and two procurement
fines under appeal, which are not operating costs at all. Neither is used by any model.

For a long time those flights therefore carried no cost. That was defensible while they
were a handful; at eighty-seven of them it stopped being caution and started being
misleading, because a blank reads as free.

They are now costed from independent commercial estimators for the type: variable cost
7 807–8 368 USD per flight hour, converted at the ECB 2026 average of 1.1701 USD/EUR, with
the interval widened downwards because a military operator buys fuel and maintenance on
different terms. Source tier **D**. A politician's claim of roughly 12 000 €/FH is recorded
alongside but used by nothing; it sits near the upper end of the *total* benchmark at low
utilisation, which makes it a weak cross-check rather than a source.

Three things follow, and all three are on the page rather than buried here:

* every such figure is set in a lighter weight in the flight list, so it never reads as
  solidly as one traced to a government document;
* the headline total states what share of itself rests on the benchmark — currently 29 %;
* the moment a real invoice or parliamentary answer arrives, the model is replaced and
  this section goes with it.


## 0. What we actually have

Before any modelling, the honest inventory of sourced inputs as of 2026-08-22.

One primary government document carries almost everything we know:
**„Informácia o využívaní služieb Leteckého útvaru Ministerstva vnútra Slovenskej
republiky"**, rokovania.gov.sk ([PDF](https://rokovania.gov.sk/download.dat?id=0911134E5672416C9CC925B732084BF0-9124DD7BD0C50122112225CE50FA4467)),
a material effective from 1 January 2021. Source tier **A4**.

| Figure | Value | Note |
| ------ | ----- | ---- |
| Direct operating cost, fixed-wing, 2018–2019 average | **4 079 €/FH** | average of F100 and A319 |
| Direct operating cost, long-term incl. 2020 | **3 802 €/FH** | *"vrátane poplatkov"* — includes charges |
| Observed spread at the most-used airports | **2 359.55 – 5 300.75 €/FH** | varies by destination |
| Helicopters, 2018–2019 / long-term | 1 012 / 812 €/FH | out of scope for the tracked fleet |
| Fixed-wing hours flown, 2019 | **1 400 FH** | ~840 of them not for constitutional officials or MoI |
| Minimum hours to maintain competency | 600 FH fixed-wing + 600 FH rotary | |
| Long-term budget at that minimum | **9 885 780 €/year**, *excluding payroll* | whole unit, both fleets |

The document's own planning table is internally consistent with the 3 802 rate
(768 004 € ÷ 202 h = 3 802.0 €/h exactly, and the same for every other row), which is
a useful check that we have read it correctly.

Two further facts from the same document shape the model:

* Only **direct** operating costs may be re-invoiced to other users. The President, the
  Speaker and the Prime Minister fly without payment. This is why a "direct cost" figure
  exists officially at all, and why it is the better-evidenced of the two layers.
* Flights carrying the President, Prime Minister or a minister are **cheaper**, because
  Commission Regulation (EU) 2019/317 Article 31(3) exempts them from route charges. A
  component-level model must know whether an exempt official was aboard; our blended
  hourly rate already averages over both cases.

Everything else — fuel contracts, maintenance contracts, insurance, payroll, handling —
is **not yet sourced**. The engine is built so those slot in without changing anything
that depends on them.

---

## 1. Two economic questions, kept apart

| | Question | Output |
| --- | --- | --- |
| **Direct** | What would the state not have spent if this flight had not happened? | `DIRECT_FLIGHT_COST` |
| **Full** | What does maintaining this capability cost the taxpayer, per flight? | `FULL_TAXPAYER_COST` |

They answer different questions and are never merged into one headline number. The
interface shows both, always labelled, always with the interval.

---

## 2. Source hierarchy

```
A1 actual invoice            A2 official actual expenditure
A3 government contract       A4 official government document
A5 airport / EUROCONTROL tariff
B1 manufacturer              B2 maintenance provider / certified operator
C  industry benchmark        D  analytical estimate
```

Precedence `A1 > A2 > A3 > A4 > A5 > B1 > B2 > C > D`. Every cost input carries
`sourceTier`, `sourceId`, `confidence`, `validFrom`, `validTo`.

**Contract value semantics.** A framework ceiling is not spending. Every research item
records `contractValueType`, and the resolver prefers
`actual_spend > invoice_value > executed_contract_value > awarded_contract_value >
maximum_framework_value > industry_benchmark`. Storing a framework maximum as
`actualSpend` is rejected at write time, and there is a test for it.

---

## 3. Database model

Additions to the existing schema. Nothing already there changes meaning.

```
source                  + source_tier, valid_from, valid_to,
                          original_currency, original_value, contract_value_type

cost_research_item      the research inbox: one sourced figure, unreviewed to accepted
fuel_price              price per kg, time-bounded, with method
cost_benchmark          historical validation points (the A4 rates above)
annual_utilisation      flight hours per scope per year, by method and tier
annual_fixed_cost       annual fixed cost per scope per year, with excluded categories
airport_fee_model       landing/handling/parking by airport and MTOW band
cost_model              + model_version, scope, allocation_method, price_year,
                          rate fields for a blended hourly model
flight_cost             direct/fixed/full low-mid-high, components, trace, warnings,
                          engine + model version, is_current  (old rows are kept)
mission                 a trip: one or more legs, grouped confirmed/automatic/manual
mission_leg             flight ↔ mission
flight_passengers       passenger count with its source; absent by default
commercial_fare         comparable fare per city pair, date, scenario, quality
```

Key rules encoded in the schema rather than in prose:

* `flight_cost.is_current` — recomputation **inserts**; it never updates or deletes.
  The audit trail from §52 is the table itself.
* `annual_fixed_cost.excluded_categories` — a fixed-cost figure that omits payroll says
  so, and the interface prints the omission (§71) instead of implying completeness.
* `flight_passengers` is a separate table with a source, so "we do not know" is the
  default state rather than a null that invites a guess.

---

## 4. TypeScript interfaces

```ts
export type SourceTier = 'A1'|'A2'|'A3'|'A4'|'A5'|'B1'|'B2'|'C'|'D'

export type CostStatus = 'known'|'estimated'|'unknown'|'not_applicable'|'known_zero'

/** A value we are unsure about. low ≤ mid ≤ high, all in the same currency. */
export type CostInput = {
  low?: number
  mid?: number
  high?: number
  confidence: Confidence
}

export type FlightCostComponent = {
  category: 'fuel'|'navigation'|'airport'|'handling'|'maintenance_hour'
          | 'maintenance_cycle'|'crew_variable'|'blended_direct'
          | 'insurance'|'crew_fixed'|'training'|'facility'|'software'
          | 'capital'|'administration'|'other'
  scope: 'direct'|'fixed'
  status: CostStatus
  valueLow?: number
  valueMid?: number
  valueHigh?: number
  currency: 'EUR'
  /** Human-readable, reproducible: "0.70 h × 3 802 €/h". */
  calculationMethod: string
  inputs: Record<string, number | string | null>
  sourceIds: string[]
  sourceTier?: SourceTier
  confidence: Confidence
}

export type CostResult = {
  direct: Interval          // low / mid / high
  fixed: Interval
  full: Interval
  components: FlightCostComponent[]
  confidence: Confidence
  basis: 'nominal_eur' | 'inflation_adjusted_eur'
  priceYear: number | null
  /** Categories the total is known not to include — printed, never hidden. */
  missing: string[]
  warnings: CostWarning[]
  trace: CalculationTrace
  costModelVersion: string
  engineVersion: string
}
```

The `NavigationCostCalculator` abstraction from §8 exists so a EUROCONTROL model can be
dropped in later; the default implementation returns `unknown` rather than a guess.

---

## 5. Equations

### Direct cost — component build-up

```
DIRECT = FUEL + NAVIGATION + AIRPORT + HANDLING
       + VARIABLE_MAINTENANCE + CYCLE_MAINTENANCE + VARIABLE_CREW + OTHER_DIRECT

FUEL              = BLOCK_HOURS × FUEL_BURN_KG_PER_HOUR × FUEL_PRICE_EUR_PER_KG
VARIABLE_MAINT    = FLIGHT_HOURS × MAINTENANCE_RESERVE_PER_FLIGHT_HOUR
CYCLE_MAINT       = FLIGHT_CYCLES × MAINTENANCE_RESERVE_PER_CYCLE      (1 cycle per leg)
```

An unknown component is `unknown`, never zero. `known_zero` is a distinct status, used
for example when a route charge was genuinely waived.

### Direct cost — blended rate

Where no components are sourced but an official all-in hourly rate is, the model is a
single `blended_direct` component:

```
DIRECT = BLOCK_HOURS × BLENDED_DIRECT_RATE_EUR_PER_HOUR
```

A blended rate **replaces** the components it already contains; the engine refuses to
add both. This is the mode the Slovak fleet is in today, because 3 802 €/h is the only
sourced direct figure that exists.

### Block hours

```
BLOCK_HOURS = measured, where ground movement was observed at both ends
            = AIRBORNE_HOURS + TAXI_ALLOWANCE_HOURS, otherwise (flagged as estimated)
```

Our detector already records ground phases, so most flights get a measured block time
rather than an assumed taxi allowance.

### Fixed cost allocation

```
ANNUAL_FIXED_COST                = Σ fixed categories for the scope and year
ALLOCATED_FIXED_COST_PER_HOUR    = ANNUAL_FIXED_COST / ANNUAL_PRODUCTIVE_FLIGHT_HOURS
ALLOCATED_FIXED_COST_FLIGHT      = ALLOCATED_FIXED_COST_PER_HOUR × FLIGHT_HOURS
FULL_TAXPAYER_COST               = DIRECT_FLIGHT_COST + ALLOCATED_FIXED_COST_FLIGHT
```

**The denominator decides the answer.** 7 000 000 € over 700 hours is 10 000 €/h; over
1 400 hours it is 5 000 €/h. Preference order for the denominator:

1. official annual flight hours,
2. a fully reconstructed ADS-B dataset with high coverage,
3. coverage-adjusted ADS-B estimate — `detectedHours / estimatedCoverage`,
4. benchmark.

Options 3 and 4 force `method = coverage_adjusted_estimate` and cap confidence at
medium. An incomplete ADS-B dataset must never inflate the per-hour figure, which is
exactly what dividing by an undercounted denominator would do.

### Uncertainty

```
COST_LOW  = Σ component lows
COST_MID  = Σ component mids
COST_HIGH = Σ component highs
```

The conservative envelope, not a quadrature sum: these inputs are not independent
measurements. No Monte Carlo in the MVP.

Rounding follows the precision of the inputs — to the nearest 100 € above 1 000 €.
`11 900 – 13 800 €`, never `12 347.29 €`.

### Break-even

```
DIRECT_BREAK_EVEN = DIRECT_STATE_MISSION_COST / COMMERCIAL_FARE_PER_PASSENGER
FULL_BREAK_EVEN   = FULL_STATE_MISSION_COST   / COMMERCIAL_FARE_PER_PASSENGER
```

Both are always shown. They answer different questions: the first is the economics of
one extra flight, the second the economics of maintaining the capability at all.

With a known passenger count:

```
COMMERCIAL_COST = PASSENGERS × FARE
STATE_PREMIUM   = STATE_COST − COMMERCIAL_COST
PREMIUM_PERCENT = (STATE_COST / COMMERCIAL_COST − 1) × 100
```

Guarded against a zero commercial cost.

---

## 6. Calculation flow

```
flight ─┬─► block hours (measured, else airborne + taxi allowance)
        ├─► cycles (1 per leg)
        └─► date
                │
                ▼
       resolve cost model valid at the flight date
       ── none valid? nearest earlier, warning, confidence capped ── (§70)
                │
        ┌───────┴────────┐
        ▼                ▼
  component build-up   blended rate      ── never both
        └───────┬────────┘
                ▼
         DIRECT low/mid/high
                │
                ▼
  fixed: annual fixed cost ÷ annual hours (declared method) × flight hours
                │
                ▼
         FULL = DIRECT + FIXED
                │
                ▼
  validation: compare against benchmark and against any official annual total
  ── deviation > 20 % ⇒ validationWarning, confidence must not be HIGH ── (§64)
                │
                ▼
  persist a NEW flight_cost row, mark it current, keep every earlier row
```

---

## 7. Worked example — one flight

Real flight from the database: **OM-BYA, 20 July 2026, LZIB → LKPR**, callsign SSG006.

```
airborne          00:42:11  =  0.703 h
block (measured)  00:57     =  0.950 h      first ground movement to last
cycles            1
model             lu-mvsr-fixedwing-direct-2021-v1   (A4, price year 2020)
```

Direct, blended:

```
mid   0.950 h × 3 802 €/h  =  3 612 €
low   0.950 h × 2 359.55   =  2 242 €        observed lower bound at busy airports
high  0.950 h × 5 300.75   =  5 036 €        observed upper bound
```

Fixed, allocated — the derived layer, and the weakest one:

```
annual budget excl. payroll (whole unit, min. nálet)      9 885 780 €
less direct at min. nálet   600×3 802 + 600×812         − 2 768 400 €
implied annual fixed excl. payroll                        7 117 380 €
allocated to fixed-wing by flight hours (600/1200)        3 558 690 €

per hour at the planning minimum   3 558 690 / 600  = 5 931 €/h
per hour at 2019 actual hours      3 558 690 / 1400 = 2 542 €/h
```

Both are shown, because the choice of denominator is the finding, not a detail. At the
2019 utilisation the flight's allocated fixed cost is `0.703 h × 2 542 = 1 787 €`.

```
Odhadované priame prevádzkové náklady    2 200 – 5 000 €
Odhadované alokované fixné náklady       1 800 – 4 200 €
Odhadované celkové náklady daňovníka     4 000 – 9 200 €

Kvalita odhadu: NÍZKA
Nezahŕňa: mzdové náklady posádok a personálu, kapitálové náklady
Cenová úroveň vstupov: 2020, let 2026 — 6 rokov rozdiel, neupravené o infláciu
```

Every one of those lines is reproducible from the trace, and none of it is presented as
an invoice.

---

## 8. Worked example — a round-trip mission

**OM-BYA, 12–16 July 2026, Bratislava ⇄ Newark**, two legs, 76.6 h on the ground between.

```
leg 1  2026-07-12  LZIB → KEWR   8.77 h airborne
leg 2  2026-07-15  KEWR → LZIB   7.95 h airborne
                                ─────────
mission airborne                16.72 h,  2 cycles

STATE_MISSION_DIRECT (mid)  ≈ 17.2 block h × 3 802  =  65 400 €
STATE_MISSION_FULL   (mid)  ≈ 65 400 + 16.72 × 2 542 = 107 900 €
```

Grouping is `automatic` here: two legs by the same aircraft, the second departing from
where the first arrived, inside the window. It carries a confidence and can be
overridden manually.

We do **not** know the passenger count, so the engine refuses to compute cost per
passenger, a commercial total, a premium or a saving. It computes break-even instead.

---

## 9. Worked example — break-even

Using the specification's own test values (§67):

```
state direct cost   8 000 €
state full cost    14 000 €
commercial fare       700 € per passenger

direct break-even  8 000 / 700 = 11.43  →  displayed as "~12 cestujúcich"
full break-even   14 000 / 700 = 20.00  →  displayed as "~20 cestujúcich"
```

Reading: below about 12 passengers the flight costs more than buying tickets even on
marginal costs alone; below about 20 it costs more once the maintained capability is
counted. Above those numbers the state aircraft is the cheaper option on this route —
and the interface says so just as plainly.

Where the passenger count is unknown, a sensitivity table replaces the verdict:

```
Cestujúci   Komerčne   Priame št.   Celkové št.
   5         3 500      8 000        14 000
  10         7 000      8 000        14 000
  15        10 500      8 000        14 000     ← direct break-even passed
  20        14 000      8 000        14 000     ← full break-even passed
  30        21 000      8 000        14 000
```

---

## 10. Edge cases, and what the engine does

| Case | Behaviour |
| ---- | --------- |
| No cost model valid at the flight date | Nearest earlier model, `stale_model` warning, confidence capped at low, price-year gap stated. Never silently extrapolated. |
| Component unknown | `status: unknown`, excluded from the sum, listed under "does not include". Never zero. |
| Charge genuinely waived (e.g. route charges for an exempt official) | `status: known_zero` — a real zero, distinct from an unknown. |
| Blended rate *and* components both available | Components win; the blended rate is recorded as a cross-check, never added. |
| Passenger count unknown | No cost per passenger, no premium, no saving. Break-even and sensitivity only. |
| Passenger count zero | Cost per passenger is undefined, not infinite. Reported as such. |
| Commercial fare 0 or absent | No premium percentage; comparison marked unavailable. |
| Framework maximum offered as spend | Rejected at write time. `contractValueType` must say what the figure is. |
| Fixed-cost figure excludes a category | Recorded in `excluded_categories`, printed in the UI, confidence reduced. |
| Annual hours denominator from incomplete ADS-B | Coverage-adjusted, method declared, confidence capped at medium. |
| Modelled annual total deviates > 20 % from an official total | `validationWarning`, confidence must not be high. |
| Aircraft withdrawn mid-period | Cost model validity windows and `aircraft.active_until` both apply. |
| Recomputation | New rows inserted, previous rows retained and marked not current. |
| Rebuilding flights | Hand-entered purposes and passenger counts are lifted out before the delete and re-attached by aircraft plus departure time (±30 min). Anything unmatched is reported loudly, never dropped. |
| A trip with an unidentified intermediate stop | Grouping needs matching identified airports to chain legs, so such a trip splits into two missions. Visible in the route key as `UNKNOWN`, and it understates mission-level cost. A known limitation. |

---

## 11. Implementation order

Following §72. Commercial fare scraping is deliberately last and is **not** implemented:
no fare source has been obtained, so the comparison layer exists as an interface that
reports `unavailable` rather than inventing a ticket price.

| Phase | Scope | Status |
| ----- | ----- | ------ |
| C1 | Cost research schema | ✅ |
| C2 | Source hierarchy and contract-value semantics | ✅ |
| C3 | Direct-cost calculator | ✅ |
| C4 | Fixed-cost allocator | ✅ |
| C5 | Full taxpayer cost | ✅ |
| C6 | Low/mid/high uncertainty | ✅ |
| C7 | Calculation trace | ✅ |
| C8 | Validation against the Slovak benchmarks | ✅ |
| C9 | Mission grouping | ✅ |
| C10 | Commercial alternatives | interface only — no fare source |
| C11 | Break-even analytics | ✅ |
| C12 | Cost dashboard | in the design preview |

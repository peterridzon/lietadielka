# Cost model

**Status: not implemented, and deliberately not estimated.**

The brief is explicit — *nevymýšľaj náklady*. There is no defensible public figure for
the hourly operating cost of the Slovak government fleet that we have been able to
source, so the seed models in `data/cost-models.seed.json` carry structure and no
numbers, and `ALLOW_UNVERIFIED_COST_MODELS` defaults to `false`.

The consequence is intended: until the inputs exist, every flight reports
*cost data unavailable* rather than a number that looks authoritative and is not.

---

## The model

A cost model is **versioned and time-bounded**. A historical flight is always priced
with the model that was valid on its departure date, so revising the methodology does
not silently rewrite the past.

```ts
type AircraftCostModel = {
  validFrom: Date
  validTo?: Date

  hourlyVariableCost?: number      // a sourced all-in figure, if one exists
  fuelBurnKgPerHour?: number
  fuelPricePerKg?: number

  maintenancePerFlightHour?: number
  maintenancePerCycle?: number

  crewHourlyCost?: number

  fixedAnnualCost?: number
  expectedAnnualFlightHours?: number

  acquisitionCost?: number
  depreciationYears?: number

  currency: 'EUR'
  sources: SourceReference[]
}
```

### Components

| Component | Formula |
| --------- | ------- |
| Fuel | `fuelBurnKgPerHour × hours × fuelPricePerKg` |
| Maintenance | `maintenancePerFlightHour × hours + maintenancePerCycle × 1` |
| Crew | `crewHourlyCost × hours` |
| **Direct operating cost** | sum of the above |
| Allocated fixed cost | `fixedAnnualCost / expectedAnnualFlightHours × hours` |
| Depreciation | `acquisitionCost / depreciationYears / expectedAnnualFlightHours × hours` |
| Airport and handling | only from recorded fees or invoices |
| **Estimated taxpayer cost** | sum of the components that are known |

`hourlyVariableCost`, where a sourced all-in figure exists, **replaces** fuel,
maintenance and crew rather than adding to them.

Any component whose inputs are missing is reported as `not included / data unavailable`.
It is never treated as zero, because a missing component and a free component are not
the same thing and summing them as if they were understates the total.

### Intervals, not false precision

Every input carries an uncertainty (defaults: fuel 10 %, maintenance 25 %, crew 20 %,
fixed 30 %, depreciation 30 %). The published low and high are the conservative envelope
— the sum of the component lows and the sum of the component highs — rather than a
quadrature sum, because these inputs are not independent measurements.

Output is rounded to the significance the inputs support:

```
Estimated cost €7,200–€8,900
```

not `€8,043.17`.

### Explainability

The engine returns a breakdown in which every entry carries its formula, its inputs,
its source references and its status. A reader can reconstruct the total by hand. There
is no hidden constant anywhere in the calculation.

### Auditability

Changing any input writes a `cost_model_change` row: field, old value, new value, the
date from which the new value is valid, who changed it, and the source. Recomputation
across historical flights is a single command, so a methodology change is visible and
reversible rather than quietly applied.

---

## Sources to obtain

Nothing below has been retrieved yet. Each would move one or more inputs from
*unavailable* to *sourced*.

| Input | Where it should come from |
| ----- | ------------------------- |
| Fixed annual cost, crew, staffing | MV SR budget chapter and annual reports |
| Maintenance contracts | Public procurement — [crz.gov.sk](https://www.crz.gov.sk/), [uvo.gov.sk](https://www.uvo.gov.sk/) |
| Fuel price actually paid | Fuel supply contracts in the same registers |
| Per-hour operating cost | Freedom-of-information request under zákon č. 211/2000 Z. z. |
| Fuel burn by type | Manufacturer performance data, or an operator figure |
| Landing and handling fees | Published airport charges (LZIB and destinations) |
| Acquisition cost, depreciation | Procurement records for the 2016–2017 fleet renewal |

Until then the honest output is the one the software currently gives: nothing.

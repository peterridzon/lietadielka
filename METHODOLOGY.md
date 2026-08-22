# Methodology

How every number this project publishes is produced, and what it does not mean.

The guiding rule: **an estimate is never presented as a fact.** Where the data does not
support a conclusion, the output says *unknown* or *data unavailable*.

---

## Security delay

> Z bezpečnostných dôvodov nezverejňujeme polohu štátnych lietadiel v reálnom čase.
> Lety publikujeme až po ich ukončení s časovým odstupom. Projekt slúži výhradne na
> analýzu využívania verejného majetku a verejných financií.

No public surface of this project reveals where a state aircraft is now, where it is
going, or that it is currently airborne. A flight becomes visible only once it has
ended and `PUBLICATION_DELAY_HOURS` (default 6) have passed since the detected landing.

Where a landing was never observed — the track simply stops — the last observed moment
is used in its place, which is strictly more conservative.

The rule is implemented once, in `src/core/publication.ts`, applied as a SQL predicate
in every public query, and covered by tests that assert both an in-progress flight and
a just-landed flight are unreachable.

---

## ADS-B and its limits

Aircraft broadcast their position; volunteer receivers pick it up and share it. This
gives genuinely public, independently verifiable data, with three consequences:

1. **Coverage is not uniform.** It is dense over populated Europe and sparse or absent
   over oceans, deserts and countries with few receivers. Transatlantic sectors in our
   own dataset show 50–60 % coverage.
2. **Coverage is not guaranteed.** A transponder can be off, in a mode that omits
   position, or simply unheard. Absence of data is not evidence of absence of a flight.
3. **Archives are short.** Our primary provider keeps about 40–45 days. Anything older
   is gone unless someone collected it at the time.

Every flight therefore carries a `dataCoverage` figure: the share of its duration for
which we actually hold fixes. Any interval longer than 60 seconds counts in full
against it, which understates coverage slightly on purpose.

---

## Flight detection

Input is every stored fix for one aircraft, in time order. Nothing depends on the
callsign; callsigns are recorded but never used to decide what is a flight.

**1. Each fix is classified as ground or airborne.** The aircraft's own on-ground
indication wins where present, since it comes from the surface-position broadcast.
Otherwise the classification falls back to height above the nearest field elevation and
ground speed, and where neither is conclusive the fix is marked unknown and takes the
label of its nearest classified neighbour. The label is interpolated; the position never is.

**2. The stream is split into continuous tracks.** Conservatively. A gap in the data is
not evidence of a landing. A track is only broken by a gap longer than six hours, or by
two fixes that no aircraft could have flown between. Everything else is recorded as a
coverage gap and reduces the coverage figure.

**2b. An intermediate landing we never saw is inferred, carefully.** Surface positions
are often not received at airports outside dense receiver coverage, so a turnaround can
look like nothing but a hole in a cruise. Where a gap of 15 minutes or more has, on both
sides, fixes below 6 000 ft above field elevation and under 250 kt, and the aircraft
moved less than 30 km in between, the only explanation is that it was on the ground, and
the track is split.

This is an inference, not an observation, and it is labelled as one: both resulting legs
carry estimated times, and the intermediate airport can never be reported as more than
*probable*. Without it, OM-BYK's Bratislava–Amman–Brussels rotation of 2026-08-19 was
reported as a single 7 000 km "Bratislava to Brussels" flight, with the Amman stop absent
from the record and 74 minutes on the ground counted as flying time.

**3. A state machine walks each track.**

```
GROUND → TAKEOFF → AIRBORNE → APPROACH → LANDED
```

The decision that matters is which ground contacts are real stops. A ground contact
shorter than five minutes is treated as a touch-and-go and the flight continues; longer,
and the flight has ended. Where the aircraft stops transmitting on the ground, the time
until it is next heard counts as time on the ground.

**4. Departure and arrival times.** Departure is the last moment observed on the
ground before the climb — wheels-up, not off-blocks. Arrival is the first moment
observed back on the ground. **Flight time is airborne time**, so it is shorter than
block time and not comparable to a published schedule.

Where a ground fix is separated from the flight by more than 30 minutes of lost
coverage, it is not treated as a witnessed departure or arrival: the aircraft was
parked, disappeared, and reappeared already airborne. The time falls back to the first
or last airborne fix and is marked as an estimate (shown as `~`).

**5. Filtering.** Anything shorter than four minutes or covering less than five
kilometres is discarded as ground movement.

### What this gets wrong

- A flight split across a long coverage gap can appear as two flights with unknown ends.
- A diversion followed by a quick departure can read as a touch-and-go.
- A destination that was never observed is reported as unknown, even though the aircraft
  obviously landed somewhere.
- An intermediate stop where coverage was lost only *above* 6 000 ft still merges two
  legs into one. The signature has to be visible for the inference to fire.
- Conversely, a long low-level hold with no coverage could in principle be mistaken for
  a stop. The 15-minute and 30-kilometre limits make this unlikely, not impossible.

---

## Airport identification

Reference data is [OurAirports](https://ourairports.com/), about 86 000 aerodromes.

For each end of a flight we take a representative fix — a ground fix adjacent to the
flight where one exists, otherwise the end of the track — and score every aerodrome
within 10 km (25 km when we only have an airborne fix):

```
score = distance score × aerodrome type weight × ground evidence weight
```

- **Distance score** is flat inside the aerodrome's own footprint (4 km for a large
  airport, less for smaller fields) and decays exponentially outside it. An aircraft
  parked a kilometre from the published reference point is *inside the airport*, and
  penalising that distance was measurably wrong.
- **Type weight** prefers real airports over airstrips and heliports — except for
  helicopters, where a heliport is entirely normal.
- **Ground evidence weight** is what separates a strong match from a weak one. If we
  never saw the aircraft on the ground there, confidence is capped at 0.45 and the
  result is at best "probable".
- **Ambiguity**: if a runner-up scores above 70 % of the winner, both lose confidence.
  At a dead heat the identification is rejected.

Two hard rules:

- **A fix above 5 000 ft above ground names no airport at all** — not even a probable
  one. A track that ends at cruise altitude tells us nothing about a destination, and
  naming the nearest airstrip under the flight path would invent one.
- **The search is bounded by the climb and the descent**, so a flight whose destination
  was never observed can never be answered with "it landed where it took off".

Below a confidence of 0.5 the airport is stored as *probable* and displayed with a
question mark, or as *unknown* if even that is unsupported.

---

## Distance and duration

- **Distance flown** is the sum of great-circle segments between consecutive fixes. It
  is a **lower bound**: within a coverage gap the aircraft is assumed to have flown
  straight, which it did not. The kilometres contributed by gaps are stored separately
  and reported, so a figure like *8 062 km (6 986 km bridged across gaps)* can be read
  for what it is.
- **Great-circle distance** is the direct origin-to-destination distance, always
  shorter than the flown track.
- **Duration** is arrival minus departure as defined above.
- Distances are reported to the kilometre and durations to the minute. Nothing is
  reported to a precision the inputs do not support.

---

## Confidence

Each flight carries several independent figures rather than one opaque grade:

| | |
| --- | --- |
| `dataCoverage` | share of the duration covered by fixes |
| `routeConfidence` | coverage, degraded for unobserved ends and sparse tracks |
| `departureAirportConfidence`, `arrivalAirportConfidence` | from the matching score above |
| `confidence` | overall label — the **lowest** of the above, mapped to high / medium / low |

Taking the minimum is deliberate. A flight with a perfect track and an unidentified
destination is not a high-confidence flight.

---

## Costs

Not yet implemented, and deliberately not estimated in the meantime. See
[COST_MODEL.md](COST_MODEL.md) for the model and for what has to be obtained before any
figure is published. Until then, every flight reports *cost data unavailable*.

---

## Purpose identification

The purpose of a flight is **never** inferred automatically. It is entered by hand,
always with a source URL and publisher, and marked `confirmed`, `probable` or
`unknown`. No political conclusion is generated by this software.

---

## Corrections

If something here is wrong, we want to know — particularly aircraft identities and
airport matches. Open an issue with the flight's permalink and what you believe the
correct value is, ideally with a source. See [CONTRIBUTING.md](CONTRIBUTING.md).

Because raw observations are never deleted, a corrected algorithm can be applied
retroactively to every flight ever recorded.

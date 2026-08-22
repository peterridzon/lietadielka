# Security

This project deals with the movements of aircraft that carry constitutional officials.
That imposes obligations which come **before** any transparency goal.

---

## The rule

**No public surface of this project ever reveals where a state aircraft is now, where it
is going, or that it is currently airborne.**

A flight becomes publicly visible only when both are true:

1. the flight has ended, and
2. `PUBLICATION_DELAY_HOURS` (default 6) have elapsed since the detected landing.

Where a landing was never observed — the track simply stops — the last observed moment
is used instead, which delays publication further rather than less.

The collector may hold data sooner. That is unavoidable: the data is collected from a
public archive. What matters is that nothing reaches a public reader before the delay
has passed.

## How it is enforced

- One implementation: `src/core/publication.ts`. Pure, clock-injectable, no other copy.
- `flight.published_at` is materialised in the database, so the delay is a queryable,
  indexable predicate rather than something each caller has to remember.
- `assertPublishable()` throws rather than filtering. A leak here is a safety failure
  and must be loud.
- Tests cover both sides of the boundary, an in-progress flight, and a flight with no
  arrival at all.
- Brief §45 requires an automated test that no public API can return a current position,
  an in-progress flight, or a destination before the flight has ended. That test lands
  with the API in Phase 10; the gate it will exercise already exists and is tested.

## What is deliberately not built

- No live map, no "currently airborne" view, no last-known-position endpoint.
- No push notifications, alerts or subscriptions tied to aircraft movement.
- No prediction of future flights, planned routes or filed flight plans.
- No linking of a flight to a named individual on board. The project analyses the use of
  public aircraft, not the movements of people.

Anyone deploying this must not set `PUBLICATION_DELAY_HOURS=0`. A longer delay is always
acceptable; a shorter one is not.

## Data we do not collect

- Passenger identities, delegation lists or manifests, unless already published by an
  official source, in which case the source is cited and the claim is attributed to it.
- Anything obtained other than from public ADS-B feeds and published documents.

## Aircraft in scope

Only aircraft in `data/aircraft.seed.json` with `tracking_enabled` are ever imported.
There is no bounding-box collection and no bulk ingest of unrelated traffic. Aircraft
that turn out to be privately owned are removed and recorded under `rejected` so they
are not re-added.

## Reporting a problem

For a suspected data leak, a publication-delay bypass, or anything that exposes a
current position, please report privately rather than opening a public issue. Ordinary
data corrections belong in public issues — see [CONTRIBUTING.md](CONTRIBUTING.md).

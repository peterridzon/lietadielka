# Contributing

The most valuable contributions to this project are **corrections** and **sources**, not
features.

---

## Reporting a data error

Open an issue with:

- the flight permalink (e.g. `2026-07-20-om-bya-lzib-lkpr`) or the aircraft registration,
- what is wrong,
- what you believe the correct value is,
- a source, if you have one.

Airport identifications and aircraft identities are the two areas most likely to be
wrong, and the two where an informed reader can help most.

Because raw observations are never deleted, a fixed algorithm can be applied
retroactively to every flight ever recorded — a correction is worth making even for
flights already published.

## Contributing a source

This is the highest-value contribution. Particularly wanted:

- **A primary confirmation of the ICAO 24-bit addresses** of the state fleet. Every
  aircraft is currently `needs_verification` because the mapping rests on a community
  database. See [DATA_SOURCES.md](DATA_SOURCES.md).
- **Operating cost figures** with a citable origin — budget documents, procurement
  contracts, answers to freedom-of-information requests. Nothing is estimated until
  something is sourced; see [COST_MODEL.md](COST_MODEL.md).
- **Official flight purposes** with a publisher and a URL.

Add sources to `data/*.seed.json` with the publisher, title, URL and date. Never enter a
figure without one.

## Code

```bash
npm install
npm run db:migrate && npm run seed && npm run airports:import
npm test
npm run typecheck
```

House rules, in order of importance:

1. **Never invent a value.** Unknown is `NULL`, and renders as *data unavailable*. A
   plausible default is worse than an admitted gap.
2. **Never delete raw observations.** They are irreplaceable once a provider's retention
   window moves past them. Derived data is free to drop and rebuild.
3. **Do not weaken the publication delay.** Changes touching
   `src/core/publication.ts` need a very good reason and more tests, not fewer.
4. **`src/core/**` stays pure.** No database, no network, no clock. That is what keeps
   the algorithms testable and the services separable.
5. **Bump `DETECTOR_VERSION`** when detection behaviour changes, so stale flights are
   identifiable and can be rebuilt.
6. **Add a test with a real track** when fixing a detection bug. Recorded fixtures live
   in `tests/fixtures/`; every bug fixed so far was found in real data, not in theory.
7. **No political commentary in code, comments, commit messages or output.** The project
   publishes measurements and their uncertainty. Interpretation is the reader's.

## Commits

Small and logical, one working change each, with a message that explains *why*. Run
`npm test` and `npm run typecheck` before committing.

# Lietadielka

Transparency platform for the use of Slovak state aircraft, built entirely on public
ADS-B data and public sources.

**This is not a flight tracker.** It never shows where a state aircraft is now. It
publishes flights only after they have ended, with a configurable delay, and only for
the purpose of examining how public aircraft and public money are used.

> Z bezpečnostných dôvodov nezverejňujeme polohu štátnych lietadiel v reálnom čase.
> Lety publikujeme až po ich ukončení s časovým odstupom. Projekt slúži výhradne na
> analýzu využívania verejného majetku a verejných financií.

---

## What works today

The project is built from the data upwards, not from the dashboard downwards. Phases
1–7 of the plan are complete and verified against real data:

| | |
| --- | --- |
| Database schema, migrations, driver selection | ✅ |
| Aircraft registry with sources and verification status | ✅ |
| `AdsbProvider` abstraction, adsb.lol and OpenSky adapters | ✅ |
| Historical import with per-day job tracking | ✅ |
| Flight reconstruction from raw positions | ✅ |
| Airport identification with confidence | ✅ |
| CLI listing of detected flights | ✅ |
| Cost engine | planned (Phase 8) |
| Analytics, recurring routes, insights | planned (Phase 9) |
| Web UI, public API, export | planned (Phase 10) |

See [ARCHITECTURE.md](ARCHITECTURE.md) for the design and
[METHODOLOGY.md](METHODOLOGY.md) for how every number is produced.

---

## Quick start

No Docker and no database server required — the pipeline runs against an embedded
PostgreSQL (PGlite) by default.

```bash
npm install
cp .env.example .env
npm run db:migrate          # create the schema
npm run seed                # load the aircraft registry
npm run airports:import     # load ~86k airports from OurAirports (12 MB, cached)
```

Then import and reconstruct one aircraft. The adsb.lol archive only reaches back about
40 days, so pick a recent range:

```bash
npm run adsb:backfill -- --aircraft 505C06 --from 2026-07-13 --to 2026-08-21
```

```bash
npm run flights:rebuild -- --aircraft 505C06
```

```bash
npm run flights:list -- --aircraft 505C06
```

To run against a real PostgreSQL instead, start the container and set `DATABASE_URL`:

```bash
docker compose up -d && npm run db:migrate
```

### Commands

| Command | Purpose |
| ------- | ------- |
| `npm run db:migrate` | Apply migrations |
| `npm run db:reset -- --derived` | Drop flights and rebuild-able data |
| `npm run seed` | Load `data/*.seed.json` |
| `npm run airports:import` | Load the airport reference dataset |
| `npm run adsb:backfill` | Import raw positions (`--aircraft`/`--all`, `--from`, `--to`) |
| `npm run flights:rebuild` | Reconstruct flights from raw positions |
| `npm run flights:list` | Print detected flights (`--public` applies the delay) |
| `npm run imports:list` | Import job status, including days with no data |
| `npm test` | Unit tests |

---

## What the output looks like

```
2026-07-20  OM-BYA  SSG006
  BTS Bratislava 05:58  ->  PRG Prague 06:40
  00:42  346 km
  coverage 100 %  points 529  max gap 20s  confidence HIGH
  route 1.00  dep airport 1.00  arr airport 1.00
```

and, when the data does not support a conclusion, it says so instead of guessing:

```
2026-07-26  OM-BYA  SSG001
  BTS Bratislava 20:12  ->  UNKNOWN 06:48~
  10:37  8,062 km (6986 km bridged across gaps)
  coverage 13 %  points 711  max gap 16885s  confidence LOW
```

---

## Ground rules

1. **Never publish a live position.** Enforced in one place, `src/core/publication.ts`,
   and covered by tests.
2. **Raw observations are append-only.** Every flight, cost and statistic is derived
   and can be rebuilt. Improving the algorithm never means re-downloading data that the
   provider has since deleted.
3. **Nothing is invented.** Unknown means `NULL` and renders as *data unavailable*, not
   as zero and not as a plausible-looking estimate.
4. **Every significant number has a source.** Aircraft identities, cost inputs and
   flight purposes all point at rows in `source`.
5. **No political interpretation.** The project publishes measurements and the
   uncertainty around them. Conclusions are the reader's.

---

## Known limitations

Read these before drawing conclusions from anything this tool prints.

- **The ADS-B history archive is short.** adsb.lol keeps roughly 40–45 days. There is no
  free deep history for the Slovak fleet; the dataset grows forward from the day
  collection starts. See [DATA_SOURCES.md](DATA_SOURCES.md).
- **Zero detected flights is not zero flights.** Days the archive could not serve are
  recorded as `unavailable` and excluded, never counted as quiet days.
  `npm run imports:list` shows them.
- **Coverage over oceans and parts of Asia is poor.** Transatlantic flights routinely
  show 50–60 % coverage, and a track can be lost entirely mid-flight, leaving an
  unidentified destination.
- **Aircraft identities are not yet verified against a primary register.** Every entry
  is `needs_verification`; see [DATA_SOURCES.md](DATA_SOURCES.md).
- **Costs are not implemented yet**, and will stay unavailable until sourced figures
  exist. See [COST_MODEL.md](COST_MODEL.md).

---

## Licence

[AGPL-3.0-or-later](LICENSE). Reference datasets carry their own terms — see
[DATA_SOURCES.md](DATA_SOURCES.md).

Security considerations and the reasoning behind the publication delay are in
[SECURITY.md](SECURITY.md). Corrections are welcome; see
[CONTRIBUTING.md](CONTRIBUTING.md).

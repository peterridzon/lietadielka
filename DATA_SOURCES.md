# Data sources

Everything this project publishes traces back to something on this page.

---

## 1. ADS-B observations

### adsb.lol (primary)

Community ADS-B aggregator. Daily per-aircraft traces in `readsb` format:

```
https://globe.adsb.lol/globe_history/YYYY/MM/DD/traces/{last 2 hex}/trace_full_{icao24}.json
```

- No account or key required.
- **Retention: roughly 40–45 days**, measured 2026-08-21 and 2026-08-22, pruned
  continuously. This is the single biggest constraint on the project.
- **A missing trace and a missing day both return HTTP 504.** The adapter distinguishes
  them with a *day sentinel*: a set of airframes that fly almost daily. If a sentinel
  trace exists for that day, the archive holds the day and our aircraft genuinely was
  not seen; if not, the day is unavailable. Without this, a pruned archive would look
  exactly like an aircraft that never flew.
- Sentinels are configurable via `ADSBLOL_DAY_SENTINELS` and should be re-verified if
  those airframes stop flying regularly.

### OpenSky Network (secondary, requires an account)

`/flights/aircraft` plus `/tracks/all`. Anonymous access to the historical endpoints was
withdrawn in 2025; the adapter needs `OPENSKY_CLIENT_ID` and `OPENSKY_CLIENT_SECRET` and
reports itself unhealthy without them. OpenSky decimates track waypoints, so flights
reconstructed from it carry visibly lower coverage than the same flight from adsb.lol.

### The deep-history problem

There is no free source of ADS-B history for the Slovak fleet going back to 2025. The
realistic options, none of which is implemented:

| Option | Notes |
| ------ | ----- |
| Start collecting now | Free, correct, and slow — the dataset grows forward from today. This is the default. |
| OpenSky historical (Trino / Impala) | Available to researchers on request; years of data, heavy queries. |
| ADSBexchange historical | Commercial. Full daily globe archives. |
| Own receiver | Contributes to the commons, but only covers what it can hear. |

Until one of these is in place, **any statistic before the archive window is missing,
not zero**, and must be labelled as such. `npm run imports:list` reports exactly which
days are absent.

---

## 2. Aircraft identity

Identifying which ICAO 24-bit address belongs to which state aircraft is the weakest
link in the chain, and the seed file is explicit about it.

| Source | Used for | Strength |
| ------ | -------- | -------- |
| [Dopravný úrad / NSAT, civil aircraft register, 07.01.2026](https://letectvo.nsat.sk/letova-sposobilost/register-lietadiel-slovenskej-republiky/zoznam-registra/) | Primary state source for civil registrations | Authoritative, but state aircraft are outside it |
| [Wikipedia (sk) — Letecký útvar MV SR](https://sk.wikipedia.org/wiki/Leteck%C3%BD_%C3%BAtvar_Ministerstva_vn%C3%BAtra_Slovenskej_republiky) | Fleet composition, in-service dates | Tertiary |
| [Wikipedia (en) — Slovak Government Flying Service](https://en.wikipedia.org/wiki/Slovak_Government_Flying_Service) | Same, independent wording | Tertiary |
| [SITA](https://sita.sk/ministerstvo-vnutra-vyraduje-jedno-z-dvoch-lietadiel-fokker-100-bude-na-nahradne-diely/) | Withdrawal of OM-BYC, February 2025 | Media |
| [wiedehopf/tar1090-db](https://github.com/wiedehopf/tar1090-db) | **icao24 ↔ registration mapping** | Community-maintained, not official |

The four government fixed-wing aircraft are seeded as `needs_verification`, not
`verified`, because the hex-to-registration mapping rests on a community database.

**To upgrade an aircraft to `verified`** one of the following is needed:

- the Slovak military/state aircraft register (`maa.mil.sk`), or
- an answer to a freedom-of-information request to MV SR under zákon č. 211/2000 Z. z.
  asking for the ICAO 24-bit addresses of the air unit's aircraft, or
- an official document listing the mapping directly.

### Checked and rejected

The civil register was used as negative evidence, which is worth as much as positive
evidence here. The Sikorsky UH-60/EH-60 Black Hawks registered **OM-BHA, OM-BHB,
OM-BHC, OM-BHD, OM-BHE, OM-BHG and OM-BHK** look like military aircraft and are not:
the register of 07.01.2026 lists them as owned by *Slovak Training Academy, s.r.o.*,
operated by *HELI COMPANY, s.r.o.*, with commercial liens. They are private aircraft and
are out of scope. They are recorded under `rejected` in `data/aircraft.seed.json` so the
assumption is not made again.

**OM-BYW** (AgustaWestland AW189, delivered February 2025) and **OM-BYD** (Bell 429) are
part of the ministry's fleet, but no source we can cite gives their ICAO 24-bit
addresses, so they are listed as candidates and deliberately not seeded.

---

## 3. Airports

[OurAirports](https://ourairports.com/data/), public domain, about 86 000 aerodromes,
downloaded from `davidmegginson.github.io/ourairports-data/airports.csv` and cached in
`data/cache/`. Used only for identifying endpoints and for field elevation.

---

## 4. Costs

None obtained yet. See [COST_MODEL.md](COST_MODEL.md) for the list of sources to pursue
and the reason nothing is estimated in the meantime.

---

## Provenance in the database

Every source above has a row in the `source` table (publisher, title, URL, publication
date, access date, type, notes) and is referenced from the rows that depend on it. The
source types are `government`, `procurement`, `adsb`, `airport`, `manufacturer`,
`media` and `manual`.

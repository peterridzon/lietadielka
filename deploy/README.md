# Nasadenie na WebSupport

## Krátka odpoveď

WebSupport webhosting je **PHP-only**. Node.js tam nebeží a cron spúšťa iba PHP skripty
alebo URL, nie ľubovoľné príkazy. Aplikácia s collectorom tam preto priamo bežať nemôže.

Nevadí to. Pre tento projekt je **statická stránka správna architektúra**, nie ústupok:

> Nikdy nezverejňujeme živú polohu. Let sa objaví až šesť hodín po pristátí. Stránka teda
> nemá jediný dôvod byť dynamická — nič sa na nej nemení medzi dvomi prepočtami.

A má to bezpečnostný dôsledok, ktorý stojí za to povedať nahlas: **databáza sa vôbec
nedostane na internet.** Na hostingu leží len vygenerované HTML a JSON. Nie je čo
napadnúť, nie je odkiaľ vytiahnuť surové ADS-B dáta ani nepublikované lety.

---

## Možnosť A — dnešný náhľad (5 minút)

`preview/state-flights-preview.html` je jediný samostatný súbor. Nahrajte ho cez SFTP do
webového koreňa ako `index.html`:

```bash
npm run deploy:preview
```

Skript potrebuje tri premenné (nikam sa neukladajú, nie sú v repozitári):

```bash
export WS_HOST=vas-server.websupport.sk
export WS_USER=vas-login
export WS_PATH=/vas-login/web            # webový koreň podľa Webadminu
npm run deploy:preview
```

Funguje na najlacnejšom programe. Žiadna databáza, žiadne PHP, žiadna konfigurácia.

---

## Možnosť B — celá aplikácia, staticky (odporúčané)

Pipeline beží **inde** a na WebSupport sa nahráva len výsledok.

```
    kde beží zber                      WebSupport webhosting
 ┌────────────────────────┐           ┌──────────────────────┐
 │ cron 1× denne          │           │  index.html          │
 │  adsb:backfill         │           │  flights/…           │
 │  flights:rebuild       │  rsync    │  api/*.json          │
 │  missions:rebuild      │ ────────► │                      │
 │  costs:recompute       │   SFTP    │  (nič viac)          │
 │  build → statické HTML │           │                      │
 │  PostgreSQL  ← privátna│           │                      │
 └────────────────────────┘           └──────────────────────┘
```

Kde nechať bežať zber:

| | Cena | Poznámka |
| --- | --- | --- |
| **GitHub Actions** | zadarmo pre verejné repo | cron workflow, databáza ako artefakt alebo externý Postgres. Najlacnejšie. |
| **WebSupport VPS** | od pár € / mesiac | self-managed, plná kontrola, Node aj Postgres bez obmedzení |
| **Ľubovoľný malý VPS** | podobne | rovnaké ako vyššie |

Read-only API zo zadania (`/api/flights`, `/api/stats`…) sa vygeneruje ako statické JSON
súbory. Je to read-only a oneskorené, takže sa nič nestráca.

**Pozor na jednu vec:** surové ADS-B pozície rastú donekonečna a WebSupport odporúča
databázu do 2 GB. Preto databáza patrí na stranu zberu, nie na hosting. Na hosting ide len
to, čo sa má zverejniť.

---

## Možnosť C — VPS, celé na jednom mieste

[WebSupport VPS](https://www.websupport.sk/servery/vps/) je self-managed, takže Node aj
PostgreSQL sú bez obmedzení. `docker-compose.yml` v repozitári spustí databázu, zber sa
naplánuje cez systemd timer alebo obyčajný cron.

Viac kontroly, viac prevádzky na starosti. Dáva zmysel, keď bude projekt zbierať dlhšie
a dataset prerastie to, čo sa dá rozumne prenášať.

---

## Čo urobiť predtým, než to pôjde von

Náhľad je označený ako `NÁHĽAD DIZAJNU` a nesie skutočné dáta. Než to pôjde na verejnú
doménu, prejdite si:

- [ ] `PUBLICATION_DELAY_HOURS` nikdy nenastavovať na 0 (viď `SECURITY.md`)
- [ ] identity lietadiel sú stále `needs_verification` — je to na stránke napísané
- [ ] náklady stoja na cenách roku 2020 a nesú nízku kvalitu odhadu — tiež napísané
- [ ] doména a HTTPS certifikát vo Webadmine
- [ ] `robots.txt`, ak nechcete indexáciu skôr, než bude obsah hotový

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

## Odporúčané: GitHub Actions + WebSupport

Zber beží **na GitHube každý deň sám**, váš počítač s tým nemá nič spoločné. Na WebSupport
sa nahráva hotová stránka.

```
   GitHub Actions, 04:17 UTC denne          WebSupport
 ┌──────────────────────────────────┐      ┌──────────────┐
 │ 1. poskladá databázu z gitu      │      │  index.html  │
 │ 2. stiahne nové dni z adsb.lol   │      │              │
 │ 3. prestaví lety, misie, náklady │ FTPS │  a nič viac  │
 │ 4. commitne nové pozorovania     │ ───► │              │
 │ 5. postaví stránku a nahrá ju    │      │              │
 └──────────────────────────────────┘      └──────────────┘
```

**Ako runner prežije reštart.** Nijako — každý beh začína prázdny. Preto sa surové
pozorovania commitujú do repozitára ako `data/observations/<icao24>/<dátum>.ndjson.gz`
a databáza sa z nich pri každom behu poskladá nanovo. Sedí to na architektúru, ktorú
projekt má odjakživa: *surové dáta sa nemažú, všetko ostatné je odvodené a prepočítateľné.*

Overené: zahodenie celej databázy a jej obnova zo súborov dá presne rovnaký výsledok —
21 787 pozícií, 23 letov, 20 misií.

**Veľkosť.** 40 dní a 5 lietadiel = 512 kB. Teda **asi 5 MB za rok**. Git to unesie
desaťročia.

**Vedľajší efekt, ktorý stojí za to.** Surové pozorovania sú tým verejné, verzované
a nezávisle overiteľné. To je silnejšie tvrdenie o transparentnosti než akýkoľvek dashboard —
ktokoľvek si môže stiahnuť tie súbory a prepočítať si všetko po svojom.

### Nastavenie

1. Nahrajte repozitár na GitHub (verejný, nech sú Actions zadarmo).
2. V *Settings → Secrets and variables → Actions* pridajte štyri tajomstvá:

   | | |
   |---|---|
   | `WS_HOST` | FTP server z Webadminu |
   | `WS_USER` | FTP login |
   | `WS_PASSWORD` | FTP heslo |
   | `WS_PATH` | cesta k webovému koreňu, napr. `/login/web` |

3. V *Settings → Actions → General* povoľte **Read and write permissions** (workflow
   commituje nové pozorovania).
4. V záložke *Actions* spustite **Denný zber** ručne cez *Run workflow* a pozrite výstup.

Bez tých tajomstiev workflow len zbiera a commituje — nahrávanie preskočí. Dá sa to teda
najprv rozbehnúť naprázdno a FTP doplniť neskôr.

### Bez WebSupportu vôbec

Ak nechcete riešiť FTP, **GitHub Pages** hostuje statickú stránku zadarmo, s HTTPS a
vlastnou doménou. WebSupport potom slúži len ako registrátor domény, ktorú nasmerujete na
Pages. Žiadne prihlasovacie údaje, žiadny hosting na zaplatenie.

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

## Možnosť B — celá aplikácia, staticky

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
| **GitHub Actions** | zadarmo pre verejné repo | hotové, viď vyššie |
| **WebSupport VPS** | od pár € / mesiac | self-managed, plná kontrola, Node aj Postgres bez obmedzení |
| **Ľubovoľný malý VPS** | podobne | rovnaké ako vyššie |

Read-only API zo zadania (`/api/flights`, `/api/stats`…) sa vygeneruje ako statické JSON
súbory. Je to read-only a oneskorené, takže sa nič nestráca.

**Pozor na jednu vec:** surové ADS-B pozície rastú donekonečna a WebSupport odporúča
databázu do 2 GB. Preto databáza patrí na stranu zberu, nie na hosting. Na hosting ide len
to, čo sa má zverejniť.

---

## Možnosť C — na vašom počítači

`npm run collect:daily` spraví všetko naraz: dozbiera, prestaví, postaví stránku, a s
`-- --upload` ju aj nahrá. Funguje, ale **závisí od toho, že počítač beží**. Archív
adsb.lol drží ~40 dní; keď sa nezbiera dlhšie, tie dni sú nenávratne preč. Týždeň dovolenky
sa dobehne, dva mesiace vypnutý notebook nie.

Dáva zmysel na skúšanie a na jednorazové dozbieranie, nie ako trvalé riešenie.

## Možnosť D — VPS, celé na jednom mieste

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

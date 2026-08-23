# Nasadenie

## Najjednoduchšie: GitHub Pages

Zber aj hosting rieši GitHub. **Žiadne prihlasovacie údaje, žiadny server, zadarmo.**

### Dva príkazy

```bash
gh auth login
```

```bash
npm run publish
```

Skript vytvorí verejný repozitár, nahrá ho, povolí workflow zapisovať, zapne Pages
a raz spustí zber. Predtým vypíše, čo presne pôjde von, a počká na potvrdenie —
zverejnenie sa nedá potichu vrátiť.

Stránka je potom na `https://vas-login.github.io/lietadielka/` a každé ráno o 04:17 UTC
sa sama aktualizuje.

### Alebo ručne, ak nechcete gh

1. Nahrajte repozitár na GitHub ako **verejný**.
2. *Settings → Pages → Source:* **GitHub Actions**.
3. *Settings → Actions → General → Workflow permissions:* **Read and write**.
4. *Actions → Denný zber → Run workflow*.

### Vlastná doména

Ak máte doménu na WebSupporte, nemusíte tam nič hostovať — stačí ju nasmerovať na Pages.
V DNS zázname vo Webadmine:

```
CNAME   lietadla    vas-login.github.io
```

a v *Settings → Pages → Custom domain* zadajte `lietadla.vasadomena.sk`. HTTPS certifikát
vybaví GitHub sám.

---

## Cloudflare Pages

Rovnocenná náhrada GitHub Pages, ak máte radšej ich CDN. Bez Gitu, priamym nahratím:

```bash
npx wrangler login
```

```bash
npm run deploy:cloudflare
```

**Rieši to hosting, nie automatiku.** Na Cloudflare nič nebeží — je to statický súbor.
Denný zber tam spustiť nejde: Workers majú limit CPU, nemajú súborový systém a denný
archív adsb.lol má 3,75 GB. Zber preto ostáva na GitHub Actions alebo na vás.

Kombinácia, ktorá dáva zmysel, ak chcete oboje: **zber na GitHub Actions, stránka na
Cloudflare Pages.** Do workflowu stačí pridať krok s `wrangler pages deploy` a token
`CLOUDFLARE_API_TOKEN` ako secret.

## Ako to funguje

```
   GitHub Actions, 04:17 UTC denne
 ┌────────────────────────────────────────┐
 │ 1. poskladá databázu z gitu            │
 │ 2. stiahne nové dni z adsb.lol         │
 │ 3. prestaví lety, misie, náklady       │
 │ 4. spustí testy                        │
 │ 5. commitne nové pozorovania           │
 │ 6. vypublikuje stránku na Pages        │
 └────────────────────────────────────────┘
```

Krok 4 je zámerný: **keď testy neprejdú, nič sa nezverejní.**

### Prečo sa surové dáta commitujú

Runner začína pri každom behu prázdny, takže databáza musí niekde prežiť. Namiesto
externého Postgresu a ďalšieho tajomstva sa surové pozorovania ukladajú do repozitára ako
`data/observations/<icao24>/<dátum>.ndjson.gz` a databáza sa z nich zakaždým poskladá.

Sedí to na architektúru, ktorú projekt má odjakživa: *surové dáta sa nemažú, všetko
ostatné je odvodené a prepočítateľné.* Overené — zahodenie celej databázy a obnova zo
súborov dá presne rovnaký výsledok: 21 787 pozícií, 23 letov, 20 misií.

Veľkosť: 40 dní a 5 lietadiel = 512 kB, teda **asi 5 MB za rok**.

Vedľajší efekt, ktorý sa hodí: surové pozorovania sú tým verejné, verzované a nezávisle
overiteľné. Ktokoľvek si ich stiahne a prepočíta všetko po svojom, bez toho, aby nám
musel veriť.

### Prečo to nemôže bežať na vašom počítači

Archív adsb.lol drží asi **40 dní**. Keď sa dlhšie nezbiera, tie dni sú **nenávratne preč** —
nedajú sa dostiahnuť neskôr. Týždeň dovolenky sa dobehne, dva mesiace vypnutý notebook nie.

### Prečo to nemôže bežať na WebSupport webhostingu

[Webhosting](https://www.websupport.sk/webhosting/specifikacia/) je PHP 8.2–8.5, **žiadny
Node.js**. [Cron](https://www.websupport.sk/podpora/kb/cron-ulohy/) spúšťa len PHP skripty
alebo URL, nie ľubovoľné príkazy.

Nevadí to. Nikdy nezverejňujeme živú polohu — let sa objaví až šesť hodín po pristátí —
takže stránka nemá dôvod byť dynamická. A má to bezpečnostný dôsledok, ktorý stojí za to
povedať nahlas: **databáza sa vôbec nedostane na internet.** Von ide len vygenerované HTML.

---

## Ak to predsa chcete na WebSupporte

Workflow `.github/workflows/websupport.yml` nahrá stránku cez FTPS po každom úspešnom
zbere. Pridajte štyri secrets v *Settings → Secrets and variables → Actions*:

| | |
|---|---|
| `WS_HOST` | FTP server z Webadminu |
| `WS_USER` | FTP login |
| `WS_PASSWORD` | FTP heslo |
| `WS_PATH` | cesta k webovému koreňu, napr. `/login/web` |

Bez nich sa workflow ticho preskočí.

Jednorazovo a ručne:

```bash
export WS_HOST=... WS_USER=... WS_PATH=/login/web
npm run deploy:preview
```

---

## Na skúšanie lokálne

```bash
npm run collect:daily
```

Spraví celý cyklus naraz. S `-- --upload` aj nahrá. Na trvalý zber sa nespoliehajte —
viď vyššie.

---

## Než to pôjde na verejnú doménu

- [ ] `PUBLICATION_DELAY_HOURS` nikdy nenastavovať na 0 (viď `SECURITY.md`)
- [ ] identity lietadiel sú stále `needs_verification` — je to na stránke napísané
- [ ] náklady stoja na cenách roku 2020 a nesú nízku kvalitu odhadu — tiež napísané
- [ ] `robots.txt`, ak nechcete indexáciu skôr, než bude obsah hotový

# Nasadenie

```
   Claude/Codex          GitHub                      Cloudflare
   ────────────          ──────                      ──────────
   píše kód       →      repozitár                →  Pages
                         + Actions 04:17 UTC          + lietadielka.com
                         (zber, prepočet, build)      (hosting, CDN, HTTPS)
```

Na vašom počítači nebeží nič. Zber, prepočet aj vygenerovanie stránky robí GitHub
Actions každé ráno a commituje výsledok do repozitára. Cloudflare Pages ten repozitár
sleduje a nasadí každú zmenu sám.

Žiadne tokeny, žiadne secrety, žiadny server.

---

## 1. GitHub — hotové

Repozitár je na <https://github.com/peterridzon/lietadielka>, workflow **Denný zber**
beží denne o 04:17 UTC a má právo commitovať späť.

Založené príkazom `npm run publish`, ak by bolo treba znova inde.

## 2. Cloudflare Pages

Bez tokenu a bez terminálu, všetko v prehliadači.

1. <https://dash.cloudflare.com> → **Workers & Pages** → *Create* → záložka **Pages**
   → **Connect to Git**
2. Povoľte Cloudflare prístup k účtu `peterridzon` a vyberte repozitár **lietadielka**
3. Nastavenie buildu:

   | pole | hodnota |
   |---|---|
   | Production branch | `main` |
   | Framework preset | None |
   | Build command | *(nechať prázdne)* |
   | Build output directory | `public` |

4. **Save and Deploy**

Build command je zámerne prázdny. Stránku generuje GitHub Actions a commituje ju do
`public/index.html`; Cloudflare ju už len rozdistribuuje. Nič sa u nich nepočíta,
takže nasadenie trvá sekundy a nemôže spadnúť na závislostiach.

O minútu je stránka na `https://lietadielka.pages.dev`.

## 3. lietadielka.com

Doména je registrovaná na Cloudflare a beží na ich nameserveroch, takže netreba
prepínať nič a DNS sa nastaví samo.

*Workers & Pages* → **lietadielka** → *Custom domains* → *Set up a custom domain* →
`lietadielka.com`. DNS záznam aj HTTPS certifikát vybaví Cloudflare, do pár minút.

Rovnako pridajte `www.lietadielka.com`, ak ho chcete.

---

## Čo sa deje každý deň

```
   GitHub Actions, 04:17 UTC
 ┌──────────────────────────────────────────────┐
 │ 1. poskladá databázu z gitu                  │
 │ 2. stiahne nové dni z adsb.lol               │
 │ 3. prepočíta lety, misie, náklady            │
 │ 4. testy — pri chybe sa nepublikuje          │
 │ 5. vygeneruje stránku do public/             │
 │ 6. commitne pozorovania aj stránku           │
 └──────────────────────────────────────────────┘
                     ↓ push
   Cloudflare Pages nasadí public/
```

Surové pozorovania v `data/observations/` sú jediný stav, ktorý sa musí uchovať.
Lety, misie aj náklady sa z nich dajú kedykoľvek prepočítať nanovo, preto ich workflow
commituje späť: databáza je odvodená, git je pamäť.

`public/index.html` je tiež odvodený a napriek tomu je v gite — je to spôsob nasadenia,
a pri projekte o overiteľnosti nie je na škodu mať v histórii presne to, čo bolo kedy
zverejnené.

Publikačné oneskorenie (`PUBLICATION_DELAY_HOURS`, štandardne 6) platí na úrovni
dopytu, nie exportu — stránka fyzicky nemôže obsahovať prebiehajúci let.

## Ručné nasadenie

Ak by ste chceli stránku nahrať mimo tejto linky:

```bash
npm run deploy:cloudflare
```

Nahrá aktuálnu stránku priamym uploadom (`wrangler`, vyžaduje prihlásenie).
`deploy/upload.sh` vie to isté cez FTPS kamkoľvek inam, ak nastavíte `FTP_HOST`,
`FTP_USER`, `FTP_PASS`, `FTP_DIR`.

Zber musí tak či tak bežať na GitHub Actions — denný archív adsb.lol má 3,75 GB
a Cloudflare Workers ani bežný webhosting ho nespracujú.

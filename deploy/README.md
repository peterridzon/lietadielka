# Nasadenie

```
   Claude/Codex          GitHub                    Cloudflare
   ────────────          ──────                    ──────────
   píše kód       →      repozitár           →     Pages
                         + Actions 04:17 UTC       + lietadielka.com
                         (zber, prepočet, build)   (hosting, CDN, HTTPS)
```

Na vašom počítači nemusí bežať nič. Zber dát aj prepočet nákladov robí GitHub Actions
každé ráno, hotovú stránku pošle na Cloudflare Pages.

Zatiaľ na GitHube nie je nič — nasledujúce kroky ho založia.

---

## 1. Prihlásenie do GitHubu

Cursor nedokáže zobraziť interaktívne prihlásenie, preto cez token.

Otvorte <https://github.com/settings/tokens/new>, zaškrtnite **`repo`** a **`workflow`**,
dole *Generate token*, skopírujte ho. Potom:

```bash
read -rs GH_TOKEN && echo "$GH_TOKEN" | gh auth login --with-token && gh auth status
```

Token sa vloží naslepo (nebude ho vidieť), potvrďte Enterom.

Ak to nepomôže, spustite `gh auth login` v **Terminal.app** — tam interaktívne
prihlásenie cez prehliadač funguje. Stačí raz, prihlásenie si uloží kľúčenka.

## 2. Cloudflare Pages

Prihlásenie a založenie projektu:

```bash
npx -y wrangler@latest pages project create lietadielka --production-branch main
```

Prehliadač si vyžiada povolenie. Projekt je tým založený a prázdny.

Ďalej treba dva údaje pre GitHub Actions:

- **Account ID** — Cloudflare dashboard, *Workers & Pages*, vpravo *Account ID*.
- **API token** — <https://dash.cloudflare.com/profile/api-tokens>, *Create Token*,
  šablóna **Edit Cloudflare Workers**, alebo vlastný s oprávnením
  *Account → Cloudflare Pages → Edit*.

## 3. Zverejnenie

```bash
export CLOUDFLARE_ACCOUNT_ID=...
```

```bash
read -rs CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN
```

```bash
npm run publish
```

Skript vytvorí **verejný** repozitár, nahrá ho, povolí workflowu zapisovať, uloží obidva
Cloudflare secrety a raz spustí zber. Predtým vypíše, čo presne pôjde von, a počká na
potvrdenie — zverejnenie sa nedá potichu vrátiť.

Ak secrety nezadáte, repozitár aj zber vzniknú tak či tak, len sa preskočí publikovanie.
Doplniť sa dajú kedykoľvek:

```bash
gh secret set CLOUDFLARE_API_TOKEN && gh secret set CLOUDFLARE_ACCOUNT_ID
```

## 4. lietadielka.com

Doména je registrovaná na Cloudflare a beží na ich nameserveroch, takže netreba nič
prepínať ani nastavovať DNS ručne.

Cloudflare dashboard → *Workers & Pages* → **lietadielka** → *Custom domains* →
*Set up a custom domain* → `lietadielka.com`. DNS záznam aj HTTPS certifikát vybaví
Cloudflare sám, do pár minút.

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
 │ 5. vygeneruje stránku                        │
 │ 6. commitne nové pozorovania späť do gitu    │
 │ 7. pošle stránku na Cloudflare Pages         │
 └──────────────────────────────────────────────┘
```

Surové pozorovania v `data/observations/` sú jediný stav, ktorý sa musí uchovať.
Všetko ostatné — lety, misie, náklady — sa z nich dá kedykoľvek prepočítať nanovo.
Preto ich workflow commituje späť do repozitára: databáza je odvodená, git je pamäť.

Publikačné oneskorenie (`PUBLICATION_DELAY_HOURS`, štandardne 6) platí na úrovni
dopytu, nie exportu — stránka fyzicky nemôže obsahovať prebiehajúci let.

## Ručné publikovanie

Bez GitHubu, priamo z počítača na Cloudflare:

```bash
npm run deploy:cloudflare
```

Nahrá aktuálnu stránku. Automatiku to nerieši, len hosting.

## Iný hosting

`deploy/upload.sh` nahrá stránku cez FTPS kamkoľvek (napr. WebSupport), ak
nastavíte `FTP_HOST`, `FTP_USER`, `FTP_PASS`, `FTP_DIR`. Zber aj tak musí bežať
inde — Cloudflare Workers ani bežný webhosting ho nezvládnu: denný archív adsb.lol
má 3,75 GB a Workers nemajú súborový systém.

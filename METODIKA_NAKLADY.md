# Metodika výpočtu nákladov štátnych letov

Text pre verejnú stránku `/methodology`. Anglická technická verzia je v
[COST_ENGINE.md](COST_ENGINE.md), metodika detekcie letov v [METHODOLOGY.md](METHODOLOGY.md).

> Z bezpečnostných dôvodov nezverejňujeme polohu štátnych lietadiel v reálnom čase. Lety
> publikujeme až po ich ukončení s časovým odstupom. Projekt slúži výhradne na analýzu
> využívania verejného majetku a verejných financií.

---

Cieľom projektu je transparentne ukázať využívanie štátnych lietadiel Slovenskej republiky
a čo najpresnejšie odhadnúť náklady spojené s ich prevádzkou.

Projekt nepovažuje odhad za účtovnú faktúru a neprezentuje modelované hodnoty ako presné
účtovné náklady, pokiaľ k nim neexistuje verejne dostupný oficiálny doklad. Každý výpočet
preto obsahuje informáciu o zdrojoch, použitom modeli a kvalite odhadu.

**Cieľom nie je dokázať, že vládne lietadlá sú drahé.** Ak model ukáže, že komerčná
doprava by bola lacnejšia, zobrazíme to. Ak ukáže, že štátne lietadlo je pri danej misii,
počte cestujúcich alebo trase porovnateľné alebo výhodnejšie, zobrazíme to rovnako otvorene.

---

## Priame náklady letu

Priame náklady sú tie, ktoré vznikajú najmä v dôsledku uskutočnenia konkrétneho letu:
palivo, navigačné poplatky, letiskové poplatky, handling, údržba viazaná na letové hodiny
a na cykly a ďalšie služby priamo súvisiace s letom.

Označujeme ich ako **odhadované priame prevádzkové náklady**. Približne odpovedajú na
otázku: *koľko by štát ušetril na variabilných nákladoch, keby sa konkrétny let neuskutočnil?*

Táto vrstva má na Slovensku oporu v oficiálnom údaji. Podľa materiálu
[„Informácia o využívaní služieb Leteckého útvaru Ministerstva vnútra SR"](https://rokovania.gov.sk/download.dat?id=0911134E5672416C9CC925B732084BF0-9124DD7BD0C50122112225CE50FA4467)
predstavovali priame prevádzkové náklady letúnov v priemere **4 079 € na letovú hodinu**
za roky 2018 – 2019 a **3 802 € na letovú hodinu** ako dlhodobý priemer vrátane roku 2020.
Rozptyl na najvyužívanejších letiskách bol **2 359,55 € až 5 300,75 € na hodinu**.

Ten istý materiál uvádza, že letecký útvar smie iným užívateľom re-fakturovať výhradne
priame prevádzkové náklady. Prezident, predseda Národnej rady a predseda vlády lietajú
bezodplatne. Preto oficiálny údaj o priamych nákladoch vôbec existuje.

## Fixné náklady

Štátna letecká flotila stojí peniaze aj vtedy, keď lietadlá nelietajú: poistenie, platy
posádok, výcvik, údržbové kontrakty, technická základňa, hangárovanie, administratíva,
software a navigačné databázy, zásoby náhradných dielov, pokračujúca letová spôsobilosť,
kapitálové náklady a odpisy.

Tieto náklady rozpočítavame na letové hodiny podľa dostupných údajov o ročnom využití.
Výsledok označujeme ako **alokované fixné náklady**.

## Celkové náklady daňovníka

```
Celkové náklady daňovníka = priame náklady letu + alokovaná časť fixných nákladov
```

Táto hodnota približuje ekonomický náklad existencie a prevádzky štátnej leteckej kapacity.
**Nie je** totožná s tým, koľko by štát okamžite ušetril zrušením jedného konkrétneho letu.
Preto obe čísla zobrazujeme samostatne a nikdy ich nezlučujeme do jedného.

## Prečo na menovateli záleží viac než na čomkoľvek inom

Fixné náklady na hodinu sú podiel. Ročné fixné náklady 7 000 000 € delené 700 hodinami dajú
10 000 € na hodinu; delené 1 400 hodinami dajú 5 000 €. Rovnaké peniaze, dvojnásobný rozdiel.

Pri slovenskej flotile máme dva oficiálne údaje: v roku **2019 bolo na letúnoch vykonaných
1 400 letových hodín**, a **minimálny nálet na udržanie spôsobilosti je 600 hodín**. Podiel
medzi nimi je 2,3-násobok. Preto voľbu menovateľa nezametáme pod koberec — **stáva sa priamo
intervalom** zverejneného odhadu fixných nákladov.

Poradie preferencie menovateľa:

1. oficiálny údaj o nalietaných hodinách,
2. kompletne rekonštruovaný ADS-B dataset s vysokým pokrytím,
3. ADS-B odhad upravený o pokrytie (`detegované hodiny ÷ odhadované pokrytie`),
4. benchmark.

Neúplný ADS-B dataset nesmie viesť k umelému nadhodnoteniu fixných nákladov na hodinu —
podhodnotený menovateľ by presne to spôsobil. Možnosti 3 a 4 preto automaticky znižujú
kvalitu odhadu.

## Prečo zobrazujeme interval

Nie všetky vstupy sú verejne známe. Ak vstup nie je dostatočne presný, zobrazujeme interval

```
11 900 – 13 800 €
```

namiesto falošne presného `12 347,29 €`. Zaokrúhľujeme na presnosť, akú vstupy unesú.

## Hierarchia zdrojov

Pri výpočtoch preferujeme zdroje v tomto poradí:

| | |
|---|---|
| A1 | skutočné faktúry a zaplatené sumy |
| A2 | oficiálne údaje o výdavkoch |
| A3 | zmluvy v Centrálnom registri zmlúv a dokumenty ÚVO |
| A4 | oficiálne materiály štátnych orgánov |
| A5 | oficiálne sadzobníky letísk a EUROCONTROL |
| B1 | údaje výrobcu |
| B2 | údaje certifikovaného prevádzkovateľa |
| C | odborné priemyselné benchmarky |
| D | analytický odhad |

## Rámcové zmluvy

Maximálna hodnota rámcovej zmluvy **neznamená**, že bola celá suma minutá. Ak je verejne
dostupná iba maximálna hodnota rámca, používame ju ako horný limit a jasne ju označujeme.
Skutočná faktúra alebo reálne čerpanie má vždy vyššiu dôveryhodnosť. Systém odmietne zapísať
rámcový strop ako skutočný výdavok.

## Čo odhad nezahŕňa

Ak model niektoré kategórie neobsahuje, vypíšeme ich. Dnes to je väčšina fixnej vrstvy:
mzdové náklady, kapitálové náklady a odpisy, poistenie, výcvik, hangárovanie,
administratíva a software. Oficiálny rozpočtový údaj, z ktorého vychádzame, mzdové náklady
výslovne vylučuje.

**Chýbajúca položka nikdy nie je nula.** Nula znamená, že náklad naozaj nevznikol —
napríklad navigačné poplatky odpustené podľa nariadenia Komisie (EÚ) 2019/317, čl. 31 ods. 3
pri letoch s prezidentom, predsedom vlády alebo ministrom na palube.

## Cenová úroveň vstupov

Primárny výpočet používa nominálne ceny platné v čase, z ktorého vstupy pochádzajú.
Slovenské oficiálne sadzby sú v cenách roku 2020. Pri lete z roku 2026 to znamená šesťročný
odstup, ktorý neupravujeme o infláciu — ale vždy ho uvádzame a znižuje kvalitu odhadu.

Let nesmie byť ocenený modelom, ktorý v jeho čase neplatil. Ak taký model neexistuje,
použije sa najbližší starší a výsledok dostane výslovné upozornenie.

## Porovnanie s komerčnou dopravou

Štátny let neporovnávame s najlacnejšou internetovou letenkou. Pri vládnych pracovných
cestách môžu byť potrebné konkrétne časy, krátka lehota rezervácie, flexibilita, batožina,
business tarifa, viac destinácií alebo bezpečnostné a diplomatické požiadavky. Preto
používame viac scenárov: low-cost economy, flexibilná economy a business/flex.

Výsledok označujeme ako **odhadované finančné porovnanie**.

Aktuálna cena letenky nie je historická cena letenky, a rozdiel medzi nimi zaznamenávame.

> **Stav:** zatiaľ nemáme žiadny zdrojovaný údaj o porovnateľných tarifách, takže komerčné
> porovnanie sa nezobrazuje. Rozhranie je pripravené, čísla chýbajú.

## Bod ekonomického vyrovnania

```
break-even cestujúci = náklady štátneho letu ÷ porovnateľná cena letenky na osobu
```

Zobrazujeme dva body — podľa priamych a podľa celkových nákladov. Odpovedajú na rozdielne
otázky: prvý na ekonomiku jedného dodatočného letu, druhý na ekonomiku udržiavania celej
štátnej leteckej kapacity.

## Počet cestujúcich

Ak počet cestujúcich nie je verejne známy, nevymýšľame ho. V takom prípade **nezobrazujeme**
náklady na jedného cestujúceho, konkrétny rozdiel oproti komerčnej ceste ani tvrdenie o
úspore či predražení. Zobrazíme citlivostnú analýzu pre rôzne počty cestujúcich a necháme
čitateľa, aby si doplnil to, čo vie.

## Nefinančné dôvody použitia štátneho lietadla

Finančné porovnanie nie je jediné kritérium. Relevantné môžu byť bezpečnosť, diplomatický
protokol, časový harmonogram, viac destinácií, mimoriadna udalosť, repatriácia, zdravotná
alebo humanitárna misia, vojenské požiadavky alebo absencia rozumného komerčného spojenia.

Projekt neposudzuje politickú ani bezpečnostnú oprávnenosť letu. Zobrazuje dostupné dáta a
finančnú analytiku.

## Kvalita odhadu

| | |
|---|---|
| **Vysoká** | väčšina hodnoty z aktuálnych oficiálnych zdrojov (A1 – A4), nízky podiel neznámych položiek |
| **Stredná** | kombinácia oficiálnych údajov a modelovaných položiek |
| **Nízka** | významná časť výpočtu stojí na benchmarkoch, odvodených alokáciách alebo zastaraných cenách |

Ak sa modelovaný ročný náklad líši od oficiálneho o viac než 20 %, výpočet dostane
validačné upozornenie a nemôže mať vysokú kvalitu.

## Auditovateľnosť

Pri každom významnom čísle je dostupný vzorec, vstupné hodnoty, zdroj každej hodnoty,
obdobie platnosti, kvalita odhadu, chýbajúce položky a verzia cost modelu. Z príkazového
riadku:

```
npm run costs:explain -- --flight 2026-07-20-om-bya-lzib-lkpr
```

## Aktualizácie metodiky

Cost model je verzionovaný (napr. `LU-MVSR-FW-DIRECT-2021-v1`). Ak sa metodika zlepší,
historické výsledky sa prepočítajú novou verziou a staré výpočty zostanú zachované pre audit.
Prepočet nikdy nemaže — iba pridáva a prepína, ktorý výpočet je aktuálny.

# Design preview

A static page built from the pipeline's own database, used to agree the visual direction
before Phase 10 (the Next.js application) is written. It is **not** the application.

- `state-flights-preview.html` — the published page, self-contained.
- `build.py` — assembles it from `src/`.
- `src/export.json` — a snapshot of real detected flights, exported from the database.
- `src/land-simple.json`, `src/borders-simple.json` — Natural Earth 110m coastlines and
  boundary lines, simplified for inline embedding. Public domain.

Every figure on the page comes from the database. Nothing is mocked, and figures we do
not have — costs above all — are shown as unavailable rather than filled in.

To regenerate after new imports, re-run the export query and then `python3 build.py`.

## Fotografie lietadiel

Fotky v `src/photos/` pochádzajú z Wikimedia Commons a sú použité pod voľnou licenciou.
Autor, licencia a odkaz na zdrojovú stránku sú v `src/photos/credits.json` a zobrazujú sa
pri každej fotografii na stránke. Fotku bez voľnej licencie do tohto projektu nedávaj —
snímky z planespotters, JetPhotos a podobných služieb sú autorsky chránené.

| Lietadlo | Autor | Licencia |
| -------- | ----- | -------- |
| OM-BYA | N509FZ | CC BY-SA 4.0 |
| OM-BYK | ERIC SALARD | CC BY-SA 4.0 |
| OM-BYB | Juke Schweizer | CC BY-SA 4.0 |
| OM-BYC | jounigripen | CC BY 2.0 |

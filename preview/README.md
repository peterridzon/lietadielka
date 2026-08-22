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

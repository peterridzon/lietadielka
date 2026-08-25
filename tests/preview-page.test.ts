/**
 * Smoke test for the published design preview.
 *
 * The page is a single self-contained file that renders everything from embedded JSON,
 * so a mistake in that script produces a blank section rather than a crash anyone would
 * notice. It is also too large for the interactive preview pane, which is precisely why
 * it needs a test rather than a look.
 */
import { existsSync, readFileSync } from 'node:fs'
import { JSDOM, VirtualConsole } from 'jsdom'
import { beforeAll, describe, expect, it } from 'vitest'

const PAGE = 'preview/state-flights-preview.html'

let dom: JSDOM
let errors: string[]

beforeAll(async () => {
  if (!existsSync(PAGE)) throw new Error(`${PAGE} is missing — run "python3 preview/build.py"`)

  errors = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', (error: Error) => errors.push(error.message))
  virtualConsole.on('error', (message: unknown) => errors.push(String(message)))

  dom = new JSDOM(readFileSync(PAGE, 'utf8'), {
    runScripts: 'dangerously',
    // Google Fonts and the like are irrelevant here and would only add flakiness.
    resources: undefined,
    virtualConsole,
    url: 'https://example.invalid/',
  })
  await new Promise((resolve) => setTimeout(resolve, 50))
})

const $ = (selector: string): Element | null => dom.window.document.querySelector(selector)
const $$ = (selector: string): Element[] => [...dom.window.document.querySelectorAll(selector)]

/**
 * A fragment is not a document. Without a charset declaration the browser falls back to
 * its locale default and renders every diacritic as mojibake — which is exactly what
 * happened once the page was served over HTTP rather than opened from disk. The bytes
 * were always correct; nothing told the parser how to read them.
 */
/**
 * The record reaches back in batches over days. While it is still filling, the page has
 * to say so: an unread January and a quiet one look identical on the calendar, and every
 * total below describes only the part that has been read.
 */
describe('backfill progress', () => {
  it('shows how much of the target period has been read', () => {
    const box = $('#backfill') as HTMLElement
    const note = $('#bf-note')?.textContent ?? ''
    const [, done, total] = note.match(/(\d[\d\s ]*) z (\d[\d\s ]*)/) ?? []
    const n = (v?: string) => Number((v ?? '').replace(/\s/g, ''))

    if (box.hidden) {
      // Hidden means finished, which the numbers have to agree with.
      expect(note === '' || n(done) >= n(total)).toBe(true)
      return
    }
    expect(n(done)).toBeGreaterThan(0)
    expect(n(done)).toBeLessThan(n(total))
    // The bar must not claim more than the sentence does.
    const width = Number((($('#bf-fill') as HTMLElement).style.width || '0').replace('%', ''))
    expect(width).toBeLessThanOrEqual(Math.round((n(done) / n(total)) * 100) + 1)
    expect(note).toContain('opisujú len prečítané obdobie')
  })

  it('sits directly under the masthead, before any of the numbers', () => {
    expect($('header.masthead')?.nextElementSibling?.id).toBe('backfill')
  })
})

describe('document envelope', () => {
  it('declares UTF-8 within the first 1024 bytes', () => {
    const head = readFileSync(PAGE).subarray(0, 1024).toString('latin1')
    expect(head).toMatch(/<meta\s+charset="utf-8">/i)
  })

  it('is a complete HTML document in Slovak', () => {
    const raw = readFileSync(PAGE, 'utf8')
    expect(raw.startsWith('<!doctype html>')).toBe(true)
    expect(raw).toContain('<html lang="sk">')
    expect(raw.trimEnd().endsWith('</html>')).toBe(true)
    for (const tag of ['<head>', '</head>', '<body>', '</body>']) {
      expect(raw.split(tag).length - 1, `${tag} must appear exactly once`).toBe(1)
    }
  })

  it('round-trips as UTF-8 with the diacritics intact', () => {
    const raw = readFileSync(PAGE, 'utf8')
    expect(raw).toContain('Štátne lety')
    expect(raw).not.toContain('\uFFFD')
  })
})

describe('design preview', () => {
  it('runs its script without throwing', () => {
    expect(errors).toEqual([])
  })

  it('renders the headline figures', () => {
    const kpis = $$('.kpi')
    expect(kpis.length).toBe(4)
    for (const kpi of kpis) expect(kpi.textContent?.trim().length).toBeGreaterThan(0)
  })

  it('draws the overview map without waiting for a click', () => {
    const svg = $('#overview svg')
    expect(svg).not.toBeNull()
    expect(svg!.querySelectorAll('line').length).toBeGreaterThan(20)
  })

  it('renders one strip per flight and opens the first', () => {
    const strips = $$('.strip')
    expect(strips.length).toBeGreaterThan(0)
    expect(strips[0]!.getAttribute('open-state')).toBe('1')
    expect(strips[0]!.querySelector('.detail-map svg')).not.toBeNull()
  })

  it('shows direct, fixed and full cost as separate layers', () => {
    const layers = $$('.cost-layer')
    expect(layers.length).toBe(3)
    const total = $('.cost-layer.total')
    expect(total?.textContent).toContain('Celkové náklady daňovníka')
  })

  it('offers the calculation trace', () => {
    const howto = $('details.howto')
    expect(howto?.querySelector('summary')?.textContent).toBe('Ako sme toto vypočítali?')
    expect(howto!.querySelectorAll('.tstep').length).toBeGreaterThan(2)
  })

  it('states what the cost estimate does not include', () => {
    expect($('.cost-missing')?.textContent).toContain('Odhad nezahŕňa')
  })

  it('never prints a cost without its quality', () => {
    for (const meta of $$('.cost-meta')) {
      expect(meta.textContent).toMatch(/Kvalita odhadu|Cost model|cenová úroveň/i)
    }
  })

  it('lists missions with their legs', () => {
    // One header row plus at least one mission.
    expect($$('.mrow').length).toBeGreaterThan(1)
  })

  it('lays the coverage record out as week columns, seven days to a column', () => {
    const years = $$('.cov-year')
    expect(years.length).toBeGreaterThan(0)
    for (const y of years) {
      // The year heading is noise when the record sits inside one year, so it appears
      // only once there is more than one panel to tell apart.
      const heading = y.querySelector('h3')
      if (years.length > 1) expect(heading?.textContent).toMatch(/^\d{4}$/)
      else expect(heading).toBeNull()
      // Every cell sits on one of the seven weekday rows; anything else means the grid
      // has drifted out of alignment and the columns no longer read as weeks.
      const rows = new Set(
        [...y.querySelectorAll('.cov-day')].map((d) => (d as HTMLElement).style.gridRow),
      )
      for (const r of rows) expect(Number(r)).toBeGreaterThanOrEqual(2)
      expect(rows.size).toBeLessThanOrEqual(7)
    }
  })

  it('gives every day a state, and lets none outside the record be clicked', () => {
    // Which states occur depends on the data, and that changes as the archive fills —
    // the archive has no unavailable days at all. Asserting that today's mix is present
    // would make this test fail on a better record, so it asserts the rules instead.
    const known = new Set(['flew', 'quiet', 'partial', 'nodata', 'pending', 'outside'])
    const cells = $$('.cov-day')
    expect(cells.length).toBeGreaterThan(0)

    let flown = 0
    for (const cell of cells) {
      const state = cell.getAttribute('data-state') ?? ''
      expect(known.has(state), `unknown state ${state}`).toBe(true)
      if (state === 'flew') flown++
      if (state === 'outside') {
        expect((cell as HTMLButtonElement).disabled, 'padding must not be clickable').toBe(true)
      } else {
        expect((cell as HTMLButtonElement).disabled).toBe(false)
        expect(cell.getAttribute('aria-pressed')).toBeTruthy()
      }
    }
    expect(flown, 'a record with no flights would mean the pipeline found nothing').toBeGreaterThan(0)
  })

  it('sizes itself by week count instead of fixed pixels', () => {
    for (const grid of $$('.cov-grid')) {
      const weeks = Number((grid as HTMLElement).style.getPropertyValue('--weeks'))
      expect(weeks).toBeGreaterThan(0)

      // A year panel can start or end mid-week — the record began on a Thursday, so the
      // 2025 panel holds three days — which makes "seven cells per week" false. What must
      // hold is that the declared width matches the columns actually used, or the grid
      // reserves space it never fills.
      const cells = [...grid.querySelectorAll('.cov-day')] as HTMLElement[]
      const columns = new Set(cells.map((c) => c.style.gridColumn))
      expect(columns.size).toBe(weeks)
      // Column 1 carries the weekday labels and row 1 the month labels, so days occupy
      // columns 2..weeks+1 and rows 2..8.
      for (const cell of cells) {
        const column = Number(cell.style.gridColumn)
        const row = Number(cell.style.gridRow)
        expect(column).toBeGreaterThanOrEqual(2)
        expect(column).toBeLessThanOrEqual(weeks + 1)
        expect(row).toBeGreaterThanOrEqual(2)
        expect(row).toBeLessThanOrEqual(8)
      }
      // No column may hold two of the same weekday, which is what a numbering slip does.
      const seen = new Set<string>()
      for (const cell of cells) {
        const key = `${cell.style.gridColumn}:${cell.style.gridRow}`
        expect(seen.has(key), `two days share ${key}`).toBe(false)
        seen.add(key)
      }
    }
  })

  it('counts each day state beside the grid, matching the cells', () => {
    const cells = $$('.cov-day').map((d) => d.getAttribute('data-state'))
    const stats = $$('.cov-stat')
    expect(stats.length).toBeGreaterThan(0)
    for (const stat of stats) {
      const state = stat.querySelector('i')?.getAttribute('data-state')
      const shown = Number(stat.querySelector('dd')?.textContent?.replace(/\s/g, ''))
      expect(shown, `${state} count`).toBe(cells.filter((c) => c === state).length)
    }
  })

  it('marks the chosen day without hiding the rest of the list', () => {
    ;($('#cov-clear') as HTMLButtonElement).click()
    const flown = $$('.cov-day[data-state="flew"]')[0] as HTMLButtonElement
    const day = flown.getAttribute('data-day')
    const total = $$('.strip').length
    flown.click()

    expect(flown.getAttribute('aria-pressed')).toBe('true')
    // Narrowing the list to one day left the page showing a single flight and hiding
    // every other one. A list of flights has to stay a list of flights.
    const visible = $$('.strip').filter((s) => (s as HTMLElement).style.display !== 'none')
    expect(visible.length).toBe(total)

    const picked = $$('.strip.picked')
    expect(picked.length).toBeGreaterThan(0)
    for (const s of picked) expect(s.getAttribute('data-day')).toBe(day)

    ;($('#cov-clear') as HTMLButtonElement).click()
    expect($$('.strip.picked').length).toBe(0)
  })

  it('says which kind of empty an empty day is', () => {
    const verdict = $('#cov-detail-verdict') as HTMLElement
    const expected: Record<string, RegExp> = {
      nodata: /nezapočítaný ako nula/,
      quiet: /Pokojný deň/,
      partial: /časť nie/i,
      pending: /ešte nebol prečítaný/,
    }

    let checked = 0
    for (const [state, phrase] of Object.entries(expected)) {
      const cell = $$(`.cov-day[data-state="${state}"]`)[0] as HTMLButtonElement | undefined
      if (!cell) continue // that state simply does not occur in the current record
      ;($('#cov-clear') as HTMLButtonElement).click()
      cell.click()
      expect(verdict.textContent, state).toMatch(phrase)
      checked++
    }
    expect(checked, 'no empty day of any kind to check').toBeGreaterThan(0)
    ;($('#cov-clear') as HTMLButtonElement).click()
  })

  it('opens the flight itself, not just the section that holds it', () => {
    ;($('#cov-clear') as HTMLButtonElement).click()
    const flown = $$('.cov-day[data-state="flew"]')[0] as HTMLButtonElement
    const day = flown.getAttribute('data-day')
    flown.click()
    // Landing on the section heading looked like the click had done nothing, because the
    // strips sat below a long paragraph. The strip for that day must be open.
    const strip = $$('.strip').find((s) => s.getAttribute('data-day') === day)
    expect(strip?.getAttribute('open-state')).toBe('1')
    expect(strip?.querySelector('.strip-btn')?.getAttribute('aria-expanded')).toBe('true')
    ;($('#cov-clear') as HTMLButtonElement).click()
  })

  it('breaks the selected day down per aircraft', () => {
    ;($('#cov-clear') as HTMLButtonElement).click()
    const flown = $$('.cov-day[data-state="flew"]')[0] as HTMLButtonElement
    flown.click()
    expect(($('#cov-detail') as Element).getAttribute('data-open')).toBe('1')
    const rows = $$('#cov-detail-rows .cov-row')
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(r.querySelector('.reg')?.textContent).toBeTruthy()
      expect(r.querySelector('.what')?.textContent).toBeTruthy()
    }
    ;($('#cov-clear') as HTMLButtonElement).click()
  })

  it('separates the two operators and never merges them into one fleet', () => {
    const groups = $$('.fleet-group:not(.historical)')
    expect(groups.length).toBe(2)
    const names = groups.map((g) => g.querySelector('h3')?.textContent ?? '')
    expect(names.some((n) => n.includes('Letecký útvar'))).toBe(true)
    expect(names.some((n) => n.includes('Vzdušné sily'))).toBe(true)
  })

  it('does not show a withdrawn aircraft that has nothing to show', () => {
    // OM-BYC left service in February 2025 and has no flights in the period. It stays
    // in the registry, but a card for it would be a database row pretending to be news.
    expect($('#sec-fleet')?.textContent).not.toContain('OM-BYC')
  })

  it('lists exactly the three current Ministry of Interior aircraft', () => {
    const interior = $$('.fleet-group:not(.historical)').find((g) =>
      (g.querySelector('h3')?.textContent ?? '').includes('Letecký útvar'),
    )
    const regs = [...interior!.querySelectorAll('.ac .reg')].map((e) => e.textContent)
    expect(regs.sort()).toEqual(['OM-BYA', 'OM-BYB', 'OM-BYK'])
  })

  it('shows the Air Force Global 5000s by their military evidence numbers', () => {
    const airForce = $$('.fleet-group:not(.historical)').find((g) =>
      (g.querySelector('h3')?.textContent ?? '').includes('Vzdušné sily'),
    )
    const regs = [...airForce!.querySelectorAll('.ac .reg')].map((e) => e.textContent)
    // The two Global 5000, identified by military evidence number rather than a civil mark.
    expect(regs.sort()).toEqual(['9513', '9633'])
    expect(airForce!.textContent).toContain('vojenský register')
  })

  it('credits every aircraft photograph', () => {
    const figures = $$('.ac figure')
    expect(figures.length).toBeGreaterThan(0)
    for (const figure of figures) {
      const caption = figure.querySelector('figcaption')
      expect(caption?.textContent).toMatch(/CC BY/)
      expect(caption?.querySelector('a[href*="commons.wikimedia.org"]')).not.toBeNull()
    }
  })

  it('gives every card the same image band', () => {
    const figures = $$('.ac figure')
    expect(figures.length).toBe(5)
    for (const figure of figures) {
      expect(figure.querySelector('img')?.getAttribute('loading')).toBe('lazy')
    }
    const styles = [...dom.window.document.querySelectorAll('style')].map((s) => s.textContent).join('\n')
    // A fixed module rather than auto-fit: a group of two must not stretch its cards to
    // half the page while a group of three sits at a third.
    expect(styles).toMatch(/\.fleet \{[^}]*repeat\(3, minmax\(0, 1fr\)\)/)
    expect(styles).not.toMatch(/\.fleet \{[^}]*auto-fit/)
    // Every band is 3:2 and the image is fitted into it, so nothing is cut off.
    expect(styles).toMatch(/\.ac img[^}]*aspect-ratio: 3 \/ 2/)
  })

  it('does not clutter the cards with uniform caveats', () => {
    // Every aircraft is unverified and two photographs are illustrative; saying so on
    // each card carries no information. Both facts are stated once in the section intro
    // and in DATA_SOURCES.md instead.
    const fleet = $('#sec-fleet')
    expect(fleet?.textContent).not.toContain('ilustračné')
    expect(fleet?.querySelector('.tag.unverified')).toBeNull()
    expect($$('.ac .photo-detail').length).toBe(0)
  })

  it('never renders an element that is styled as a box but holds nothing', () => {
    for (const selector of ['#fleet-groups', '#missions', '#routes', '#fleet-cost']) {
      const node = $(selector)
      if (node) expect(node.children.length, `${selector} is empty`).toBeGreaterThan(0)
    }
  })

  it('does not crop the aircraft photographs', () => {
    // A fixed aspect box cut the nose off the wider images. The frame follows the image.
    const styles = [...dom.window.document.querySelectorAll('style')].map((s) => s.textContent).join('\n')
    expect(styles).not.toMatch(/\.ac img[^}]*object-fit:\s*cover/)
    expect(styles).toMatch(/\.ac img[^}]*height:\s*auto/)
  })

  it('gets Slovak plurals right', () => {
    // "3 letov" reads as a typo; one takes one form, two to four another, five and up a
    // third. Which counts actually appear depends on the data and changes as the record
    // grows, so this checks every number on the page against the rule rather than
    // expecting particular ones.
    const correct = (n: number, forms: [string, string, string]) =>
      n === 1 ? forms[0] : n >= 2 && n <= 4 ? forms[1] : forms[2]

    const words: [string, string, string][] = [
      ['let', 'lety', 'letov'],
      ['deň', 'dni', 'dní'],
      ['lietadlo', 'lietadlá', 'lietadiel'],
    ]
    // Read text nodes one at a time. Joining the whole body first runs neighbouring
    // elements together — the type "F28 Mark 0100" followed by a count of "2 lety" reads
    // as "1002 lety" — and drags the embedded script's own comments in with it.
    const walker = dom.window.document.createTreeWalker(
      dom.window.document.body,
      dom.window.NodeFilter.SHOW_TEXT,
    )
    const chunks: string[] = []
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const tag = node.parentElement?.tagName
      if (tag === 'SCRIPT' || tag === 'STYLE') continue
      chunks.push((node.textContent ?? '').replace(/[\u00a0\u202f]/g, ' ').trim())
    }
    // Joined by newlines, so a count and its noun in sibling elements still read as one
    // phrase while two unrelated numbers never fuse into a third.
    const text = chunks.filter(Boolean).join('\n')

    let checked = 0
    for (const forms of words) {
      const pattern = new RegExp(`(?:^|[^\\d])(\\d[\\d ]*)\\s(${forms.join('|')})\\b`, 'gm')
      for (const [whole, digits, used] of text.matchAll(pattern)) {
        const n = Number(digits!.replace(/\s/g, ''))
        expect(used, `"${whole.trim()}"`).toBe(correct(n, forms))
        checked++
      }
    }
    expect(checked, 'nothing counted, so nothing was checked').toBeGreaterThan(3)
    expect($('#sec-fleet')?.textContent).toContain('lietadlá v službe')
  })

  it('does not let a photograph identify an aircraft', () => {
    // The registration on every card comes from the registry, never from the image
    // subject. 9513's photograph shows an aircraft marked C-FDIL.
    const regs = $$('.ac .reg').map((e) => e.textContent)
    expect(regs).toContain('9513')
    expect(regs).not.toContain('C-FDIL')
    expect(regs).not.toContain('HB-JFB')
  })

  it('shows the full derivation chain from the source document to the number', () => {
    const steps = $$('ol.chain li')
    // Rate, block time, direct, annual fixed, fleet share, per hour, per flight, total.
    expect(steps.length).toBeGreaterThanOrEqual(7)
    for (const step of steps) {
      expect(step.querySelector('.badge')).not.toBeNull()
      expect(step.querySelector('.cmath')?.textContent?.trim().length).toBeGreaterThan(0)
    }
  })

  it('separates what is quoted from what we derived', () => {
    expect($$('ol.chain .badge.sourced').length).toBeGreaterThan(0)
    expect($$('ol.chain .badge.derived').length).toBeGreaterThan(0)
  })

  it('links the primary source and quotes its figures', () => {
    const link = $('#method-source a[href*="rokovania.gov.sk"]')
    expect(link).not.toBeNull()
    const quotes = $$('.quotes .quote')
    expect(quotes.length).toBeGreaterThanOrEqual(4)
    expect($('.msrc-check')?.textContent).toContain('768 004')
  })

  it('marks where our inputs sit in the source hierarchy', () => {
    const here = $('table.tiers tr.here')
    expect(here?.textContent).toContain('A4')
  })

  it('tells the reader how to check it themselves', () => {
    const steps = $$('.verify-steps li')
    expect(steps.length).toBeGreaterThanOrEqual(3)
    expect($('.verify-steps code')?.textContent).toContain('costs:explain')
  })

  it('says the missing categories make the real cost higher, not lower', () => {
    expect($('#method-missing')?.textContent).toMatch(/nezahŕňa/i)
    expect($('#sec-methodology')?.textContent).toContain('vyššie')
  })

  it('never shows a purpose without saying how well it is established', () => {
    const allowed = new Set(['potvrdený', 'pravdepodobný', 'neznámy'])
    // Detail is built on first open, so an unopened flight has no purpose block at all.
    // Checking only what some earlier test happened to open makes this pass or fail on
    // the order of the suite rather than on the page.
    for (const button of $$('.strip[open-state="0"] .strip-btn')) {
      ;(button as HTMLButtonElement).click()
    }
    const blocks = $$('.purpose')
    expect(blocks.length).toBeGreaterThan(0)

    let researched = 0
    for (const block of blocks) {
      const status = block.querySelector('.status')?.textContent ?? ''
      expect(allowed.has(status), `unlabelled purpose "${status}"`).toBe(true)
      // A stated purpose without a qualifier would read as established fact, which is
      // the one thing the methodology promises never to do.
      if (block.querySelector('.ptitle')) {
        expect(status).not.toBe('')
        researched++
      }
    }
    expect(researched, 'no researched purpose left on the page').toBeGreaterThan(0)
  })
})

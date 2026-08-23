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

  it('shows the coverage grid with all three day states', () => {
    expect($$('.cov .c-flew').length).toBeGreaterThan(0)
    expect($$('.cov .c-quiet').length).toBeGreaterThan(0)
    expect($$('.cov .c-nodata').length).toBeGreaterThan(0)
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

  it('keeps the two-aircraft proof, and never leaves an empty box in its place', () => {
    // This block was silently deleted once by an unrelated edit and nothing noticed,
    // because a styled empty div looks like a design bug rather than missing content.
    const verify = $('.verify')
    expect(verify).not.toBeNull()
    expect(verify!.children.length).toBeGreaterThan(2)
    expect(verify!.textContent).toMatch(/naozaj dva rôzne stroje/)
    expect(verify!.querySelector('.proof')?.textContent).toMatch(/potrebná rýchlosť/)
    expect(verify!.querySelector('.verdict')?.textContent).toMatch(/dve samostatné lietadlá/)
  })

  it('never renders an element that is styled as a box but holds nothing', () => {
    for (const selector of ['.verify', '#fleet-groups', '#missions', '#routes', '#fleet-cost']) {
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
    // "3 letov" reads as a typo; 2-4 takes a different form from 5+.
    const text = $('#sec-fleet')?.textContent ?? ''
    expect(text).toContain('3 lety')
    expect(text).toContain('5 letov')
    expect(text).toContain('lietadlá v službe')
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

  it('marks the flight purpose as probable rather than confirmed', () => {
    const status = $('.purpose .status')
    expect(status?.textContent).toBe('pravdepodobný')
  })
})

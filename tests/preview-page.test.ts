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

  it('credits every aircraft photograph', () => {
    const figures = $$('.ac figure')
    expect(figures.length).toBeGreaterThan(0)
    for (const figure of figures) {
      const caption = figure.querySelector('figcaption')
      expect(caption?.textContent).toMatch(/CC BY/)
      expect(caption?.querySelector('a[href*="commons.wikimedia.org"]')).not.toBeNull()
    }
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

/**
 * THE SALES AND COMMUNICATIONS DASHBOARDS, REBUILT AROUND THE DEBT-COLLECTION WORK (S8, 18 Oct).
 *
 * The firm: "focus more on the debt collection side", leads against mandates month by month with the
 * closing rate, handovers from new clients, no Communications block on the sales page; and for
 * Communications, handovers from existing clients, the top clients, who has gone quiet, clients
 * touched, and a High / Medium / Low value band instead of a rand figure.
 *
 * Run: node scripts/qa/e2e/sales-comms-dashboards.mjs
 */
import { OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('sales-comms-dashboards')
const ADMIN = { ...PROFILE, role: 'Administrator' }
const INTAKE = [
  { day: '2026-09-15', accounts: 5, capital: 50000, new_accounts: 5, new_capital: 50000 },
  { day: '2026-10-14', accounts: 6, capital: 90000, new_accounts: 2, new_capital: 40000 },
]
const BOOKS = [
  { company_id: 'c1', name: 'Big Book Ltd', account_owner_id: ADMIN.id, mandate_signed_at: '2025-01-01T00:00:00Z', first_handover: '2025-02-01', last_handover: '2026-10-14', accounts: 40, capital: 800000, collected: 200000, period_accounts: 4, period_capital: 50000, value_band: 'High' },
  { company_id: 'c2', name: 'Quiet Holdings', account_owner_id: ADMIN.id, mandate_signed_at: '2025-03-01T00:00:00Z', first_handover: '2025-04-01', last_handover: '2026-06-01', accounts: 12, capital: 120000, collected: 60000, period_accounts: 0, period_capital: 0, value_band: 'Low' },
  { company_id: 'c3', name: 'Waiting Signee', account_owner_id: ADMIN.id, mandate_signed_at: '2026-10-01T00:00:00Z', first_handover: null, last_handover: null, accounts: 0, capital: 0, collected: 0, period_accounts: 0, period_capital: 0, value_band: null },
]

/* Leads and mandates across the last months, so the stacked bars have something to stack. */
const LEADS = Array.from({ length: 40 }, (_, i) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, lead_number: i + 1, first_name: 'Lead', last_name: String(i),
  company_name: `Lead Co ${i}`, source: 'Website', status: 'Interested', owner_id: ADMIN.id,
  created_at: `2026-${String(5 + (i % 5)).padStart(2, '0')}-20T09:00:00Z`,
}))
const DEALS = Array.from({ length: 8 }, (_, i) => ({
  id: `00000000-0000-4000-9000-${String(i).padStart(12, '0')}`, name: `Mandate ${i}`, company_id: 'c1', owner_id: ADMIN.id,
  stage: 'Won', value: 0, kind: 'Handover', service: 'Debt Collection', source: 'Website',
  won_at: `2026-${String(5 + (i % 5)).padStart(2, '0')}-25T09:00:00Z`, expected_close_date: '2026-09-01T00:00:00Z', created_at: '2026-05-01T00:00:00Z',
})).concat([
  /* Opened this sales month: two service deals and one mandate still out for signature. Deal outcomes
     must count the two and not the mandate. */
  { id: '00000000-0000-4000-9000-000000000101', name: 'Contract drafting', company_id: 'c1', owner_id: ADMIN.id, stage: 'Won', value: 5000, kind: 'Service', service: 'Contract Drafting', source: 'Website', won_at: '2026-10-15T09:00:00Z', expected_close_date: '2026-10-30T00:00:00Z', created_at: '2026-10-12T09:00:00Z' },
  { id: '00000000-0000-4000-9000-000000000102', name: 'Executive listing', company_id: 'c1', owner_id: ADMIN.id, stage: 'Proposal', value: 3000, kind: 'Service', service: 'Executive Listing', source: 'Website', won_at: null, expected_close_date: '2026-10-30T00:00:00Z', created_at: '2026-10-13T09:00:00Z' },
  { id: '00000000-0000-4000-9000-000000000103', name: 'Mandate out', company_id: 'c1', owner_id: ADMIN.id, stage: 'Mandate Sent', value: 0, kind: 'Handover', service: 'Debt Collection', source: 'Website', won_at: null, expected_close_date: '2026-10-30T00:00:00Z', created_at: '2026-10-14T09:00:00Z' },
])

const server = await startServer()
let browser
try {
  browser = await chromium.launch()
  const handlers = [
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
    [(u) => /\/rpc\/company_intake_by_day/.test(u), () => ({ body: INTAKE })],
    [(u) => /\/rpc\/client_book_summary/.test(u), () => ({ body: BOOKS })],
    [(u) => /\/rpc\/clients_awaiting_first_handover/.test(u), () => ({ body: [] })],
    [(u) => /\/rpc\/client_handover_days/.test(u), () => ({ body: [
      /* Monthly on the 25th, last on 25 Aug: due 25 Sep, late by 18 Oct. */
      ...['2026-05-25', '2026-06-25', '2026-07-25', '2026-08-25'].map((day) => ({ company_id: 'c-late', name: 'Late Larry Ltd', account_owner_id: ADMIN.id, day, accounts: 3 })),
      /* Monthly on the 10th, last on 10 Oct: keeping to it. */
      ...['2026-07-10', '2026-08-10', '2026-09-10', '2026-10-10'].map((day) => ({ company_id: 'c-ok', name: 'On Time Ltd', account_owner_id: ADMIN.id, day, accounts: 2 })),
    ] })],
    [(u) => /\/rest\/v1\/leads/.test(u), () => ({ body: LEADS })],
    [(u) => /\/rest\/v1\/deals/.test(u), () => ({ body: DEALS })],
  ]
  const { context, page } = await signedInPage(browser, ADMIN, handlers, [], { now: '2026-10-18T10:00:00+02:00' })
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/dashboard/sales`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  await page.getByTestId('sales-track').waitFor({ timeout: 15000 })
  const body = await page.locator('main').innerText()
  t.ok('the sales page leads with the Mandates card, in the deal-outcomes shape', await page.getByTestId('mandate-outcomes').isVisible())
  t.ok('...and has no Communications block', !/Client servicing over the same period/.test(body))
  t.ok('leads and mandates month by month', /Leads and mandates, month by month/.test(body))
  const monthsShown = async () => (await page.getByTestId('sales-track').locator('.recharts-cartesian-axis-tick-labels text')
    .evaluateAll((ts) => ts.map((x) => x.textContent ?? ''))).filter((x) => /^[A-Z][a-z]{2}( \d\d)?$/.test(x.trim())).length
  t.check('...six months by default', await monthsShown(), 6)
  await page.getByTestId('sales-track-months-12').click()
  await page.waitForTimeout(400)
  t.check('...and twelve on the switch', await monthsShown(), 12)
  /* ONE BAR A MONTH, filled from the bottom by the mandates: two layers stacked, the closing rate over it. */
  t.check('mandates and unsigned leads stack into one bar', await page.getByTestId('sales-track').locator('.recharts-bar').count(), 2)
  t.ok('...with the closing rate printed over the bar', (await page.getByTestId('sales-track').locator('.recharts-label-list text').allTextContents()).some((x) => /^\d+%$/.test(x)))
  await page.getByTestId('sales-track-show-lines').click()
  await page.waitForTimeout(300)
  t.check('the Line switch draws lines instead', JSON.stringify([await page.getByTestId('sales-track').locator('.recharts-bar').count(), await page.getByTestId('sales-track').locator('.recharts-line').count()]), '[0,2]')
  await page.getByTestId('sales-track-show-both').click()
  await page.waitForTimeout(300)
  t.check('...and Both draws both', JSON.stringify([await page.getByTestId('sales-track').locator('.recharts-bar').count(), await page.getByTestId('sales-track').locator('.recharts-line').count()]), '[2,2]')
  /* THE % NEVER SITS ON THE LINE (the firm circled one, 18 Oct): with the leads line drawn, every
     closing-rate label ends above the dot it belongs to. */
  const clear = await page.getByTestId('sales-track').evaluate((root) => {
    const dots = root.querySelectorAll('.recharts-line-dots')[0]?.querySelectorAll('circle') ?? []
    const labels = [...root.querySelectorAll('.recharts-label-list text')].filter((x) => /%$/.test(x.textContent ?? ''))
    if (!labels.length || !dots.length) return `nothing to compare: ${labels.length} labels, ${dots.length} dots, ${[...root.querySelectorAll('[class*=label]')].map((x) => x.getAttribute('class')).slice(0, 6).join('|')}`
    return labels.every((l) => {
      const b = l.getBoundingClientRect()
      const cx = b.x + b.width / 2
      const dot = [...dots].map((d) => d.getBoundingClientRect()).sort((p, q) => Math.abs(p.x + p.width / 2 - cx) - Math.abs(q.x + q.width / 2 - cx))[0]
      return b.bottom <= dot.top - 5
    }) ? 'clear' : 'on the line'
  })
  t.check('with the line drawn, the closing rate sits clear above it', clear, 'clear')
  t.ok('the charts are compact', ((await page.getByTestId('sales-track').locator('.recharts-responsive-container').boundingBox())?.height ?? 999) <= 180)
  t.ok('new-client handovers this month on it: 2 accounts', /2 · R\s?40[\s,]000/.test(await page.getByTestId('mandate-outcomes').innerText()))
  t.ok('...and the closing rate in its ring', /CLOSING RATE/.test(await page.getByTestId('mandate-outcomes').innerText()))
  t.check('signed-nothing-yet is the liaisons\', not on the sales page', await page.getByTestId('sales-awaiting').count(), 0)
  t.ok('mandate to first handover, per closer', /Mandate to first handover/.test(await page.getByTestId('mandate-to-handover').innerText()))
  t.ok('where mandates come from, by source', /Website/.test(await page.getByTestId('lead-sources').innerText()))
  /* "fit these guys in next to each other": Mandates and Deal outcomes share a row on a wide screen. */
  const row = await page.evaluate(() => {
    const m = document.querySelector('[data-testid="mandate-outcomes"]')?.getBoundingClientRect()
    const d = [...document.querySelectorAll('h3, h2, p, span')].find((x) => x.textContent?.trim() === 'Deal Outcomes')?.getBoundingClientRect()
    return m && d ? [Math.abs(m.top - d.top) < 40, d.left > m.left + 200] : null
  })
  t.check('Mandates and Deal outcomes sit side by side', JSON.stringify(row), '[true,true]')
  /* ...on the firm's iPad too, not only a wide screen (they drew the split on it, 18 Oct). */
  await page.setViewportSize({ width: 1180, height: 820 })
  await page.waitForTimeout(400)
  const ipad = await page.evaluate(() => {
    const m = document.querySelector('[data-testid="mandate-outcomes"]')?.getBoundingClientRect()
    const d = [...document.querySelectorAll('h3, h2, p, span')].find((x) => x.textContent?.trim() === 'Deal Outcomes')?.getBoundingClientRect()
    return m && d ? [Math.abs(m.top - d.top) < 40, d.left > m.left + 200, document.documentElement.scrollWidth <= window.innerWidth] : null
  })
  t.check('...side by side at iPad width, with no sideways scroll', JSON.stringify(ipad), '[true,true,true]')
  await t.shot(page, 'sales-dashboard-ipad')
  await page.setViewportSize({ width: 1440, height: 900 })
  t.check('the rep table that repeated the leaderboard is gone', await page.getByTestId('sales-reps-brought-in').count(), 0)
  t.ok('deal outcomes no longer carry the lead pipeline', !/Lead pipeline, same period/.test(await page.locator('main').innerText()))
  /* MANDATES FIRST, DEALS SECOND, THEN THE GRAPHS (the firm, 18 Oct: "a mandate is a mandate and a deal
     is a deal"). */
  // The page scrolls inside <main>, not the window: compare positions with each other, never with zero.
  const yOf = async (loc) => loc.evaluate((el) => el.getBoundingClientRect().top)
  const yMandates = await yOf(page.getByTestId('mandate-outcomes'))
  const yDeals = await yOf(page.getByText('Deal Outcomes', { exact: true }).first())
  const yTrack = await yOf(page.getByTestId('sales-track'))
  t.check('the order is mandates, deals (beside or below), then the track record', JSON.stringify([await page.getByTestId('mandate-outcomes').count(), yMandates <= yDeals + 40, yDeals < yTrack]), '[1,true,true]')
  t.ok('deal outcomes count the 2 service deals and not the mandate out for signature', /The 2 service deals opened/.test(await page.locator('main').innerText()))
  t.ok('the leaderboard says closers', /Top performing closers/.test(body) || /Top performing closers/.test(await page.locator('main').innerText()))
  t.ok('...and the picker offers closers and liaisons', (await page.locator('option').allTextContents()).some((x) => /All closers and liaisons/.test(x)))
  await t.shot(page, 'sales-dashboard')

  await page.goto(`http://localhost:${PORT}/dashboard/communications`)
  await page.getByTestId('top-clients').waitFor({ timeout: 15000 })
  t.ok('Communications: existing-client handovers this month, 4 accounts', /4 · R\s?50[\s,]000/.test(await page.getByTestId('comms-row').innerText()))
  const top = await page.getByTestId('top-clients').innerText()
  t.ok('top clients this month, with the value band', /Big Book Ltd/.test(top) && /High/.test(top))
  t.ok('...no rand profit anywhere on the page', !/commission/i.test(await page.locator('main').innerText()))
  await page.getByTestId('top-clients-recovery').click()
  t.ok('...ranked by recovery rate on the switch', /50%/.test(await page.getByTestId('top-clients').innerText()))
  const quiet = await page.getByTestId('gone-quiet').innerText()
  t.ok('gone quiet: nothing for 60 days', /Quiet Holdings/.test(quiet) && !/Big Book/.test(quiet))
  /* PATTERNS (the firm's "3 then 1"): late against their own rhythm, and a typical month. */
  const late = (await page.getByTestId('late-pattern').innerText()).replace(/\s+/g, ' ')
  t.ok('late against their pattern: the monthly client past the 25th, by how much', /Late Larry Ltd/.test(late) && /about once a month, usually around the 25th/.test(late) && /\d+ days late/.test(late))
  t.ok('...and not the client keeping to theirs', !/On Time Ltd/.test(late) && /1 more are keeping to theirs/.test(late))
  t.ok('a typical month: a bar a day of the month', (await page.getByTestId('typical-month').locator('.recharts-xAxis-tick-labels text').count()) === 31)
  await t.shot(page, 'communications-dashboard')

  /* THE THREE ARRANGEMENTS (S9, 19 Oct): "the one under the other, the three panes, and that one
     that's left that's bigger and small on the right". Each pressed, each measured. */
  await page.setViewportSize({ width: 1366, height: 3600 })
  const panes = page.getByTestId('dashboard-panes')
  const leftOf = async (id) => (await panes.locator(`[data-pane="${id}"]`).boundingBox())?.x ?? -1
  const widthOf = async (id) => (await panes.locator(`[data-pane="${id}"]`).boundingBox())?.width ?? -1
  await panes.getByRole('button', { name: 'One column' }).click(); await page.waitForTimeout(300)
  t.ok('one column: the lists under each other, as wide as the chart',
    Math.abs((await widthOf('late-pattern')) - (await widthOf('existing-handovers'))) < 2)
  await page.screenshot({ path: `${OUT}/comms-layout-stacked.png` })
  await panes.getByRole('button', { name: 'Three columns' }).click(); await page.waitForTimeout(300)
  t.ok('three columns: the lists side by side, a third each',
    (await leftOf('late-pattern')) > (await leftOf('gone-quiet')) && (await widthOf('gone-quiet')) < (await widthOf('existing-handovers')) / 2.5)
  await page.screenshot({ path: `${OUT}/comms-layout-columns.png` })
  await panes.getByRole('button', { name: 'Wide' }).click(); await page.waitForTimeout(300)
  t.ok('wide: the charts two thirds on the left, the lists down the right',
    (await leftOf('late-pattern')) > (await leftOf('existing-handovers')) + (await widthOf('existing-handovers')) - 5)
  t.ok('...the figure rows still across the page in every arrangement',
    (await widthOf('figures')) > (await widthOf('existing-handovers')) * 1.3)
  await page.screenshot({ path: `${OUT}/comms-layout-wide.png` })
  t.check('...and the choice is remembered', await page.evaluate(() => localStorage.getItem('raptor.dashboard.communications.layout')), 'wide')
  await context.close()

  /* THE SALES PAGE FOLLOWS THE STAGING CLOCK (the firm, 18 Oct: staging on 11 Sep, the page opened on
     November and showed nothing). TODAY was read at import, before the clock was asked. */
  const staged = await signedInPage(browser, ADMIN, [
    [(u) => /\/rpc\/raptor_clock/.test(u), () => ({ body: [{ business_now: '2026-09-11T08:00:00+02:00', business_today: '2026-09-11', real_now: '2026-10-18T10:00:00+02:00', real_today: '2026-10-18', staging: true, moved: true }] })],
    ...handlers,
  ], [], { now: '2026-10-18T10:00:00+02:00' })
  await staged.page.goto(`http://localhost:${PORT}/dashboard/sales`)
  await staged.page.getByTestId('mandate-outcomes').waitFor({ timeout: 15000 })
  t.ok('on staging set to 11 Sep, the sales page opens on September', /September 2026/.test(await staged.page.locator('main').innerText()) && !/November 2026/.test(await staged.page.locator('main').innerText()))
  await staged.context.close()
} finally {
  if (browser) await browser.close()
  stopServer(server)
}
process.exit(t.finish() ? 0 : 1)

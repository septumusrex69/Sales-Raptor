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
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
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
}))

const server = await startServer()
let browser
try {
  browser = await chromium.launch()
  const handlers = [
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
    [(u) => /\/rpc\/company_intake_by_day/.test(u), () => ({ body: INTAKE })],
    [(u) => /\/rpc\/client_book_summary/.test(u), () => ({ body: BOOKS })],
    [(u) => /\/rpc\/clients_awaiting_first_handover/.test(u), () => ({ body: [] })],
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
  t.ok('the sales page leads with the collections row', await page.getByTestId('sales-collections-row').isVisible())
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
  t.ok('the charts are compact', ((await page.getByTestId('sales-track').locator('.recharts-responsive-container').boundingBox())?.height ?? 999) <= 180)
  t.ok('new-client handovers this month in the row: 2 accounts', /2 · R\s?40[\s,]000/.test(await page.getByTestId('sales-collections-row').innerText()))
  t.ok('signed, nothing handed over, for Sales', /Waiting Signee/.test(await page.getByTestId('sales-awaiting').innerText()))
  t.ok('what each rep brought in', await page.getByTestId('sales-reps-brought-in').isVisible())
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
  await t.shot(page, 'communications-dashboard')
  await context.close()
} finally {
  if (browser) await browser.close()
  stopServer(server)
}
process.exit(t.finish() ? 0 : 1)

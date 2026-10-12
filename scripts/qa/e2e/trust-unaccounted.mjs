/**
 * "NOT ACCOUNTED FOR" OPENS EVERY ITEM BEHIND IT, IN A REAL BROWSER (S7).
 *
 * The firm, 12 Oct: "If I click on that, it should show me everything." Staging's own shape that day:
 * R71 204.37 in the bank, R56 945.73 with an owner, and the R14 258.64 between them was three payovers
 * and two refunds marked paid whose statement had not been imported. This holds that the overview's
 * figure opens the list, the list adds up to the figure with nothing left over, each item says what
 * to do, and a receipt nobody placed is listed with "Place it".
 *
 * Run: node scripts/qa/e2e/trust-unaccounted.mjs
 */
import { OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('trust-unaccounted')
const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator' }
const NBSP = String.fromCharCode(0xa0)
const flat = (s) => s.split(NBSP).join(' ')

const POSITION = { trust_cash: 71704.37, creditors: 56945.73, debtors: 0, net_owed: 56945.73, difference: 14758.64,
  owed_to_firm: 42826.88, owed_to_clients: 14118.85, owed_by_clients: 0, owed_to_debtors: 0, unidentified: 500 }
const CASH = [
  { period_start: '2026-05-11', period_end: '2026-06-10', pays_on: '2026-07-11', is_open: false, for_clients: 356.25, for_firm: 11811.29, firm_set_off: 0, firm_other: 0, for_debtors: 0, unplaced: 0, total: 12167.54 },
  { period_start: '2026-06-11', period_end: '2026-07-10', pays_on: '2026-08-11', is_open: false, for_clients: 748.12, for_firm: 15435.24, firm_set_off: 0, firm_other: 1923.68, for_debtors: 1925.47, unplaced: 0, total: 20032.51 },
  { period_start: '2026-07-11', period_end: '2026-08-10', pays_on: '2026-09-11', is_open: false, for_clients: 14118.85, for_firm: 12631.15, firm_set_off: 0, firm_other: -78.85, for_debtors: 1000, unplaced: 0, total: 27671.15 },
  { period_start: '2026-08-11', period_end: '2026-09-10', pays_on: '2026-10-11', is_open: true, for_clients: 0, for_firm: 0, firm_set_off: 0, firm_other: 0, for_debtors: -2925.47, unplaced: 0, total: -2925.47 },
]
const out = (kind, id, payee, amount, caseNumber) => ({ kind, id, payee, amount, reference: null, paid_at: '2026-08-11T09:00:00Z',
  paid_reference: `BF ${caseNumber}`, confirmed: false, statement_date: null, company_id: null, account_id: null, case_number: caseNumber })
const PAID_OUT = [
  out('payover', 'r-klr', 'Karoo Linen Rentals (Pty) Ltd', 4451.47, 'PO-KLR-2607'),
  out('payover', 'r-hth', 'Highveld Tool Hire CC', 4538.6, 'PO-HTH-2607'),
  out('payover', 'r-sbb', 'Seabreeze Body Corporate', 2343.1, 'PO-SBB-2607'),
  out('refund', 'o-1', 'Zanele Mabaso', 1925.47, 'RAP-124312'),
  out('refund', 'o-2', 'Riaan Venter', 1000, 'RAP-124303'),
  /* Already on the statement: not part of the gap, not listed. */
  { ...out('payover', 'r-old', 'Karoo Linen Rentals (Pty) Ltd', 4775.05, 'PO-KLR-2606'), confirmed: true, statement_date: '2026-07-12' },
]
/* One receipt nobody has placed: R500 more in the bank (the position above carries it). */
const LINES = [{ id: 'l-1', txn_date: '2026-08-09', amount: 500, description: 'CAPITEC T NGUBANE', direction: 'credit',
  reference: null, bank_account: '62700201255', bank_account_label: null, status: 'unallocated' }]

const handlers = [
  [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
  [(u) => /\/rest\/v1\/firm_settings/.test(u), () => ({ body: { trust_account_number: '62700201255', trust_opening_balance: 21600, trust_opening_date: '2026-06-10' } })],
  [(u) => /\/rpc\/trust_position/.test(u), () => ({ body: [POSITION] })],
  [(u) => /\/rpc\/trust_cash_by_cycle/.test(u), () => ({ body: CASH })],
  [(u) => /\/rpc\/payments_out_paid/.test(u), () => ({ body: PAID_OUT })],
  [(u) => /\/rpc\/bank_lines_to_allocate/.test(u), () => ({ body: LINES })],
  [(u) => /\/rpc\/trust_awaiting_approval/.test(u), () => ({ body: [{ amount: 0, payments: 0 }] })],
  [(u) => /\/rest\/v1\//.test(u), () => ({ body: [] })],
  [(u) => /\/rpc\//.test(u), () => ({ body: [] })],
]

const server = await startServer()
const browser = await chromium.launch()
try {
  const { context, page } = await signedInPage(browser, ADMIN, handlers, [])
  await page.goto(`http://127.0.0.1:${PORT}/trust`, { waitUntil: 'domcontentloaded' })
  const open = page.getByTestId('open-unaccounted')
  await open.waitFor({ timeout: 20000 })
  t.ok('the overview\'s figure offers every item', /R 14 758\.64[\s\S]*See every item/.test(flat(await open.innerText())))
  await open.click()

  await page.getByTestId('unaccounted-item').first().waitFor({ timeout: 15000 })
  t.ok('it opens the list', /\/trust\/unaccounted$/.test(page.url()))
  t.ok('the list says it is fully explained',
    /Not accounted for[\s\S]*R 14 758\.64[\s\S]*Fully explained by the 6 items below/i.test(flat(await page.getByTestId('unaccounted-sum').innerText())))
  t.check('one line for each payment marked paid and the receipt, nothing for what is on a statement',
    await page.getByTestId('unaccounted-item').count(), 6)
  t.check('in the order the work is done', JSON.stringify(await page.getByTestId('unaccounted-group').evaluateAll((els) => els.map((e) => e.getAttribute('data-group')))),
    '["paid_out","statement"]')
  const first = flat(await page.getByTestId('unaccounted-item').first().innerText())
  t.ok('the biggest first, with how it was paid and what to do',
    /Highveld Tool Hire CC · PO-HTH-2607[\s\S]*Payover, marked paid on BF PO-HTH-2607[\s\S]*R 4 538\.60[\s\S]*Open the run/.test(first))
  t.ok('the receipt nobody placed is listed with Place it',
    /CAPITEC T NGUBANE[\s\S]*not yet placed on an account[\s\S]*R 500\.00[\s\S]*Place it/.test(flat(await page.getByTestId('unaccounted-item').last().innerText())))
  t.check('nothing is left unexplained', await page.locator('[data-group="unexplained"]').count(), 0)
  await t.shot(page, 'trust-unaccounted')

  await page.getByTestId('unaccounted-item').first().getByRole('link', { name: /Open the run/ }).click()
  await page.waitForURL(/\/trust\/runs\/r-hth/, { timeout: 10000 }).catch(() => {})
  t.ok('an item opens where its job is done', /\/trust\/runs\/r-hth/.test(page.url()))
  await context.close()
} catch (e) {
  try { const pg = browser.contexts().flatMap((c) => c.pages())[0]; if (pg) { await t.shot(pg, 'trust-unaccounted-where-it-stopped'); console.log('URL', pg.url()) } } catch { /* */ }
  t.ok(`the run finished without throwing (${e instanceof Error ? e.message.split('\n')[0] : e})`, false)
} finally {
  await browser.close()
  stopServer(server)
}
const good = t.finish(`"Not accounted for" opens every item behind it, adding up to the figure, each with what to do.
Screenshots in ${OUT}.`)
process.exit(good ? 0 : 1)

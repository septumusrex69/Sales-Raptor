/**
 * THE TRUST AREA AT STAGING'S SIZE (S19, Raptor H18; Stephan on the iPad, 7 Nov: "it looks like the entire trust
 * area is lagging").
 *
 * Every trust function answers in well under a fifth of a second; the lag was the browser drawing every row --
 * To sort's 2 135 statement lines (each with its own drop-downs), the Bank statement's 2 160, Payments in's 330
 * payments out. And the statement was also SHORT: the server hands back at most 1 000 rows a request, so the
 * page held the newest 1 000 and the older months were not on it at all.
 *
 * Here, at those sizes, with a stub that caps every answer at 1 000 like the server: each list draws a hundred and
 * says how many there are, Show more draws the next hundred, and the statement reaches its oldest month.
 *
 * Run: node scripts/qa/e2e/trust-big-lists.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('trust-big-lists')
const plain = (x) => x.split(String.fromCharCode(0xa0)).join(' ')
const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator', team_id: null }
/* Newest first, as every function orders them; i = 0 is the newest. 2026-10 back to 2026-05 (the old cap stopped at August). */
const day = (i) => `2026-${String(10 - Math.floor(i / 360)).padStart(2, '0')}-${String(28 - (i % 28)).padStart(2, '0')}`

const LINES = Array.from({ length: 2135 }, (_, i) => ({
  id: `l-${i}`, txn_date: day(i), amount: i % 7 === 0 ? -250 : 120, description: `LINE ${i}`,
  direction: i % 7 === 0 ? 'debit' : 'credit', reference: null, bank_account: '627', bank_account_label: 'Trust', status: 'unallocated',
}))
const STATEMENT = Array.from({ length: 2160 }, (_, i) => ({
  id: `s-${i}`, txn_date: day(i), amount: 100, balance: null, description: `STATEMENT ${i}`, direction: 'credit',
  reference: null, status: 'allocated', what: 'A debtor’s payment', case_number: null, account_id: null, run_invoice: null, run_id: null,
}))
const OUTS = Array.from({ length: 330 }, (_, i) => ({
  id: `o-${i}`, txn_date: day(i), amount: -500, description: `PAYMENT OUT ${i}`, candidate_run: null, candidate_invoice: null, candidate_client: null,
}))
function capped(url, rows) {
  const q = new URL(url).searchParams
  const offset = Number(q.get('offset') ?? 0)
  return rows.slice(offset, offset + Math.min(Number(q.get('limit') ?? 1000), 1000))
}
const handlers = [
  [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
  [(u) => /\/rpc\/bank_lines_to_allocate/.test(u), (u) => ({ body: capped(u, LINES) })],
  [(u) => /\/rpc\/trust_bank_statement/.test(u), (u) => ({ body: capped(u, STATEMENT) })],
  [(u) => /\/rpc\/unreconciled_payouts/.test(u), (u) => ({ body: capped(u, OUTS) })],
  [(u) => /\/rest\/v1\//.test(u), () => ({ body: [] })],
  [(u) => /\/rpc\//.test(u), () => ({ body: [] })],
]

const server = await startServer()
const browser = await chromium.launch()
try {
  const { context, page } = await signedInPage(browser, ADMIN, handlers, [])

  /* ---- To sort: 2 135 statement lines ---- */
  await page.goto(`http://127.0.0.1:${PORT}/trust/exceptions`, { waitUntil: 'domcontentloaded' })
  const line = page.getByTestId('line-to-allocate')
  await line.first().waitFor({ timeout: 20000 })
  t.check('To sort draws a hundred statement lines, not 2 135', await line.count(), 100)
  t.ok('...and says how many there are', /Showing 100 of 2 135/.test(plain(await page.getByTestId('lines-more').innerText())))
  await page.getByTestId('lines-more').getByRole('button', { name: /Show 100 more/ }).click()
  t.check('Show 100 more draws the next hundred', await line.count(), 200)

  /* ---- Bank statement: 2 160 lines, past the cap ---- */
  await page.goto(`http://127.0.0.1:${PORT}/trust/statement`, { waitUntil: 'domcontentloaded' })
  const row = page.getByTestId('statement-line')
  await row.first().waitFor({ timeout: 20000 })
  t.check('the statement draws a hundred lines', await row.count(), 100)
  t.ok('...of all 2 160, not the newest 1 000', /Showing 100 of 2 160/.test(plain(await page.getByTestId('statement-more').innerText())))
  const months = await page.getByLabel('Month').locator('option').allInnerTexts()
  t.ok(`...and its oldest month is on it (${months.at(-1)})`, months.some((m) => /May 2026/.test(m)))
  await page.getByLabel('Month').selectOption({ label: 'May 2026' })
  await page.waitForTimeout(200)
  t.ok('a month past the old cap opens, at its first hundred', (await row.count()) > 0 && (await row.count()) <= 100)

  /* ---- Payments in: no list of payments out any more (S21) ----
     Suspense and the money out beside it left Payments in (Stephan: "the payments in should only show what needs to be
     approved"). The 330 payments out are To sort's Statement lines to allocate, drawn a hundred at a time above. */
  await page.goto(`http://127.0.0.1:${PORT}/trust/payments`, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('payments-overview').waitFor({ timeout: 20000 })
  t.check('Payments in no longer draws the payments out', await page.getByTestId('payouts-more').count(), 0)
  await context.close()
} catch (e) {
  t.ok(`the run finished without throwing (${e instanceof Error ? e.message.split('\n')[0] : e})`, false)
} finally {
  await browser.close()
  stopServer(server)
}
process.exit(t.finish() ? 0 : 1)

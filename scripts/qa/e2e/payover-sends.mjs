/**
 * A SENT PAYOVER ADVICE, KEPT AS IT WENT, IN A REAL BROWSER.
 *
 * The firm, 8 Oct: "if something was sent, there should be ... a record of ... the data that was
 * sent", and "you can revise one and then send it again". check-payover-sends holds the table, the
 * bucket and the order of the steps; this holds that a run shows every copy that went, that a sent
 * or paid run offers Send again, and that a run sent before copies were kept says so plainly rather
 * than showing an empty list.
 *
 * Run: node scripts/qa/e2e/payover-sends.mjs
 */
import { OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('payover-sends')
const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator', team_id: null }
const RUN = {
  id: 'run-1', invoice_number: 'PO-BPM-2610', status: 'paid', period_start: '2026-08-11', period_end: '2026-09-10',
  trust_capital: 10000, trust_commission: 1500, due_to_client: 8500, ptc_received: 0, ptc_fees_taken: 0,
  ptc_capital: 0, ptc_commission: 0, due_to_bf: 0, commission_vat: 225, carried_in: 0, charges_set_off: 0,
  excess_released: 0, net_payover: 8275, approved_at: '2026-10-08T08:00:00Z', sent_at: '2026-10-08T09:00:00Z',
  paid_at: '2026-10-08T10:00:00Z', eft_reference: 'BF PO-BPM-2610', company_id: 'c2',
  companies: { name: 'Baobab Property Managers (Pty) Ltd', code: 'BPM', commission_rate: 0.15, vat_number: null, email: 'accounts@example.co.za' },
}
const SENDS = [
  { id: 's2', run_id: 'run-1', version: 2, sent_at: '2026-10-09T09:00:00Z', sent_to: 'finance@example.co.za',
    subject: 'Remittance advice', net_payover: 8275, pdf_path: 'c2/PO-BPM-2610/b.pdf', xlsx_path: 'c2/PO-BPM-2610/b.xlsx' },
  { id: 's1', run_id: 'run-1', version: 1, sent_at: '2026-10-08T09:00:00Z', sent_to: 'accounts@example.co.za',
    subject: 'Remittance advice', net_payover: 8275, pdf_path: 'c2/PO-BPM-2610/a.pdf', xlsx_path: 'c2/PO-BPM-2610/a.xlsx' },
]
let sends = SENDS
/* Three stages: on the statement, paid by hand and not yet on it, and still owed. */
const CLIENT_RUNS = [
  { id: 'run-2', invoice_number: 'PO-BPM-2611', status: 'sent', period_start: '2026-09-11', period_end: '2026-10-10',
    net_payover: 1200, paid_at: null, eft_reference: null },
  { id: 'run-1', invoice_number: 'PO-BPM-2610', status: 'paid', period_start: '2026-08-11', period_end: '2026-09-10',
    net_payover: 8275, paid_at: '2026-10-08T10:00:00Z', eft_reference: 'BF PO-BPM-2610' },
  { id: 'run-0', invoice_number: 'PO-BPM-2609', status: 'paid', period_start: '2026-07-11', period_end: '2026-08-10',
    net_payover: 500, paid_at: '2026-09-15T10:00:00Z', eft_reference: 'BF PO-BPM-2609' },
]
const handlers = [
  [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
  /* The client's list asks by company; the run page asks for one. */
  [(u) => /\/rest\/v1\/payover_runs\?.*company_id=eq/.test(u), () => ({ body: CLIENT_RUNS })],
  [(u) => /\/rest\/v1\/payover_runs\?/.test(u), () => ({ body: RUN })],
  [(u) => /\/rest\/v1\/bank_statement_lines\?/.test(u), () => ({ body: [{ payover_run_id: 'run-0', txn_date: '2026-09-16' }] })],
  [(u) => /\/rest\/v1\/companies/.test(u), () => ({ body: [{ id: 'c2', name: 'Baobab Property Managers (Pty) Ltd', owner_id: ADMIN.id }] })],
  [(u) => /\/rest\/v1\/payover_run_sends\?/.test(u), () => ({ body: sends })],
  [(u) => /\/rest\/v1\/firm_settings\?/.test(u), () => ({ body: { firm_name: 'Bredell Ferreira', physical_address: null, phone: null, email: null, vat_number: null, payouts_statement_only: false } })],
  [(u) => /\/rest\/v1\//.test(u), () => ({ body: [] })],
  [(u) => /\/rpc\//.test(u), () => ({ body: [] })],
]

const server = await startServer()
const browser = await chromium.launch()
try {
  const { context, page } = await signedInPage(browser, ADMIN, handlers, [])
  await page.goto(`http://127.0.0.1:${PORT}/trust/runs/run-1`, { waitUntil: 'domcontentloaded' })
  const list = page.getByTestId('sent-copies')
  await list.waitFor({ timeout: 20000 })
  t.check('every copy that went is listed', await list.locator('li').count(), 2)
  const text = await list.innerText()
  t.ok('...the revision named as such, newest first', /^Sent again \(2\)/.test(text.trim()))
  t.ok('...each with where it went', text.includes('finance@example.co.za') && text.includes('accounts@example.co.za'))
  t.check('...and each opens its own PDF and schedule', await list.getByRole('button', { name: 'Statement (PDF)' }).count(), 2)
  t.ok('a paid run offers Send again', await page.getByRole('button', { name: 'Send again' }).isVisible())
  t.check('...and not a first Email advice', await page.getByRole('button', { name: 'Email advice' }).count(), 0)
  await t.shot(page, 'payover-sends')

  await page.getByRole('button', { name: 'Send again' }).click()
  const title = page.getByText('Send the remittance advice again')
  await title.waitFor({ timeout: 10000 }).catch(() => {})
  t.ok('Send again says it goes beside what was sent', await title.isVisible()
    && (await page.getByText(/What was sent before is kept as it was/).count()) > 0)
  await page.getByRole('button', { name: 'Cancel' }).click()

  /* ---- THE CLIENT'S FOLDER: every run, where it has got to, and what was sent ---- */
  await page.goto(`http://127.0.0.1:${PORT}/companies/c2`, { waitUntil: 'domcontentloaded' })
  const tab = page.getByRole('button', { name: 'Payovers', exact: true })
  await tab.waitFor({ timeout: 15000 })
  await tab.click()
  const runsOn = page.getByTestId('client-payover')
  await runsOn.first().waitFor({ timeout: 15000 })
  t.check('the client lists every run', await runsOn.count(), 3)
  const folder = (await page.locator('main').innerText()).split(String.fromCharCode(0xa0)).join(' ')
  t.ok('a run paid by hand is waiting for the statement', /PO-BPM-2610[\s\S]*Paid, waiting for the statement/.test(folder))
  t.ok('...one on the statement says when', /Paid, on the statement 16 Sep 2026/.test(folder))
  t.ok('...a sent one is still owed', /Advice sent, not paid yet/.test(folder))
  t.ok('...with what it was paid with', folder.includes('reference BF PO-BPM-2610'))
  t.ok('the copies sent sit under their run', (await runsOn.filter({ hasText: 'PO-BPM-2610' }).getByRole('button', { name: 'Statement (PDF)' }).count()) === 2)
  t.ok('paid out and still to pay are added up', /Paid out R 8 775\.00/.test(folder) && /Still to pay R 1 200\.00/.test(folder))
  await t.shot(page, 'client-payovers')

  sends = []
  await page.goto(`http://127.0.0.1:${PORT}/trust/runs/run-1`, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  const none = page.getByTestId('no-sent-copy')
  await none.waitFor({ timeout: 15000 }).catch(() => {})
  t.ok('a run sent before copies were kept says there is no copy', await none.isVisible())
  await context.close()
} catch (e) {
  t.ok(`the run finished without throwing (${String(e).split('\n')[0].slice(0, 160)})`, false)
  try {
    const pages = browser.contexts().flatMap((c) => c.pages())
    if (pages[0]) await t.shot(pages[0], 'payover-sends-where-it-stopped')
  } catch { /* nothing more to learn */ }
} finally {
  await browser.close()
  stopServer(server)
}

const good = t.finish(`A sent run lists every copy that went, offers Send again, and says so when no copy was kept.
Screenshots in ${OUT}.`)
process.exit(good ? 0 : 1)

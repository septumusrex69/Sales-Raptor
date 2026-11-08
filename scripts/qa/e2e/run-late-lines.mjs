/**
 * A PAYOVER RUN SHOWS EACH PAYMENT'S THREE DATES, SAYS WHICH LINE IS LATE, AND DRAWS ITS PRESSES ONLY FOR THE TICKS
 * THAT ALLOW THEM (Raptor H19 / S20; Stephan, 8 Nov).
 *
 *  1. Paid, Captured and Approved are columns on the run. A trust receipt banked on 20 Sep and approved on 12 Nov,
 *     after September's run had gone, rides this run as a late line that says so -- "Late: received 20 Sept 2026,
 *     approved 12 Nov 2026" -- and the line banked in the cycle says nothing of the kind.
 *  2. Mark paid is drawn for payover.pay; an Administrator with that tick revoked does not see it, and Send again
 *     (issuing the advice, payover.approve) stays.
 *
 * Seen failing with the late note taken out of the Note cell, and with the mayPay gate removed.
 *
 * Run: node scripts/qa/e2e/run-late-lines.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('run-late-lines')
const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator' }
const RUN = {
  id: 'run-oct', invoice_number: 'PO-KLR-2611', status: 'sent', period_start: '2026-10-11', period_end: '2026-11-10',
  trust_capital: 1000, trust_commission: 200, due_to_client: 800, ptc_received: 0, ptc_fees_taken: 0,
  ptc_capital: 0, ptc_commission: 0, due_to_bf: 0, commission_vat: 30, carried_in: 0, charges_set_off: 0,
  excess_released: 0, net_payover: 770, approved_at: '2026-11-11T08:00:00Z', sent_at: '2026-11-11T09:00:00Z',
  paid_at: null, eft_reference: null, company_id: 'c-klr',
  companies: { name: 'Karoo Linen Rentals', code: 'KLR', commission_rate: 0.2, vat_number: null, email: 'accounts@example.com' },
}
const line = (o) => ({ line_kind: 'trust', paid_to_client: false, payment_amount: 1000, to_capital: 500, commission: 100,
  commission_vat: 15, capital_after: 4000, client_reference: 'KLR-1', ...o })
const LINES = [
  line({ line_id: 'l-own', allocation_id: 'a-own', payment_id: 'p-own', account_id: 'acc-1', case_number: 'RAP-1',
    debtor: 'On Time', received_at: '2026-10-19T22:00:00+00:00', late_capture: false }),
  line({ line_id: 'l-late', allocation_id: 'a-late', payment_id: 'p-late', account_id: 'acc-2', case_number: 'RAP-2',
    debtor: 'Came Late', received_at: '2026-09-19T22:00:00+00:00', late_capture: true }),
]
const DATES = [
  { allocation_id: 'a-own', payment_id: 'p-own', paid_to_client: false, received_on: '2026-10-20', captured_on: '2026-10-21', approved_on: '2026-10-22', cycle_on: '2026-10-20', late: false },
  { allocation_id: 'a-late', payment_id: 'p-late', paid_to_client: false, received_on: '2026-09-20', captured_on: '2026-09-21', approved_on: '2026-11-12', cycle_on: '2026-09-20', late: true },
]
const handlers = (who) => [
  [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [who] })],
  [(u) => /\/rest\/v1\/payover_runs\?/.test(u), () => ({ body: RUN })],
  [(u) => /\/rest\/v1\/firm_settings\?/.test(u), () => ({ body: { firm_name: 'Bredell Ferreira', payover_lag_months: 1, payouts_statement_only: false } })],
  [(u) => /\/rpc\/payover_run_payments\b/.test(u), () => ({ body: LINES })],
  [(u) => /\/rpc\/payover_run_payment_dates\b/.test(u), () => ({ body: DATES })],
  [(u) => /\/rest\/v1\//.test(u), () => ({ body: [] })],
  [(u) => /\/rpc\//.test(u), () => ({ body: [] })],
]

const server = await startServer()
let browser
try {
  browser = await chromium.launch()
  {
    const { context, page } = await signedInPage(browser, ADMIN, handlers(ADMIN), [], { now: '2026-11-12T10:00:00+02:00' })
    for (let i = 0; i < 60; i += 1) {
      try { await page.goto(`http://localhost:${PORT}/trust/runs/run-oct`, { timeout: 2000 }); break }
      catch { await new Promise((r) => setTimeout(r, 500)) }
    }
    await page.getByTestId('run-line-approved').first().waitFor({ timeout: 20000 })
    const head = await page.locator('thead').first().innerText()
    t.ok('the run lists Paid, Captured and Approved', /Paid/.test(head) && /Captured/.test(head) && /Approved/.test(head))
    const rows = page.locator('tbody tr')
    const late = rows.filter({ hasText: 'Came Late' })
    const own = rows.filter({ hasText: 'On Time' })
    const lateText = (await late.innerText()).replace(/\s+/g, ' ')
    t.ok(`the late line says when it was received and approved (${lateText.slice(0, 160)})`,
      /Late: received 20 Sept? 2026, approved 12 Nov 2026/.test(lateText))
    t.ok('...its Paid day is the Johannesburg day (20 Sep), not the UTC one', /20 Sep/.test(await late.getByTestId('run-line-paid').innerText()))
    t.ok('...and its Approved column says 12 Nov', /12 Nov/.test(await late.getByTestId('run-line-approved').innerText()))
    t.ok('the line in its own cycle says nothing about being late', !/Late/.test(await own.innerText()))
    t.check('an Administrator with payover.pay sees Mark paid', await page.getByRole('button', { name: 'Mark paid' }).count(), 1)
    await context.close()
  }
  {
    const NOPAY = { ...ADMIN, revokes: ['payover.pay'] }
    const { context, page } = await signedInPage(browser, NOPAY, handlers(NOPAY), [], { now: '2026-11-12T10:00:00+02:00' })
    await page.goto(`http://localhost:${PORT}/trust/runs/run-oct`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('run-line-approved').first().waitFor({ timeout: 20000 })
    t.check('with payover.pay revoked, Mark paid is not drawn', await page.getByRole('button', { name: 'Mark paid' }).count(), 0)
    t.check('...while Send again (issuing the advice is payover.approve) still is', await page.getByRole('button', { name: 'Send again' }).count(), 1)
    await context.close()
  }
} catch (e) {
  t.ok(`the run finished without throwing (${e instanceof Error ? e.message.split('\n')[0] : String(e)})`, false)
} finally {
  await browser?.close()
  stopServer(server)
}
process.exit(t.finish() ? 0 : 1)

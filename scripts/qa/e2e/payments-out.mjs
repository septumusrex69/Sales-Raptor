/**
 * TRUST -> PAYMENTS TO MAKE, IN A REAL BROWSER.
 *
 * The firm, 8 Oct: "there should be a place for payments that we have to make", each paid "with a
 * client unique reference" or, for a refund, "the debtor's reference number". check-payments-out
 * holds the SQL and the reference rule; this holds that the page is reachable from the rail, lists
 * both kinds with their references and due dates, totals them, and says when there is nothing.
 *
 * Run: node scripts/qa/e2e/payments-out.mjs
 */
import { OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('payments-out')
const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator', team_id: null }
const DUE = [
  { kind: 'payover', id: 'run-smt', payee: 'Summit Fitness (Pty) Ltd', amount: 8426.07, reference: 'BF PO-SMT-2610',
    status: 'approved', due_on: '2026-11-11', since: '2026-10-08T08:00:00Z', detail: 'FNB 62000000000', company_id: 'c1',
    account_id: null, case_number: 'PO-SMT-2610' },
  { kind: 'payover', id: 'run-bpm', payee: 'Baobab Property Managers (Pty) Ltd', amount: 9699.53, reference: 'BF PO-BPM-2610',
    status: 'sent', due_on: '2026-11-11', since: '2026-10-08T08:00:00Z', detail: null, company_id: 'c2',
    account_id: null, case_number: 'PO-BPM-2610' },
  { kind: 'refund', id: 'ref-1', payee: 'Sizwe Dlamini', amount: 490.42, reference: 'BF RAP-124059',
    status: 'due', due_on: null, since: '2026-10-08T08:00:00Z', detail: 'The debtor asked for it back', company_id: 'c3',
    account_id: 'acc-1', case_number: 'RAP-124059' },
]
let answer = DUE
const PAID = [
  { kind: 'payover', id: 'run-lvm', payee: 'Lowveld Motors (Pty) Ltd', amount: 12879.45, reference: 'BF PO-LVM-2610',
    paid_at: '2026-10-08T10:00:00Z', paid_reference: 'BF PO-LVM-2610', confirmed: false, statement_date: null,
    company_id: 'c4', account_id: null, case_number: 'PO-LVM-2610' },
  { kind: 'business_transfer', id: 'draw-1', payee: 'Bredell Ferreira (business account)', amount: 5000,
    reference: 'BF FEES-2609', paid_at: '2026-09-15T10:00:00Z', paid_reference: 'BF FEES-2609', confirmed: true,
    statement_date: '2026-09-16', company_id: null, account_id: null, case_number: null },
]
const POSITION = { trust_cash: 0, creditors: 0, debtors: 0, net_owed: 0, difference: 0, owed_to_clients: 0,
  owed_to_debtors: 0, owed_to_firm: 24055.36, unidentified: 0, owed_by_clients: 0 }
let sent = []
const handlers = [
  [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
  [(u) => /\/rpc\/payments_to_make/.test(u), () => ({ body: answer })],
  [(u) => /\/rpc\/payments_out_paid/.test(u), () => ({ body: PAID })],
  [(u) => /\/rpc\/trust_position/.test(u), () => ({ body: [POSITION] })],
  [(u) => /\/rpc\/(mark_payover_run_paid|mark_refund_paid|draw_from_trust)/.test(u),
    (u, req) => { sent.push({ fn: /\/rpc\/(\w+)/.exec(u)[1], ...req.postDataJSON() }); return { body: null } }],
  [(u) => /\/rest\/v1\//.test(u), () => ({ body: [] })],
  [(u) => /\/rpc\//.test(u), () => ({ body: [] })],
]

const server = await startServer()
const browser = await chromium.launch()
try {
  const { context, page } = await signedInPage(browser, ADMIN, handlers, [])
  await page.goto(`http://127.0.0.1:${PORT}/trust`, { waitUntil: 'domcontentloaded' })
  const link = page.getByRole('link', { name: 'Payments to make' }).first()
  await link.waitFor({ timeout: 20000 })
  t.ok('Payments to make is in the Trust menu', await link.isVisible())
  await link.click()
  await page.waitForURL(/\/trust\/payments-out/, { timeout: 10000 })
  const rows = page.getByTestId('payment-to-make')
  await rows.first().waitFor({ timeout: 15000 })
  t.check('every payment still to make is listed', await rows.count(), 3)
  t.check('the top bar names this screen, not Payments in', await page.getByRole('banner').getByText('Payments to make', { exact: true }).count().catch(() => 0) > 0
    || (await page.locator('header').first().innerText().catch(() => '')).includes('Payments to make'), true)
  const body = await page.locator('main').innerText().catch(async () => page.locator('body').innerText())
  for (const ref of ['BF PO-SMT-2610', 'BF PO-BPM-2610', 'BF RAP-124059']) t.ok(`...with its reference ${ref}`, body.includes(ref))
  t.ok('a run says when it is due', /Due 11 Nov 2026/.test(body))
  t.ok('...and whether its advice has gone', /Advice sent/.test(body))
  t.ok('a client with no banking details is said to have none', /No banking details on the client/.test(body))
  t.ok('a refund says why', /Why: The debtor asked for it back/.test(body))
  t.ok('the total is the sum', /18[\s,.]?616[.,]02/.test(await page.getByTestId('to-pay-total').innerText()))
  t.ok('it says how a payment is confirmed', /allocate the line under\s+Exceptions/.test(body))
  await t.shot(page, 'payments-out')

  /* ---- MARK PAID FROM HERE (the firm, 8 Oct: completed "from two places") ---- */
  await rows.filter({ hasText: 'Sizwe Dlamini' }).getByRole('button', { name: 'Mark paid' }).click()
  const refBox = page.getByLabel(/Reference it was paid with/)
  await refBox.waitFor({ timeout: 10000 })
  t.check('the box starts from the payment\'s own reference', await refBox.inputValue(), 'BF RAP-124059')
  await page.getByRole('button', { name: 'Mark paid' }).last().click()
  await page.waitForTimeout(500)
  t.check('a refund is marked paid with its reference', JSON.stringify({ fn: sent[0]?.fn, id: sent[0]?.p_refund, ref: sent[0]?.p_reference }),
    JSON.stringify({ fn: 'mark_refund_paid', id: 'ref-1', ref: 'BF RAP-124059' }))
  await rows.filter({ hasText: 'Summit Fitness' }).getByRole('button', { name: 'Mark paid' }).click()
  await page.getByLabel(/Reference it was paid with/).waitFor({ timeout: 10000 })
  await page.getByRole('button', { name: 'Mark paid' }).last().click()
  await page.waitForTimeout(500)
  t.check('a run is marked paid with the run\'s own call', JSON.stringify({ fn: sent[1]?.fn, id: sent[1]?.p_run, ref: sent[1]?.p_reference }),
    JSON.stringify({ fn: 'mark_payover_run_paid', id: 'run-smt', ref: 'BF PO-SMT-2610' }))

  /* ---- THE FIRM'S OWN TRANSFER ---- */
  const firm = page.getByTestId('firm-to-draw')
  t.ok('what the firm may draw is shown with its reference', /24[\s,.]?055[.,]36/.test(await firm.innerText()) && /BF FEES-\d{4}/.test(await firm.innerText()))
  await firm.getByRole('button', { name: 'Record a transfer' }).click()
  await page.getByRole('button', { name: 'Record transfer' }).waitFor({ timeout: 10000 })
  await page.getByRole('button', { name: 'Record transfer' }).click()
  await page.waitForTimeout(500)
  t.check('a transfer records the whole share by default, with the reference', JSON.stringify({ fn: sent[2]?.fn, amount: sent[2]?.p_amount, ok: /^BF FEES-\d{4}$/.test(sent[2]?.p_reference ?? '') }),
    JSON.stringify({ fn: 'draw_from_trust', amount: 24055.36, ok: true }))

  /* ---- WHAT HAS GONE OUT ---- */
  await page.getByRole('button', { name: /^Paid/ }).click()
  const gone = page.getByTestId('paid-out')
  await gone.first().waitFor({ timeout: 10000 })
  t.check('Paid lists what has gone out', await gone.count(), 2)
  t.check('...and the Paid tab is the one marked chosen', await page.getByRole('button', { name: /^Paid/ }).getAttribute('aria-pressed'), 'true')
  t.check('...not To pay', await page.getByRole('button', { name: /^To pay/ }).getAttribute('aria-pressed'), 'false')
  t.ok('...a payment marked paid waits for the statement', /Waiting for the statement/.test(await gone.filter({ hasText: 'Lowveld' }).innerText()))
  t.ok('...and one the statement confirmed says so', /On the statement 16 Sep 2026/.test(await gone.filter({ hasText: 'business account' }).innerText()))
  await t.shot(page, 'payments-out-paid')

  answer = []
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByText(/Nothing is waiting to be paid/).waitFor({ timeout: 15000 }).catch(() => {})
  t.ok('with nothing due it says so', await page.getByText(/Nothing is waiting to be paid/).isVisible())
  await context.close()
} catch (e) {
  t.ok(`the run finished without throwing (${String(e).split('\n')[0].slice(0, 160)})`, false)
  try {
    const pages = browser.contexts().flatMap((c) => c.pages())
    if (pages[0]) await t.shot(pages[0], 'payments-out-where-it-stopped')
  } catch { /* nothing more to learn */ }
} finally {
  await browser.close()
  stopServer(server)
}

const good = t.finish(`Payments to make lists every run and refund still to pay, with its reference, due date and the
total. Screenshots in ${OUT}.`)
process.exit(good ? 0 : 1)

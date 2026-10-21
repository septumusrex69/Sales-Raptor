/**
 * A CLIENT PAYS AGAINST ITS STATEMENT, IN A REAL BROWSER (S7).
 *
 * The firm, 12 Oct: "what if the client pays partially? What if he makes an installment arrangement
 * ... shouldn't we just have a statement?" -- approved 13 Oct. This holds that the client's Account
 * tab says what they owe, item by item, oldest first; that a payment is recorded against the CLIENT
 * in any amount (a part payment says what stays owed, more than owed is refused before it is sent);
 * that an arrangement is set up there and says whether it is being kept; and that the run page shows
 * owed / paid / still owed and records against the client too.
 *
 * Run: node scripts/qa/e2e/client-payments.mjs
 */
import { OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('client-payments')
const NBSP = String.fromCharCode(0xa0)
const plain = (s) => s.split(NBSP).join(' ')
const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator' }
const CO = { id: 'c1', name: 'Marula Property Group (Pty) Ltd', owner_id: ADMIN.id }
const OWED = [
  { kind: 'shortfall', id: 'r7', label: 'PO-MPG-2607', due_on: '2026-08-11', owed: 3515.66, paid: 1000, remaining: 2515.66 },
  { kind: 'invoice', id: 'ch1', label: 'INV-0021', due_on: '2026-09-02', owed: 575, paid: 0, remaining: 575 },
]
const LEDGER = [{ entry_on: '2026-08-11', kind: 'owed', description: 'Paid straight to the client', reference: null, case_number: null,
  amount: -3090.66, balance: -3090.66, run_id: null, charge_id: null }]
/* An arrangement made 1 Sep, R1 000 a month from 15 Sep; the clock is the browser's today. */
const ARR = { id: 'a1', instalment: 1000, first_due: '2026-09-15', instalments: 4, created_at: '2026-09-01T08:00:00Z', note: null }
const RUN = { id: 'r7', invoice_number: 'PO-MPG-2607', status: 'sent', period_start: '2026-06-11', period_end: '2026-07-10',
  company_id: 'c1', trust_capital: 1050, trust_commission: 262.5, due_to_client: 787.5, ptc_received: 5000, ptc_fees_taken: 0,
  ptc_capital: 0, ptc_commission: 0, due_to_bf: 0, commission_vat: 144.08, carried_in: -1253.13, charges_set_off: 0,
  excess_released: 0, net_payover: -3515.66, approved_at: '2026-08-11T08:00:00Z', sent_at: '2026-08-11T09:00:00Z', paid_at: null,
  eft_reference: null, companies: { name: CO.name, code: 'MPG', commission_rate: 0.25, vat_number: null, email: 'x@example.co.za' } }
const calls = []
const handlers = [
  [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
  [(u) => /\/rest\/v1\/firm_settings/.test(u), () => ({ body: [{ firm_name: 'Bredell Ferreira', vat_rate: 0.15 }] })],
  [(u) => /\/rest\/v1\/companies/.test(u), () => ({ body: [CO] })],
  [(u) => /\/rpc\/client_owed_items/.test(u), () => ({ body: OWED })],
  [(u) => /\/rpc\/client_ledger/.test(u), () => ({ body: LEDGER })],
  [(u) => /\/rest\/v1\/client_payment_arrangements/.test(u), () => ({ body: ARR })],
  [(u) => /\/rest\/v1\/client_business_receipts/.test(u), () => ({ body: [{ amount: 1000, received_on: '2026-09-16', reference: 'BF PO-MPG-2607' }] })],
  [(u) => /\/rest\/v1\/client_payment_applications/.test(u), () => ({ body: [{ amount: 1000, client_business_receipts: { received_on: '2026-09-16', reference: 'BF PO-MPG-2607' } }] })],
  [(u) => /\/rpc\/(record_client_payment|set_client_arrangement)/.test(u), (u, req) => { calls.push({ fn: /\/rpc\/(\w+)/.exec(u)[1], ...(req.postDataJSON() ?? {}) }); return { body: 'x' } }],
  [(u) => /\/rest\/v1\/payover_runs\?.*company_id=eq/.test(u), () => ({ body: [] })],
  [(u) => /\/rest\/v1\/payover_runs/.test(u), () => ({ body: RUN })],
  [(u) => /\/rest\/v1\//.test(u), () => ({ body: [] })],
  [(u) => /\/rpc\//.test(u), () => ({ body: [] })],
]

const server = await startServer()
const browser = await chromium.launch()
try {
  const { context, page } = await signedInPage(browser, ADMIN, handlers, [])
  await page.goto(`http://127.0.0.1:${PORT}/companies/c1`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Account', exact: true }).click({ timeout: 15000 })
  const box = page.getByTestId('client-owes')
  await box.waitFor({ timeout: 15000 })
  t.ok('the Account tab says what the client owes, in total', /R 3 090\.66/.test(plain(await page.getByTestId('client-owes-total').innerText())))
  const items = await page.getByTestId('owed-item').allInnerTexts()
  t.ok('item by item, oldest first, with what was paid and what is still owed',
    items.length === 2 && /PO-MPG-2607[\s\S]*R 3 515\.66[\s\S]*R 1 000\.00[\s\S]*R 2 515\.66/.test(plain(items[0])) && /INV-0021/.test(items[1]))

  await page.getByTestId('record-client-payment').click()
  const amount = page.getByLabel('Amount paid')
  t.check('the payment form opens on the whole amount owed', await amount.inputValue(), '3090.66')
  await amount.fill('1500')
  t.ok('a part payment says what stays owed', /R 1 590\.66 stays owed/.test(plain(await page.getByTestId('client-payment-form').innerText())))
  await amount.fill('5000')
  t.ok('more than owed is refused before it is sent', /more than they owe/.test(await page.getByTestId('client-payment-form').innerText())
    && await page.getByRole('button', { name: 'Record it' }).isDisabled())
  await amount.fill('1500')
  await page.getByLabel('Reference').fill('BF PO-MPG-2607')
  await page.getByRole('button', { name: 'Record it' }).click()
  await page.waitForTimeout(600)
  const rec = calls.find((c) => c.fn === 'record_client_payment')
  t.check('it is recorded against the CLIENT, for the amount typed',
    JSON.stringify(rec ? [rec.p_company, rec.p_amount, rec.p_reference] : null), JSON.stringify(['c1', 1500, 'BF PO-MPG-2607']))

  const status = page.getByTestId('arrangement-status')
  t.ok('the arrangement says what was agreed', /4 × R 1 000\.00 a month from 15 Sep 2026/.test(plain(await status.innerText())))
  t.ok('...and whether it is being kept, from the payments since it was made', /Behind by|Up to date|Paid in full/.test(await status.innerText()))
  await t.shot(page, 'client-payments')

  await page.getByTestId('set-arrangement').click()
  await page.getByLabel('Instalment').fill('800')
  await page.getByLabel('Number of payments').fill('4')
  await page.getByRole('button', { name: 'Replace it' }).click()
  await page.waitForTimeout(600)
  const arr = calls.find((c) => c.fn === 'set_client_arrangement')
  t.check('an arrangement is set up through the function', JSON.stringify(arr ? [arr.p_company, arr.p_instalment, arr.p_instalments] : null),
    JSON.stringify(['c1', 800, 4]))

  /* THE RUN PAGE */
  await page.goto(`http://127.0.0.1:${PORT}/trust/runs/r7`, { waitUntil: 'domcontentloaded' })
  const still = page.getByTestId('still-owed')
  await still.waitFor({ timeout: 15000 })
  t.ok('the run says owed, paid and still owed', /R 3 515\.66 owed · R 1 000\.00 paid · R 2 515\.66 still owed/.test(plain(await still.innerText())))
  t.ok('...and lists the payment against it', /R 1 000\.00 on .*BF PO-MPG-2607/.test(plain(await page.getByTestId('client-paid-us').innerText())))
  await page.getByRole('button', { name: 'Record a payment' }).click()
  t.check('...and offers the rest by default', await page.getByLabel('Amount paid').inputValue(), '2515.66')
  await context.close()
} catch (e) {
  try { const pg = browser.contexts().flatMap((c) => c.pages())[0]; if (pg) await t.shot(pg, 'client-payments-where-it-stopped') } catch { /* */ }
  t.ok(`the run finished without throwing (${e instanceof Error ? e.message.split('\n')[0] : e})`, false)
} finally {
  await browser.close()
  stopServer(server)
}
const good = t.finish(`A client pays against its statement, any amount; an arrangement says whether it is kept.
Screenshots in ${OUT}.`)
process.exit(good ? 0 : 1)

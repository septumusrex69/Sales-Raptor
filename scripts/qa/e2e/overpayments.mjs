/**
 * OVERPAYMENTS IN ONE PLACE, IN A REAL BROWSER (the firm, 11 Oct: "a separate section for like
 * overpayments").
 *
 * WHAT THIS HOLDS: the Trust rail has the item; To decide lists the undecided overpayment and opens
 * the same disposal box Exceptions does; To refund lists the decided refund with its reference and
 * marks it paid through mark_refund_paid; Parked says what parking is; Refunded lists what went out
 * and whether the statement has confirmed it.
 *
 * Run: node scripts/qa/e2e/overpayments.mjs
 */
import { OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('overpayments')
const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator' }

const JOBS = [{
  allocation_id: 'alloc-x', account_id: 'acct-x', company_id: 'c1', client: 'Karoo Linen Rentals', case_number: 'RAP-124299',
  debtor: 'Johan Pretorius', kind: 'excess_credit', problem: 'Paid R412.00 more than was owed', amount: 412,
  action: 'Decide', run_id: null, run_status: null, occurred_at: '2026-07-01',
}]
const TO_MAKE = [{ kind: 'refund', id: 'ref-1', payee: 'Sipho Dlamini', amount: 180, reference: 'BF RAP-124305', status: 'due',
  due_on: null, since: '2026-07-02T08:00:00Z', detail: 'Overpaid on settlement', company_id: 'c1', account_id: 'acct-y', case_number: 'RAP-124305' }]
const PAID = [{ kind: 'refund', id: 'ref-0', payee: 'Anna Botha', amount: 95, reference: 'BF RAP-124290', paid_at: '2026-06-20T10:00:00Z',
  paid_reference: 'BF RAP-124290', confirmed: true, statement_date: '2026-06-21', account_id: 'acct-z', case_number: 'RAP-124290' }]

const calls = []
const server = await startServer()
const browser = await chromium.launch()
try {
  const handlers = [
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
    [(u) => /\/rest\/v1\/firm_settings/.test(u), () => ({ body: { payouts_statement_only: false } })],
    [(u) => /\/rpc\/finance_exception_jobs/.test(u), () => ({ body: JOBS })],
    [(u) => /\/rpc\/payments_to_make/.test(u), () => ({ body: TO_MAKE })],
    [(u) => /\/rpc\/payments_out_paid/.test(u), () => ({ body: PAID })],
    [(u) => /\/rpc\/mark_refund_paid/.test(u), (u, req) => { calls.push(req.postDataJSON()); return { body: null } }],
    [(u) => /\/rest\/v1\//.test(u), () => ({ body: [] })],
    [(u) => /\/rpc\//.test(u), () => ({ body: [] })],
  ]
  const { page } = await signedInPage(browser, ADMIN, handlers, [])
  await page.goto(`http://127.0.0.1:${PORT}/trust/overpayments`, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('overpayments').waitFor({ timeout: 15000 })
  /* S7: overpayments live on To sort now, so the rail names that, and the old address still opens them. */
  t.ok('the Trust rail sends overpayments to To sort', (await page.getByRole('link', { name: 'To sort' }).count()) > 0)

  await page.getByTestId('overpay-undecided').first().waitFor({ timeout: 10000 })
  t.ok('To decide lists the undecided overpayment', /Johan Pretorius/.test(await page.getByTestId('overpay-undecided').first().innerText()))
  await page.getByRole('button', { name: 'Decide it' }).click()
  t.ok('...and opens the disposal box', (await page.getByText('Refund it to the debtor').count()) > 0)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Cancel' }).click().catch(() => {})

  await page.getByTestId('overpay-tab-refund').click()
  const refund = page.getByTestId('overpay-to-refund').first()
  await refund.waitFor({ timeout: 5000 })
  t.ok('To refund lists it with the reference to pay on', /BF RAP-124305/.test(await refund.innerText()))
  await refund.getByTestId('overpay-mark-paid').click()
  /* The box's reference field: the last text input on the page once it is open. */
  const ref = page.locator('input:not([type=date]):not([type=checkbox]):not([type=search])').last()
  await ref.fill('FNB 777')
  await page.getByRole('button', { name: /^Mark paid$/ }).last().click()
  await page.waitForTimeout(500)
  t.check('...and Mark paid records the refund', JSON.stringify(calls.map((c) => [c.p_refund, c.p_reference])), JSON.stringify([['ref-1', 'FNB 777']]))

  await page.getByTestId('overpay-tab-parked').click()
  const parked = await page.getByText(/not suspense/).first().waitFor({ timeout: 5000 }).then(() => true).catch(() => false)
  if (!parked) await page.screenshot({ path: `${OUT}/overpayments-parked-fail.png`, fullPage: true })
  t.ok('Parked says it is still the debtor’s, not suspense', parked)

  await page.getByTestId('overpay-tab-refunded').click()
  const done = page.getByTestId('overpay-refunded').first()
  await done.waitFor({ timeout: 5000 })
  t.ok('Refunded lists what went out and that the statement confirmed it', /Anna Botha/.test(await done.innerText()) && /Yes/.test(await done.innerText()))
  await page.screenshot({ path: `${OUT}/overpayments.png`, fullPage: true })
} finally {
  await browser.close()
  stopServer(server)
}

const good = t.finish('Overpayments in one place: To decide, To refund (with Mark paid), Parked and Refunded, on the Trust rail.')
process.exit(good ? 0 : 1)

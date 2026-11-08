/**
 * A COLLECTOR STILL SEES THE DEBTOR'S PAYMENTS, AND NOTHING OF THE SPLIT (Raptor H19 / S20; Stephan, 8 Nov: only
 * finance sees the payment split).
 *
 * account_payments and payment_allocations are finance.view only since s20_payment_split_finance_only. The stub
 * answers them the way row-level security answers a collector -- with nothing -- and serves the receipt only
 * through account_payment_lines, the view a non-finance screen reads. The account page must still draw the
 * payment on the Transactions tab and its dates, and must not ask for the split at all.
 *
 * Seen failing with fetchLedgers pointed back at account_payments (the payment vanished from the statement).
 *
 * Run: node scripts/qa/e2e/payment-split-collector.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { COMPANY, PROFILE, TEAM, USER_ID, accountsPage } from './fixtures.mjs'

const t = makeRunner('payment-split-collector')
const AGENT = { ...PROFILE, name: 'Collector', role: 'Pre-legal Agent' }
const ACCOUNT = { ...accountsPage(1)[0], id: 'acc-0000', status: 'Active: Activated', case_number: 'RAP-125310', assigned_to: USER_ID }
const PAY = {
  id: 'pay-trust', received_at: '2026-07-02T22:00:00Z', amount: 2500, paid_to_client: false, reference: 'RAP125310',
  method: 'EFT', details: null, approved_at: '2026-07-04T10:00:00Z', reversed_at: null, reversal_reason: null,
  receipt_fee_legacy: null, rejected_at: null, account_id: 'acc-0000',
}
const handlers = [
  [(u) => u.includes('/auth/v1/user'), () => ({ body: { id: USER_ID, email: AGENT.email } })],
  [(u) => u.includes('/rest/v1/profiles'), (u) => {
    const one = /id=eq\.([0-9a-f-]+)/.exec(u)?.[1]
    return { body: one ? [AGENT].filter((p) => p.id === one) : [AGENT] }
  }],
  [(u) => u.includes('/rest/v1/companies'), () => ({ body: [COMPANY] })],
  [(u) => u.includes('/rest/v1/teams'), () => ({ body: [TEAM] })],
  [(u) => u.includes('/rpc/nav_counts'), () => ({ body: { mail: 0, tasks: 0, disputes: 0, diary: 0 } })],
  /* WHAT ROW-LEVEL SECURITY GIVES A COLLECTOR: nothing from either table. */
  [(u) => /\/rest\/v1\/(account_payments|payment_allocations)\?/.test(u), () => ({ body: [] })],
  [(u) => /\/rest\/v1\/account_payment_lines\?.*select=received_at%2Ccreated_at/.test(u), () => ({ body: {
    received_at: PAY.received_at, created_at: '2026-07-03T09:15:00Z', allocated_on: '2026-07-04', approved_at: PAY.approved_at, paid_to_client: false } })],
  [(u) => /\/rest\/v1\/account_payment_lines\?.*account_id=eq\./.test(u), () => ({ body: [PAY] })],
  [(u) => u.includes('/rest/v1/debtor_accounts'), () => ({ body: [ACCOUNT], headers: { 'content-range': '0-0/1' } })],
  [(u) => /\/rest\/v1\//.test(u), () => ({ body: [] })],
  [(u) => /\/rpc\//.test(u), () => ({ body: [] })],
]

const server = await startServer()
let browser
const seen = []
try {
  browser = await chromium.launch()
  const { page } = await signedInPage(browser, AGENT, handlers, seen)
  await page.setViewportSize({ width: 1180, height: 820 })
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/accounts/${ACCOUNT.id}`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  const tab = page.getByRole('button', { name: /^Transactions/ })
  await tab.waitFor({ timeout: 20000 })
  await tab.click()
  const row = page.getByTestId('account-payment').first()
  await row.waitFor({ timeout: 10000 }).catch(() => {})
  t.check('the collector sees the payment on the statement', await page.getByTestId('account-payment').count(), 1)
  t.ok('...for its amount', /2[\s ]?500/.test(await row.innerText().catch(() => '')))
  await row.getByTestId('payment-dates').click()
  await page.getByTestId('payment-date-paid').waitFor({ timeout: 5000 })
  t.ok('...and its dates, read through the view', /03 Jul 2026/.test(await page.getByTestId('payment-date-paid').innerText()))
  t.check('the account page never asks for the split (payment_allocations)',
    seen.filter((s) => /\/rest\/v1\/payment_allocations/.test(s)).length, 0)
  t.check('...nor reads the payments table itself',
    seen.filter((s) => /\/rest\/v1\/account_payments\?/.test(s)).length, 0)
} catch (e) {
  t.ok(`the run finished without throwing (${e instanceof Error ? e.message.split('\n')[0] : String(e)})`, false)
} finally {
  await browser?.close()
  stopServer(server)
}
process.exit(t.finish() ? 0 : 1)

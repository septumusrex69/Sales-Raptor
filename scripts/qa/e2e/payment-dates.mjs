/**
 * PAID · CAPTURED · PROCESSED, ONE TAP AWAY, AND A PTC DATE THAT IS TYPED (S19; Stephan, 7 Nov: "the paid, captured,
 * and processed data for the payments ... accessible, but it doesn't have to be in your face" and "you should put in
 * the PTC date. It should be compulsory").
 *
 *  1. On an account's Transactions tab, a payment's small calendar button opens its three dates -- a late PTC
 *     (paid 3 Jul, captured 28 Jul, processed 29 Jul) says it was captured more than a week after it was paid.
 *  2. Record payment, as a PTC: the date is EMPTY (it used to say today), labelled as the day the debtor paid the
 *     client; switching back to a trust receipt still starts at today.
 *
 * Run: node scripts/qa/e2e/payment-dates.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { COMPANY, PROFILE, TEAM, USER_ID, accountsPage } from './fixtures.mjs'

const t = makeRunner('payment-dates')
const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator' }
const ACCOUNT = { ...accountsPage(1)[0], id: 'acc-0000', status: 'Active: Activated', case_number: 'RAP-125310', assigned_to: USER_ID }
const PAY = {
  id: 'pay-ptc', received_at: '2026-07-02T22:00:00Z', amount: 2500, paid_to_client: true, reference: 'PTC-0703',
  approved_at: '2026-07-29T10:00:00Z', reversed_at: null, reversal_reason: null, paid_over_in_swordfish: false, rejected_at: null, is_demo: false,
}
const handlers = [
  [(u) => u.includes('/auth/v1/user'), () => ({ body: { id: USER_ID, email: ADMIN.email } })],
  [(u) => u.includes('/rest/v1/profiles'), (u) => {
    const one = /id=eq\.([0-9a-f-]+)/.exec(u)?.[1]
    return { body: one ? [ADMIN].filter((p) => p.id === one) : [ADMIN] }
  }],
  [(u) => u.includes('/rest/v1/companies'), () => ({ body: [COMPANY] })],
  [(u) => u.includes('/rest/v1/teams'), () => ({ body: [TEAM] })],
  [(u) => u.includes('/rpc/nav_counts'), () => ({ body: { mail: 0, tasks: 0, disputes: 0, diary: 0 } })],
  /* The three dates, read for the one payment when its button is tapped. */
  [(u) => /\/rest\/v1\/account_payment(?:s|_lines)\?.*select=received_at%2Ccreated_at/.test(u), () => ({ body: {
    received_at: PAY.received_at, created_at: '2026-07-28T09:15:00Z', allocated_on: '2026-07-29', approved_at: PAY.approved_at, paid_to_client: true } })],
  [(u) => /\/rest\/v1\/account_payment(?:s|_lines)\?.*account_id=eq\./.test(u), () => ({ body: [PAY] })],
  [(u) => u.includes('/rest/v1/debtor_accounts'), () => ({ body: [ACCOUNT], headers: { 'content-range': '0-0/1' } })],
  [(u) => /\/rest\/v1\//.test(u), () => ({ body: [] })],
  [(u) => /\/rpc\//.test(u), () => ({ body: [] })],
]

const server = await startServer()
let browser
try {
  browser = await chromium.launch()
  const { page } = await signedInPage(browser, ADMIN, handlers, [])
  await page.setViewportSize({ width: 1180, height: 820 })
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/accounts/${ACCOUNT.id}`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  const tab = page.getByRole('button', { name: /^Transactions/ })
  await tab.waitFor({ timeout: 20000 })
  await tab.click()
  const btn = page.getByTestId('account-payment').first().getByTestId('payment-dates')
  await btn.waitFor({ timeout: 10000 })
  t.check('the dates are not on the row until asked for', await page.getByTestId('payment-dates-panel').count(), 0)
  await btn.click()
  const panel = page.getByTestId('payment-dates-panel')
  await page.getByTestId('payment-date-approved').waitFor({ timeout: 5000 })
  t.ok('one tap shows Paid as the debtor\'s day (3 Jul)', /03 Jul 2026/.test(await page.getByTestId('payment-date-paid').innerText()))
  t.ok('...Captured as the day it went into Raptor (28 Jul)', /28 Jul 2026/.test(await page.getByTestId('payment-date-captured').innerText()))
  t.ok('...and Approved as the day it was approved (29 Jul)', /29 Jul 2026/.test(await page.getByTestId('payment-date-approved').innerText()))
  t.check('...and says it was captured late', await panel.getByTestId('payment-captured-late').count(), 1)
  await page.mouse.click(5, 5)
  t.check('a tap elsewhere closes it', await page.getByTestId('payment-dates-panel').count(), 0)

  /* ---- Record payment as a PTC ---- */
  await page.goto(`http://localhost:${PORT}/trust/payments`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Record payment' }).click()
  const date = page.getByTestId('received-on')
  await date.waitFor({ timeout: 10000 })
  t.ok('a trust receipt still starts at today', (await date.inputValue()) !== '')
  await page.getByRole('radio').nth(1).check()
  t.check('as a PTC the date is EMPTY, never today', await date.inputValue(), '')
  t.ok('...labelled as the day the debtor paid the client', (await date.getAttribute('aria-label')) === 'Date the debtor paid the client')
  t.check('...says what date it wants', await page.getByTestId('ptc-date-needed').count(), 1)
  t.ok('...and nothing can be recorded without it', await page.getByRole('button', { name: 'Record this PTC' }).isDisabled())
  await date.fill('2026-07-03')
  t.check('typing it takes the prompt away', await page.getByTestId('ptc-date-needed').count(), 0)
} catch (e) {
  t.ok(`the run finished without throwing (${e instanceof Error ? e.message.split('\n')[0] : String(e)})`, false)
} finally {
  await browser?.close()
  stopServer(server)
}
process.exit(t.finish() ? 0 : 1)

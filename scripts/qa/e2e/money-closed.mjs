/**
 * A CLOSED ACCOUNT HAS NOTHING LEFT TO TAKE, on the account page, in a real browser (R-35 · Raptor H19).
 *
 * Rinda (Finance), 16 Nov, on BNP0013 -- closed paid up and refunded, then R50 more came in: "The full R50
 * should be available to refund, however on the what is left to take there shows R14.95 which in this case
 * will be incorrect." account_money_position now puts what was left under Cannot take on a closed account;
 * this drives the panel with that row and with the same account still open, so the note shows only when it
 * should (a warning that fires when nothing is wrong is worse than none).
 *
 * Run: node scripts/qa/e2e/money-closed.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { COMPANY, PROFILE, TEAM, accountsPage } from './fixtures.mjs'

const t = makeRunner('money-closed')
const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator' }
const ACCOUNT = { ...accountsPage(1)[0], id: 'acc-0035', status: 'Active: Activated', case_number: 'BNP0013',
  ended_as: 'paid_up', ended_on: '2026-11-10' }
/* BNP0013 as staging reads it after the fix: two R14.95 correspondence fees raised after the close. */
const POSITION = (closed) => ({
  account_id: ACCOUNT.id, company_id: COMPANY.id, case_number: 'BNP0013', account_number: '2192CE', status: 'Active: Activated',
  capital_handed_over: 537.25, capital_outstanding: 0, capital_taken: 537.25,
  interest_charged: 108.86, interest_taken: 108.86, interest_left: 0, interest_cant_take: 0,
  costs_charged: 221.96, costs_taken: 192.06, costs_left: closed ? 0 : 29.9, costs_cant_take: closed ? 29.9 : 0,
  receipt_fees_charged: 96.39, receipt_fees_taken: 96.39, receipt_fees_left: 0, receipt_fees_cant_take: 0,
  commission_earned: 154.46, commission_potential: 0, commission_rate: 0.25,
  cost_cap: 537.25, cost_cap_used: 193, cost_cap_headroom: 344.25, in_duplum: false, in_duplum_ceiling: 537.25,
  excess_credit: 65.44, payments_allocated: 1000, bf_left_to_take: closed ? 0 : 29.9, account_closed: closed,
})

async function open(closed) {
  const handlers = [
    [(u) => u.includes('/auth/v1/user'), () => ({ body: { id: ADMIN.id, email: ADMIN.email } })],
    [(u) => u.includes('/rest/v1/profiles'), () => ({ body: [ADMIN] })],
    [(u) => u.includes('/rest/v1/companies'), () => ({ body: [COMPANY] })],
    [(u) => u.includes('/rest/v1/teams'), () => ({ body: [TEAM] })],
    [(u) => u.includes('/rpc/nav_counts'), () => ({ body: { mail: 0, tasks: 0, disputes: 0, diary: 0 } })],
    [(u) => u.includes('/rpc/money_position'), () => ({ body: [POSITION(closed)] })],
    [(u) => u.includes('/rest/v1/debtor_accounts'), () => ({ body: [ACCOUNT], headers: { 'content-range': '0-0/1' } })],
  ]
  const { page } = await signedInPage(browser, ADMIN, handlers, [])
  await page.setViewportSize({ width: 1180, height: 900 })
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/accounts/${ACCOUNT.id}`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  await page.getByText('What is left to take').waitFor({ timeout: 20000 })
  return { page }
}

const server = await startServer()
let browser
try {
  browser = await chromium.launch()
  {
    const { page } = await open(true)
    const costs = page.locator('tr', { hasText: 'Costs · items 1–7' })
    const cells = (await costs.locator('td').allInnerTexts()).map((s) => s.replace(/\u00a0/g, ' ').trim())
    t.check('closed: costs Left is nil', cells[3], 'R 0.00')
    t.check('...and the R29.90 sits under Cannot take', cells[4], 'R 29.90')
    const total = page.locator('tr', { hasText: 'BF left to take' })
    t.ok('BF left to take is nil', /R 0\.00/.test((await total.innerText()).replace(/\u00a0/g, ' ')))
    const note = page.getByTestId('money-closed')
    t.check('the panel says the account is closed', await note.count(), 1)
    t.ok('...and that money now is the debtor\'s credit to refund', /debtor's credit, to refund or move/.test(await note.innerText()))
    await note.scrollIntoViewIfNeeded()
    await t.shot(page, 'money-closed')
    await page.close()
  }
  {
    const { page } = await open(false)
    t.check('open: no closed note', await page.getByTestId('money-closed').count(), 0)
    const cells = (await page.locator('tr', { hasText: 'Costs · items 1–7' }).locator('td').allInnerTexts()).map((s) => s.replace(/\u00a0/g, ' ').trim())
    t.check('...and costs Left reads as before', cells[3], 'R 29.90')
    await page.close()
  }
} catch (e) {
  t.ok(`the run finished without throwing (${e instanceof Error ? e.message.split('\n')[0] : String(e)})`, false)
} finally {
  await browser?.close()
  stopServer(server)
}
process.exit(t.finish() ? 0 : 1)

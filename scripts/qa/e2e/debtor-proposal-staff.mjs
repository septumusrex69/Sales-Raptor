/**
 * A DEBTOR'S ARRANGEMENT OFFER, ON THE COLLECTOR'S SCREEN (Raptor H16, debtor portal part 3).
 *
 * The offer is on the account page where a collector will see it -- a card nobody can find is the failure CLAUDE.md
 * describes this layer existing for -- and Accept records the promise through the collector's own path BEFORE the
 * offer is marked accepted; Decline will not go without a reason the debtor will read.
 *
 * Run: node scripts/qa/e2e/debtor-proposal-staff.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { COMPANY, PROFILE, TEAM, USER_ID, accountsPage } from './fixtures.mjs'

const t = makeRunner('debtor-proposal-staff')
const ACCOUNT = { ...accountsPage(1)[0], id: 'acc-0000', status: 'Active: Activated', case_number: 'RAP-125318', debtor_first_name: 'Tumelo' }
const OFFER = { id: 'prop-1', arrangement: 'monthly', amount: 500, first_due_on: '2026-11-25', note: 'I get paid on the 25th', balance_then: 4000, created_at: '2026-11-03T07:30:00Z' }
const order = []
let promiseBody = null
let decided = null
/* First an APPLICATION whose assessment the debtor has not signed, then an ordinary offer to accept. */
let application = true
const handlers = [
  [(u, req) => u.includes('/rest/v1/debtor_arrangement_proposals') && req.method() === 'PATCH', (u, req) => { order.push('offer'); decided = req.postDataJSON(); return { status: 200, body: [] } }],
  [(u) => u.includes('/rest/v1/debtor_arrangement_proposals'), () => ({ body: decided ? [] : [application ? { ...OFFER, amount: 100, needs_assessment: true, signing_token: 'tok-1' } : OFFER] })],
  [(u) => u.includes('/rest/v1/signing_requests'), () => ({ body: [{ state: 'sent' }] })],
  [(u, req) => u.includes('/rest/v1/promises_to_pay') && req.method() === 'POST', (u, req) => {
    order.push('promise'); promiseBody = req.postDataJSON()
    return { status: 201, body: { id: 'ptp-1', account_id: ACCOUNT.id, amount: 500, due_on: '2026-11-25', status: 'open', arrangement: 'monthly', day_of_month: 25, on_last_day: false, day_of_week: null, instalments_kept: 0, created_at: '2026-11-03T08:00:00Z' } }
  }],
  [(u, req) => u.includes('/rest/v1/account_fees') && req.method() === 'POST', () => { order.push('fee'); return { status: 201, body: [] } }],
  [(u) => u.includes('/auth/v1/user'), () => ({ body: { id: USER_ID, email: PROFILE.email } })],
  [(u) => u.includes('/rest/v1/profiles'), (u) => { const one = /id=eq\.([0-9a-f-]+)/.exec(u)?.[1]; return { body: one ? [PROFILE].filter((p) => p.id === one) : [PROFILE] } }],
  [(u) => u.includes('/rest/v1/companies'), () => ({ body: [COMPANY] })],
  [(u) => u.includes('/rest/v1/teams'), () => ({ body: [TEAM] })],
  [(u) => u.includes('/rpc/account_charge_basis'), () => ({ body: { capital: 400000, spent_on_item: 0, towards_ceiling: 0 } })],
  [(u) => u.includes('/rpc/nav_counts'), () => ({ body: { mail: 0, tasks: 0, disputes: 0, diary: 0 } })],
  [(u) => u.includes('/rest/v1/debtor_accounts'), () => ({ body: [ACCOUNT], headers: { 'content-range': '0-0/1' } })],
]

const server = await startServer()
let browser
try {
  browser = await chromium.launch()
  const { page } = await signedInPage(browser, PROFILE, handlers, [])
  await page.setViewportSize({ width: 1280, height: 900 })
  let up = false
  for (let i = 0; i < 60 && !up; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/accounts/${ACCOUNT.id}`, { timeout: 2000 }); up = true }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  {
    const app = page.getByTestId('debtor-proposal')
    await app.waitFor({ timeout: 20000 })
    t.ok('an application says so, and that the assessment is waiting for the debtor', /applied for an arrangement/.test(await app.innerText())
      && /waiting for the debtor to fill it in and sign/.test(await page.getByTestId('debtor-proposal-assessment').innerText()))
    t.ok('...and cannot be accepted until it is signed', await app.getByRole('button', { name: 'Accept' }).isDisabled())
    await t.shot(page, 'debtor-proposal-staff-application')
  }
  application = false
  await page.reload()
  const card = page.getByTestId('debtor-proposal')
  await card.waitFor({ timeout: 20000 })
  t.ok('the offer is on the account page, and visible', await card.isVisible())
  const text = await card.innerText()
  t.ok('...saying what was offered, in the debtor\'s words too', /a month from 25 November 2026/.test(text) && /I get paid on the 25th/.test(text) && /Nothing is agreed until you accept/.test(text))
  await t.shot(page, 'debtor-proposal-staff')

  await card.getByRole('button', { name: 'Decline…' }).click()
  t.ok('declining needs a reason the debtor will read', await card.getByRole('button', { name: 'Decline the offer' }).isDisabled())
  await card.getByRole('button', { name: 'Back' }).click()

  await card.getByRole('button', { name: 'Accept' }).click()
  await page.getByTestId('debtor-proposal-done').waitFor({ timeout: 10000 })
  t.ok(`accepting records the promise first, then marks the offer (${order.join(' → ')})`, order.indexOf('promise') >= 0 && order.indexOf('promise') < order.indexOf('offer'))
  t.ok('...as the debtor offered it: monthly, R500, from the 25th, on the 25th', promiseBody?.arrangement === 'monthly' && Number(promiseBody?.amount) === 500 && promiseBody?.due_on === '2026-11-25' && promiseBody?.day_of_month === 25)
  t.ok('...charged item 5, as a collector\'s own promise is', order.includes('fee'))
  t.ok('...and the offer is marked accepted, with the promise it became', decided?.status === 'accepted' && decided?.promise_id === 'ptp-1')
} catch (e) {
  try { const pg = browser?.contexts().flatMap((c) => c.pages())[0]; if (pg) await t.shot(pg, 'debtor-proposal-staff-where-it-stopped') } catch { /* */ }
  t.ok(`the run finished without throwing (${e instanceof Error ? e.message.split('\n')[0] : e})`, false)
} finally {
  await browser?.close()
  stopServer(server)
}
process.exit(t.finish('A debtor\'s offer is on the account page, and Accept records it as the collector\'s own promise.') ? 0 : 1)

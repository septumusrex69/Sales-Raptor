/**
 * THE SMS TAB ON A DEBTOR'S ACCOUNT, in a real browser (R-10, Call centre, 27 Oct).
 *
 * The request: "the clerk can also view the sms that was sent as well as add the time when the sms
 * was sent." check-account-sms.mjs proves the time arithmetic; this proves the tab is on the page,
 * counts the messages and shows the words and the time of each.
 *
 * Run: node scripts/qa/e2e/account-sms.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { COMPANY, PROFILE, TEAM, USER_ID, accountsPage } from './fixtures.mjs'

const t = makeRunner('account-sms')
const ACCOUNT = { ...accountsPage(1)[0], id: 'acc-0000', status: 'Active: Activated', case_number: 'BF-004321' }
const SMS = [
  { id: 'sms-2', direction: 'outbound', msisdn: '0645498432', body: 'Section 129 notice: please contact us on 011 592 0520.', segments: 1, status: 'delivered', status_detail: null, sent_at: '2026-10-27T12:32:00Z', delivered_at: '2026-10-27T12:32:09Z', created_at: '2026-10-27T12:31:58Z' },
  { id: 'sms-1', direction: 'outbound', msisdn: '0645498432', body: 'Welcome: your account has been handed over.', segments: 1, status: 'sent', status_detail: null, sent_at: '2026-10-27T22:30:00Z', delivered_at: null, created_at: '2026-10-27T22:29:58Z' },
]
const seen = []
const handlers = [
  [(u) => u.includes('/auth/v1/user'), () => ({ body: { id: USER_ID, email: PROFILE.email } })],
  [(u) => u.includes('/rest/v1/profiles'), (u) => {
    const one = /id=eq\.([0-9a-f-]+)/.exec(u)?.[1]
    return { body: one ? [PROFILE].filter((p) => p.id === one) : [PROFILE] }
  }],
  [(u) => u.includes('/rest/v1/companies'), () => ({ body: [COMPANY] })],
  [(u) => u.includes('/rest/v1/teams'), () => ({ body: [TEAM] })],
  [(u) => u.includes('/rpc/nav_counts'), () => ({ body: { mail: 0, tasks: 0, disputes: 0, diary: 0 } })],
  [(u) => u.includes('/rest/v1/sms_messages'), () => ({ body: SMS })],
  [(u) => u.includes('/rest/v1/debtor_accounts'), () => ({ body: [ACCOUNT], headers: { 'content-range': '0-0/1' } })],
]

const server = await startServer()
let browser
try {
  browser = await chromium.launch()
  const { page } = await signedInPage(browser, PROFILE, handlers, seen)
  await page.setViewportSize({ width: 1280, height: 900 })
  let up = false
  for (let i = 0; i < 60 && !up; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/accounts/${ACCOUNT.id}`, { timeout: 2000 }); up = true }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  t.ok('the account opens', up)

  const tab = page.getByRole('button', { name: /^SMS\s*\d+$/ })
  await tab.waitFor({ timeout: 20000 })
  t.ok('the account has an SMS tab, with the count on it', /2/.test(await tab.innerText()))
  await tab.click()
  const rows = page.getByTestId('sms-row')
  await rows.first().waitFor({ timeout: 5000 }).catch(() => {})
  t.check('both messages are listed', await rows.count(), 2)
  const first = await rows.nth(0).innerText()
  t.ok(`the words are shown in full (${first.slice(0, 60)}…)`, first.includes('Section 129 notice: please contact us on 011 592 0520.'))
  t.ok('...with the time it went, in Johannesburg', first.includes('27 Oct 2026 · 14:32'))
  t.ok('...and where it got to', first.includes('Delivered'))
  t.ok('a message at 22:30 UTC is dated half past midnight on the 28th', (await rows.nth(1).innerText()).includes('28 Oct 2026 · 00:30'))
  t.ok('the tab reads this account\'s messages', seen.some((s) => /GET \/rest\/v1\/sms_messages.*account_id=eq\.acc-0000/.test(s)))
} catch (e) {
  t.ok(`the run finished without throwing (${e instanceof Error ? e.message : String(e)})`, false)
} finally {
  await browser?.close()
  await stopServer(server)
}
t.finish('An account shows every SMS in full with the time it went.')

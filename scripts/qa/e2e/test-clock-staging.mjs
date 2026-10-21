/**
 * THE TEST CLOCK ON EVERY STAGING ACCOUNT (S9, 20 Oct). The firm: "my forward to the next workflow
 * function for testing has been gone ... you can add this for every single person that is going to
 * be testing ... in the staging environment ... when we go live, then we will take it off."
 *
 * It had gone because staging's book was reloaded and no account carried the test flag. Now a
 * staging database makes every account a test account; anywhere else the flag still decides. Here:
 * an ordinary, UNFLAGGED account opened by a collector shows "Next step now" when the clock says
 * staging, and does not when it says production.
 *
 * Run: node scripts/qa/e2e/test-clock-staging.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { COMPANY, PROFILE, TEAM, USER_ID, accountsPage } from './fixtures.mjs'

const t = makeRunner('test-clock-staging')
const ACCOUNT = { ...accountsPage(1)[0], id: 'acc-0000', status: 'Active: Activated', is_test_account: false, account_number: 'LDT-00341' }
const COLLECTOR = { ...PROFILE, role: 'Collector' }
const clockOf = (staging) => ({
  business_now: '2026-10-20T08:00:00Z', business_today: '2026-10-20', real_now: '2026-10-20T08:00:00Z',
  real_today: '2026-10-20', staging, moved: false,
})
const handlersFor = (staging) => [
  [(u) => u.includes('/auth/v1/user'), () => ({ body: { id: USER_ID, email: COLLECTOR.email } })],
  [(u) => u.includes('/rest/v1/profiles'), () => ({ body: [COLLECTOR] })],
  [(u) => u.includes('/rpc/raptor_clock'), () => ({ body: [clockOf(staging)] })],
  [(u) => u.includes('/rest/v1/companies'), () => ({ body: [COMPANY] })],
  [(u) => u.includes('/rest/v1/teams'), () => ({ body: [TEAM] })],
  [(u) => u.includes('/rpc/nav_counts'), () => ({ body: { mail: 0, tasks: 0, disputes: 0, diary: 0 } })],
  [(u) => u.includes('/rest/v1/debtor_accounts'), () => ({ body: [ACCOUNT], headers: { 'content-range': '0-0/1' } })],
]

const server = await startServer()
const browser = await chromium.launch()
try {
  for (const staging of [true, false]) {
    const { context, page } = await signedInPage(browser, COLLECTOR, handlersFor(staging), [])
    await page.setViewportSize({ width: 1366, height: 1600 })
    for (let i = 0; i < 60; i += 1) {
      try { await page.goto(`http://localhost:${PORT}/accounts/${ACCOUNT.id}`, { timeout: 2000 }); break }
      catch { await new Promise((r) => setTimeout(r, 500)) }
    }
    await page.getByText('LDT-00341').first().waitFor({ timeout: 20000 }).catch(() => {})
    await page.waitForTimeout(1500)
    const shown = await page.getByRole('button', { name: /Next step now/ }).count()
    if (staging) t.check('on staging, a collector gets "Next step now" on an ordinary, unflagged account', shown, 1)
    else t.check('off staging, the same account offers no test clock', shown, 0)
    await context.close()
  }
} catch (e) {
  t.ok(`the run finished without throwing (${String(e).slice(0, 200)})`, false)
} finally {
  await browser.close()
  await stopServer(server)
}
process.exit(t.finish('On staging every account carries the test clock, for everybody testing; elsewhere only flagged test accounts do.') ? 0 : 1)

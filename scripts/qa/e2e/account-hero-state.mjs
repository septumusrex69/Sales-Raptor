/**
 * THE ACCOUNT'S STATE SITS UNDER THE PRE-LEGAL AGENT, IN WORDS (S19; Stephan, 7 Nov, ringing "Active: Activated" on
 * the account banner: "what does that mean? ... it's a live account ... we can put that maybe right under the
 * pre-legal agent ... it just looks up there").
 *
 * "Active: Activated" is Swordfish's status and its provenance in one string; the pill now says "Active", with how
 * it became live on the hover, and it sits directly under the agent in the band's top right.
 *
 * Run: node scripts/qa/e2e/account-hero-state.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { COMPANY, PROFILE, TEAM, USER_ID, accountsPage } from './fixtures.mjs'

const t = makeRunner('account-hero-state')
const ACCOUNT = { ...accountsPage(1)[0], id: 'acc-0000', status: 'Active: Activated', case_number: 'RAP-125310', assigned_to: USER_ID }
const handlers = [
  [(u) => u.includes('/auth/v1/user'), () => ({ body: { id: USER_ID, email: PROFILE.email } })],
  [(u) => u.includes('/rest/v1/profiles'), (u) => {
    const one = /id=eq\.([0-9a-f-]+)/.exec(u)?.[1]
    return { body: one ? [PROFILE].filter((p) => p.id === one) : [PROFILE] }
  }],
  [(u) => u.includes('/rest/v1/companies'), () => ({ body: [COMPANY] })],
  [(u) => u.includes('/rest/v1/teams'), () => ({ body: [TEAM] })],
  [(u) => u.includes('/rpc/nav_counts'), () => ({ body: { mail: 0, tasks: 0, disputes: 0, diary: 0 } })],
  [(u) => u.includes('/rest/v1/debtor_accounts'), () => ({ body: [ACCOUNT], headers: { 'content-range': '0-0/1' } })],
]

const server = await startServer()
let browser
try {
  browser = await chromium.launch()
  const { page } = await signedInPage(browser, PROFILE, handlers, [])
  await page.setViewportSize({ width: 1180, height: 820 })
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/accounts/${ACCOUNT.id}`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  const agent = page.getByTestId('hero-agent')
  await agent.waitFor({ timeout: 20000 })
  const pill = page.getByTestId('hero-state').getByTestId('status-pill')
  t.check('the pill says Active, not "Active: Activated"', (await pill.innerText()).trim(), 'Active')
  t.ok('...and the hover says what that means', /live account, being worked \(live since it was loaded\)/.test(await pill.getAttribute('title') ?? ''))
  t.check('"Activated" is nowhere on the banner', await page.locator('.app-hero').getByText('Activated').count(), 0)
  const a = await agent.boundingBox()
  const p = await pill.boundingBox()
  const row = await page.getByTestId('hero-state').boundingBox()   // "Active", then "in duplum" or "prescribed" beside it
  t.ok(`the state sits under the agent (agent ends ${Math.round(a.y + a.height)}, pill starts ${Math.round(p.y)})`, p.y >= a.y + a.height - 1)
  t.ok(`...right-aligned with it (right edges ${Math.round(a.x + a.width)} / ${Math.round(row.x + row.width)})`, Math.abs((a.x + a.width) - (row.x + row.width)) <= 2)
  await t.shot(page, 'account-hero-state')
} catch (e) {
  t.ok(`the run finished without throwing (${e instanceof Error ? e.message.split('\n')[0] : String(e)})`, false)
} finally {
  await browser?.close()
  stopServer(server)
}
process.exit(t.finish() ? 0 : 1)

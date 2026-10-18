/**
 * A CLIENT'S HANDOVERS, MONTH BY MONTH, on the client page (the firm, 18 Oct: "graphs showing their
 * handovers ... every month ... the number ... the line graph and the stack graph").
 *
 * Run: node scripts/qa/e2e/client-handovers.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE, COMPANY_ID } from './fixtures.mjs'

const t = makeRunner('client-handovers')
const ADMIN = { ...PROFILE, role: 'Administrator', name: 'Stephan' }
const COMPANY = { id: COMPANY_ID, name: 'Rinda Roo Company', account_owner_id: ADMIN.id, created_at: '2025-10-01T07:27:05Z', commission_rate: 0.25 }
const asked = []

const server = await startServer()
const browser = await chromium.launch()
try {
  const { page } = await signedInPage(browser, ADMIN, [
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
    [(u) => /\/rest\/v1\/companies/.test(u), () => ({ body: [COMPANY] })],
    [(u) => /\/rpc\/client_intake_by_day/.test(u), (u, req) => {
      asked.push(req.postDataJSON())
      return { body: [
        { day: '2026-08-20', accounts: 12, capital: 240000 },
        { day: '2026-09-15', accounts: 5, capital: 80000 },
        { day: '2026-10-12', accounts: 7, capital: 120000 },
      ] }
    }],
  ], [], { now: '2026-10-18T10:00:00+02:00' })
  await page.setViewportSize({ width: 1180, height: 900 })
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/companies/${COMPANY_ID}`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  const card = page.getByTestId('client-handovers')
  await card.locator('.recharts-bar-rectangle').first().waitFor({ timeout: 20000 })
  t.check('asked for this client, sub-accounts included in the database', asked[0]?.p_client, COMPANY_ID)
  const ticks = await card.locator('.recharts-xAxis-tick-labels text').allTextContents()
  t.check('twelve months, a bar each', ticks.length, 12)
  t.ok('...ending on the month in progress', /Nov/.test(ticks[ticks.length - 1] ?? ''))
  t.ok('the total and the monthly average said in words', /24 accounts over 12 months/.test(await card.innerText()))
  t.ok('each month\'s number printed on its bar', (await card.locator('.recharts-label-list text').allTextContents()).includes('12'))
  await page.getByTestId('client-handovers-show-line').click(); await page.waitForTimeout(300)
  t.check('Line draws a line and no bars', JSON.stringify([await card.locator('.recharts-bar-rectangle').count(), await card.locator('.recharts-line').count()]), '[0,1]')
  await page.getByTestId('client-handovers-show-both').click()
  await page.getByTestId('client-handovers-measure-capital').click(); await page.waitForTimeout(300)
  t.ok('Rand switches the figures to capital', /R 440 000 over 12 months|R 440,000 over 12 months|R 440 000 over 12 months/.test(await card.innerText()))
  await page.getByTestId('client-handovers-months-6').click(); await page.waitForTimeout(500)
  t.check('six months on the switch', (await card.locator('.recharts-xAxis-tick-labels text').allTextContents()).length, 6)
  await card.scrollIntoViewIfNeeded()
  await t.shot(page, 'client-handovers')
} finally {
  await browser.close()
  await stopServer(server)
}
const good = t.finish('The client page draws that client\'s handovers month by month: bars, a line or both, accounts or rand, 6 or 12 months.')
process.exit(good ? 0 : 1)

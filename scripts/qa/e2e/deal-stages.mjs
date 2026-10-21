/**
 * TICK SEVERAL STAGES ON DEALS (the firm, 18 Oct: "tick them, for example, to filter them").
 *
 * Run: node scripts/qa/e2e/deal-stages.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('deal-stages')
const ADMIN = { ...PROFILE, role: 'Administrator' }
const deal = (n, stage, kind = 'Service') => ({
  id: `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`, name: `Deal ${stage} ${n}`, owner_id: ADMIN.id, stage, value: 1000 * n,
  kind, service: kind === 'Handover' ? 'Debt Collection' : 'Contract Drafting', source: 'Website',
  expected_close_date: '2026-10-30T00:00:00Z', created_at: `2026-10-0${n}T09:00:00Z`, won_at: stage === 'Won' ? '2026-10-12T09:00:00Z' : null,
})
const DEALS = [deal(1, 'New Deal'), deal(2, 'Quotation Sent'), deal(3, 'Mandate Sent', 'Handover'), deal(4, 'Won'), deal(5, 'Rejected')]

const server = await startServer()
const browser = await chromium.launch()
try {
  const { page } = await signedInPage(browser, ADMIN, [
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
    [(u) => /\/rest\/v1\/deals/.test(u), () => ({ body: DEALS })],
  ], [])
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/deals?view=table`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  await page.getByTestId('stage-picker').waitFor({ timeout: 20000 })
  const names = async () => (await page.locator('tbody a[href^="/deals/"]').allTextContents()).map((x) => x.trim()).sort()
  t.check('every stage to start', (await names()).length, 5)
  await page.getByTestId('stage-picker').click()
  await page.getByRole('checkbox', { name: 'Quotation Sent' }).check()
  await page.getByRole('checkbox', { name: 'Mandate Sent' }).check()
  await page.waitForTimeout(300)
  t.check('two stages ticked: only theirs', JSON.stringify(await names()), JSON.stringify(['Deal Mandate Sent 3', 'Deal Quotation Sent 2']))
  t.check('...and the button says how many', (await page.getByTestId('stage-picker').innerText()).replace(/\s*▾/, ''), '2 stages')
  await page.getByRole('button', { name: 'All stages' }).click()
  await page.waitForTimeout(300)
  t.check('All stages clears them', (await names()).length, 5)
  await page.goto(`http://localhost:${PORT}/deals?stage=Won`)
  await page.getByTestId('stage-picker').waitFor({ timeout: 20000 })
  await page.waitForTimeout(500)
  t.check('a drill-down link with one stage still works', JSON.stringify(await names()), JSON.stringify(['Deal Won 4']))
} finally {
  await browser.close()
  await stopServer(server)
}
const good = t.finish('Deals filter on several ticked stages at once.')
process.exit(good ? 0 : 1)

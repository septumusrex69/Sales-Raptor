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
    [(u) => /\/rpc\/client_account_outcomes/.test(u), () => ({ body: [
      { outcome: 'recovered', accounts: 2, capital: 10000, collected: 10000 },
      { outcome: 'active', accounts: 6, capital: 30000, collected: 2000 },
      { outcome: 'closed', accounts: 2, capital: 10000, collected: 0 },
    ] })],
    [(u) => /\/rest\/v1\/debtor_accounts/.test(u), () => ({ body: [
      { status: 'Active', sub_status: 'Promise To Pay', bucket: null },
      { status: 'Active', sub_status: 'Promise To Pay', bucket: null },
      { status: 'Active', sub_status: 'Tracing', bucket: null },
      { status: 'Active', sub_status: null, bucket: null },
      { status: 'Active', sub_status: null, bucket: null },
      { status: 'Active', sub_status: null, bucket: null },
    ] })],
    [(u) => /\/rpc\/client_intake_by_day/.test(u), (u, req) => {
      asked.push(req.postDataJSON())
      return { body: [
        { day: '2024-03-02', accounts: 3, capital: 30000 },
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
  t.ok('the pinned axis prints its amounts', (await card.locator('.recharts-yAxis-tick-labels text').allTextContents()).filter((x) => x.trim()).length >= 3)
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
  /* TWO RINGS (the firm, 18 Oct): what became of the accounts with the recovery rate, withdrawn out;
     and where the active ones stand. */
  const rings = page.getByTestId('client-rings')
  await rings.waitFor({ timeout: 15000 })
  const outcomes = (await page.getByTestId('client-ring-outcomes').innerText()).replace(/\s+/g, ' ')
  t.ok('recovered, active, closed with their shares', /Recovered 2 20%/.test(outcomes) && /Active 6 60%/.test(outcomes) && /Closed 2 20%/.test(outcomes))
  /* THE RING COUNTS ACCOUNTS AND SAYS SO; the rate is rands, beside it, with its own bar (19 Oct). */
  t.ok('...the ring’s centre is the accounts it counts', /^10 ACCOUNTS/.test(outcomes) && !/RECOVERY RATE/.test(outcomes))
  const rate = (await page.getByTestId('client-recovery-rate').innerText()).replace(/\s+/g, ' ')
  t.ok('...and the recovery rate beside it: R12 000 of R50 000', /Recovered 24%/.test(rate) && /R 12\s?000 collected of R 50\s?000 handed over/.test(rate.replace(/\u00a0/g, ' ')))
  const positions = (await page.getByTestId('client-ring-positions').innerText()).replace(/\s+/g, ' ')
  t.ok('the active accounts by where they stand, busiest first', /^6 ACTIVE/.test(positions) && positions.indexOf('In progress') < positions.indexOf('Arranged') && /Tracing 1 17%/.test(positions))
  await rings.scrollIntoViewIfNeeded()
  await t.shot(page, 'client-rings')
  /* TWELVE MONTHS FIT THE CARD, AND THE SCALE CLIMBS IN EQUAL STEPS (19 Oct): the oldest month's name
     was cut off at the left edge ("an 26") and the axis read 0, 8, 16, 24, 30. */
  await page.getByTestId('client-handovers-months-12').click(); await page.waitForTimeout(700)
  const fit = await page.getByTestId('client-handovers-scroll').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
  t.check('twelve months fit the card, with nothing scrolled off', fit, true)
  const yTicks = (await card.locator('.recharts-yAxis-tick-labels text').allTextContents()).map((v) => Number(v.replace(/\D/g, '')))
  const steps = yTicks.slice(1).map((v, i) => v - yTicks[i])
  t.ok(`...and the scale climbs in equal steps (${yTicks.join(', ')})`, yTicks.length === 5 && steps.every((d) => d === steps[0] && d > 0))
  /* ALL TIME, AND IT SLIDES ("an option to view the accounts for all time ... slide from left to right.
     Don't try to cram"). From the first handover, every month the same width, opened on the latest. */
  await page.getByTestId('client-handovers-months-all').click(); await page.waitForTimeout(700)
  const allTicks = await card.locator('.recharts-xAxis-tick-labels text').allTextContents()
  t.ok('All time starts at the client\'s first handover', allTicks[0] === 'Mar 24' && allTicks.length >= 30)
  const scroll = await page.getByTestId('client-handovers-scroll').evaluate((el) => ({ wide: el.scrollWidth > el.clientWidth + 50, atEnd: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 }))
  t.check('...too many months to fit, so it slides sideways rather than squeezing', scroll.wide, true)
  t.check('...opened on the most recent months', scroll.atEnd, true)
  t.ok('...and the words say all time', /over \d+ months, all time/.test(await card.innerText()))
  await card.scrollIntoViewIfNeeded()
  await t.shot(page, 'client-handovers')
} finally {
  await browser.close()
  await stopServer(server)
}
const good = t.finish('The client page draws that client\'s handovers month by month: bars, a line or both, accounts or rand, 6 or 12 months.')
process.exit(good ? 0 : 1)

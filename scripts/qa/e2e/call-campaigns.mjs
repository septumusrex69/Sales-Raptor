/**
 * CALL CAMPAIGNS, IN A REAL BROWSER (S10, 21 Oct).
 *
 * check-call-campaigns holds the rules; this holds the screen that reaches them.
 *
 * WHAT THIS HOLDS:
 *   1. The campaign box offers Call beside SMS and email, and Call opens the call box.
 *   2. Spread asks for a last day and a place on the day; the preview sends exactly those, the
 *      ticked account and the script, and draws whose diary gets how many and who goes over.
 *   3. Start sends the name and lands on Campaigns, where a call campaign reads worked / waiting /
 *      missed, and the page does NOT push it through the message sender.
 *   4. Now needs no end date and says it goes above everything.
 *
 * Run: node scripts/qa/e2e/call-campaigns.mjs
 */
import { OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { COMPANY, PROFILE, accountsPage } from './fixtures.mjs'

const t = makeRunner('call-campaigns')
const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator' }
const ROWS = accountsPage(3).map((r) => ({ ...r, status: 'Active: Activated', book: 'active' }))

const PREVIEW = {
  ok: true, selected: 1, found: 1, outOfScope: 0, placing: 1, unplaced: 0, skipped: 0, skips: [],
  collectors: [{ name: 'Itumeleng', calls: 1, unplaced: 0, over: 0 }], overCollectors: 0,
  today: '2026-11-02', endsOn: '2026-11-06', dateProblem: null,
}
const CAMPAIGN = {
  id: 'camp-call', name: 'Month-end settlement push', channel: 'call', status: 'sending', created_at: '2026-11-02T08:00:00Z',
  created_by: ADMIN.id, created_by_name: 'Stephan', team_id: null, selected: 1, to_send: 1, fee_estimate: '0', note: null,
  call_mode: 'spread', call_rank: 15, ends_on: '2026-11-06', unplaced: 0,
}

function handlers(profile) {
  return [
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [profile] })],
    [(u) => /\/rest\/v1\/companies/.test(u), () => ({ body: [COMPANY] })],
    [(u) => /\/rest\/v1\/debtor_accounts/.test(u), () => ({
      body: ROWS, headers: { 'content-range': `0-${ROWS.length - 1}/${ROWS.length}` },
    })],
    [(u) => /\/rest\/v1\/message_templates/.test(u), () => ({ body: [] })],
    [(u) => /\/rest\/v1\/campaigns/.test(u), () => ({ body: [CAMPAIGN] })],
    [(u) => /\/rpc\/campaign_counts/.test(u), () => ({
      body: [{ campaign_id: 'camp-call', pending: 3, sending: 0, sent: 2, skipped: 1, failed: 0, cancelled: 1, fees: 0 }],
    })],
  ]
}

const calls = []
async function stubApi(page, preview = PREVIEW) {
  await page.route('**/api/workflow/campaign', async (route) => {
    const body = route.request().postDataJSON() ?? {}
    calls.push(body)
    const reply = body.op === 'call-preview' ? preview
      : body.op === 'call-create' ? { ok: true, campaignId: 'camp-call', placing: 1, skipped: 0, unplaced: 0 }
        : { ok: true, outsideHours: null, sent: 0, skipped: 0, failed: 0, returned: 0, campaigns: [] }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) })
  })
}

async function go(page, path) {
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}${path}`, { timeout: 2000 }); return }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
}

async function openCallBox(page) {
  await go(page, '/accounts?book=active')
  const box = page.locator('table tbody input[type="checkbox"]').first()
  await box.waitFor({ timeout: 20000 })
    .catch(async (e) => { await page.screenshot({ path: `${OUT}/call-campaigns-fail.png`, fullPage: true }); throw e })
  await box.check()
  await page.getByTestId('bulk-campaign').click()
  await page.getByTestId('campaign-compose').waitFor({ timeout: 5000 })
  await page.getByTestId('campaign-channel-call').click()
  await page.getByTestId('call-campaign-compose').waitFor({ timeout: 5000 })
}

const server = await startServer()
const browser = await chromium.launch()
try {
  /* -------------------------------------------- 1-3. spread, end to end */
  {
    const { context, page } = await signedInPage(browser, ADMIN, handlers(ADMIN), [])
    await stubApi(page)
    await openCallBox(page)
    t.ok('Call opens the call box', await page.getByTestId('call-campaign-compose').isVisible())
    t.ok('spread asks for a last day and a place on the day',
      await page.getByTestId('call-ends-on').isVisible() && await page.getByTestId('call-rank').isVisible())
    await page.getByTestId('call-ends-on').fill('2026-11-06')
    await page.getByTestId('call-rank').selectOption('25')
    await page.getByTestId('call-script').fill('Offer 70% if paid before month end.')
    await page.getByTestId('call-name').fill('Month-end settlement push')
    await page.getByTestId('call-preview-go').click()
    await page.getByTestId('call-campaign-preview').waitFor({ timeout: 5000 })
    const pv = calls.find((c) => c.op === 'call-preview')
    t.ok('the preview asks about exactly the ticked account', JSON.stringify(pv?.accountIds) === JSON.stringify([ROWS[0].id]))
    t.ok('...spread, with the end date, the place and the script',
      pv?.mode === 'spread' && pv?.endsOn === '2026-11-06' && pv?.rank === 25 && pv?.script === 'Offer 70% if paid before month end.')
    t.check('the preview says how many calls are placed', (await page.getByTestId('call-placing').innerText()).trim(), '1')
    t.ok('...and on whose diary', /Itumeleng[\s\S]*1 call/.test(await page.getByTestId('call-collectors').innerText()))
    t.ok('the confirm words say where it sits and that misses still count',
      /under new accounts/.test(await page.getByTestId('call-confirm-words').innerText())
      && /still counted as missed/.test(await page.getByTestId('call-confirm-words').innerText()))
    await t.shot(page, 'call-campaign-preview')
    await page.getByTestId('call-start').click()
    await page.waitForURL(/\/accounts\/campaigns\?c=camp-call/, { timeout: 5000 })
    t.ok('Start sends the name', calls.find((c) => c.op === 'call-create')?.name === 'Month-end settlement push')
    await page.getByTestId('call-counts').first().waitFor({ timeout: 10000 })
    t.ok('a call campaign reads worked / waiting / missed',
      /2 worked · 3 waiting · 1 missed · 1 skipped/.test((await page.getByTestId('call-counts').first().innerText()).replace(/\s+/g, ' ')))
    await page.waitForTimeout(1000)
    t.ok('...and the page never pushes it through the message sender', !calls.some((c) => c.op === 'send'))
    await t.shot(page, 'call-campaign-page')
    await context.close()
  }

  /* -------------------------------------------- 4. now */
  {
    const { context, page } = await signedInPage(browser, ADMIN, handlers(ADMIN), [])
    await stubApi(page, { ...PREVIEW, endsOn: '2026-11-02' })
    await openCallBox(page)
    await page.getByTestId('call-mode-now').click()
    t.ok('now asks for no end date', await page.getByTestId('call-ends-on').count() === 0)
    await page.getByTestId('call-script').fill('Ring today: the client has a settlement offer.')
    await page.getByTestId('call-name').fill('Today')
    await page.getByTestId('call-preview-go').click()
    await page.getByTestId('call-campaign-preview').waitFor({ timeout: 5000 })
    t.ok('the preview is asked for now', calls.filter((c) => c.op === 'call-preview').at(-1)?.mode === 'now')
    t.ok('...and says it goes above everything',
      /on today’s diary for 1 collector, above everything else on it/.test(await page.getByTestId('call-confirm-words').innerText()))
    await context.close()
  }
} finally {
  await browser.close()
  await stopServer(server)
}
const good = t.finish(
  `Call campaigns (S10): the campaign box offers Call; spread sends its end date, place on the day and
script, the preview draws whose diary gets how many, Start lands on Campaigns where a call campaign
reads worked / waiting / missed and is never pushed through the message sender. Now needs no end date
and says it goes above everything.`)
process.exit(good ? 0 : 1)

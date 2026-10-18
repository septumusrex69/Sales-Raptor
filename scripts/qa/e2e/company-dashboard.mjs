/**
 * THE COMPANY DASHBOARD IN THE FIRM'S OWN LAYOUT (S8, 18 Oct), IN A REAL BROWSER.
 *
 * The firm sent a mock-up: "For the dashboard, I think, can we build something like this?" -- Work
 * coming in as a bar a day with the four sales tiles under it, The book as a ring with its legend and
 * what is owed, the departments as one row. Under the hero, which did not change.
 *
 * WHAT ONLY A BROWSER CAN SAY: that the two panels are drawn side by side, that the chart has a bar
 * for every day of the period (not only the days the database returned), that a day still to come is
 * drawn empty rather than as nought, and that the ring's slices add up to its centre. The arithmetic
 * itself is held in check-company-dashboard.
 *
 * Run: node scripts/qa/e2e/company-dashboard.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('company-dashboard')

const ADMIN = { ...PROFILE, role: 'Administrator' }
const SNAPSHOT = [{
  intake_accounts: 9, intake_clients: 2, intake_capital: 187500,
  book_accounts: 30, book_capital: 400000, book_clients: 5,
  active_accounts: 24, active_capital: 189240, active_clients: 4,
  unallocated_active: 3, quiet_accounts: 1, never_actioned: 0,
}]
/* Only the days that had a handover, as the database returns them. 17 and 18 Oct are a weekend. */
/* Last month (11 Sep - 10 Oct), asked for by its own dates: 2 by the 8th day, 7 in all. */
const PRIOR = [
  { day: '2026-09-14', accounts: 2, capital: 20000 },
  { day: '2026-09-30', accounts: 5, capital: 90000 },
]
const INTAKE = [
  /* new_accounts: from a client inside its first three months of handovers (Sales' work). */
  { day: '2026-10-12', accounts: 4, capital: 80000, new_accounts: 1, new_capital: 30000 },
  { day: '2026-10-14', accounts: 2, capital: 50000, new_accounts: 0, new_capital: 0 },
  { day: '2026-10-17', accounts: 3, capital: 57500, new_accounts: 3, new_capital: 57500 },
]

const server = await startServer()
let browser
try {
  browser = await chromium.launch()
  const seen = []
  const handlers = [
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
    [(u) => /\/rest\/v1\/rpc\/company_snapshot/.test(u), () => ({ body: SNAPSHOT })],
    [(u) => /\/rest\/v1\/rpc\/company_intake_by_day/.test(u),
      (u, req) => ({ body: (req.postDataJSON()?.p_from ?? '') < '2026-10-11' ? PRIOR : INTAKE })],
    [(u) => /\/rest\/v1\/rpc\/collector_performance/.test(u), () => ({ body: [] })],
    [(u) => /\/rest\/v1\/rpc\/clients_awaiting_first_handover/.test(u), () => ({ body: [
      { company_id: 'c1', name: 'Recently Signed (Pty) Ltd', mandate_signed_at: '2026-10-10T08:00:00Z', account_owner_id: ADMIN.id },
      { company_id: 'c2', name: 'Gone Cold Holdings', mandate_signed_at: '2026-08-01T08:00:00Z', account_owner_id: ADMIN.id },
    ] })],
  ]
  const { context, page } = await signedInPage(browser, ADMIN, handlers, seen, { now: '2026-10-18T10:00:00+02:00' })
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  await page.getByTestId('book-ring').waitFor({ timeout: 15000 })
  await page.getByTestId('intake-chart').locator('.recharts-bar-rectangle').first().waitFor({ timeout: 15000 })

  /* ---------- the two panels, side by side ---------- */
  const work = await page.getByTestId('work-coming-in').boundingBox()
  const bk = await page.getByTestId('the-book').boundingBox()
  t.ok('Work coming in and The book are both drawn', Boolean(work && bk))
  t.ok('...side by side at a laptop\'s width', Boolean(work && bk && Math.abs(work.y - bk.y) < 4 && bk.x > work.x + work.width - 4))
  t.ok('...Work coming in the wider of the two, as in the mock-up', Boolean(work && bk && work.width > bk.width))

  /* ---------- Work coming in ---------- */
  const line = await page.getByTestId('intake-line').innerText()
  t.ok('the period\'s intake is said in words', /9 accounts from 2 clients/.test(line))
  t.ok('...and the capital is named as the client\'s', /the client's money to recover/.test(line))
  /* 11 Oct - 10 Nov is 31 days: a bar slot for every one, not the three the database returned. */
  const ticks = await page.getByTestId('intake-chart').locator('.recharts-xAxis .recharts-cartesian-axis-tick').count()
  t.check('a slot for every day of the period, empty days included', ticks, 31)
  /* Two layers: last month (faint, behind) then this month. This month's is the second. */
  const nowLayer = page.getByTestId('intake-chart').locator('.recharts-bar').nth(1)
  const newLayer = page.getByTestId('intake-chart').locator('.recharts-bar').nth(2)
  const priorDrawn = await page.getByTestId('intake-chart').locator('.recharts-bar').nth(0).locator('.recharts-bar-rectangle path').count()
  t.check('last month is drawn behind, its two days with work', priorDrawn, 2)
  const fills = await nowLayer.locator('.recharts-bar-rectangle path').evaluateAll(
    (ps) => ps.map((p) => p.getAttribute('fill')))
  /* Recharts draws no rectangle for a zero, so the drawn bars are the three days with work. */
  /* Existing clients' part (gold) on the days it had any; the new clients' part (navy) stacked on top. */
  t.check('existing clients\' work on 12 and 14 Oct', fills.length, 2)
  t.ok('...in gold', fills.every((f) => f === 'var(--color-gold-400)'))
  const newFills = await newLayer.locator('.recharts-bar-rectangle path').evaluateAll((ps) => ps.map((p) => p.getAttribute('fill')))
  t.check('new clients\' work on 12 and 17 Oct', newFills.length, 2)
  t.ok('...in navy', newFills.every((f) => f === 'var(--color-navy-700)'))
  const split = await page.getByTestId('intake-split').innerText()
  t.ok('total, existing and new, as three figures', /Total\s*9/.test(split) && /Existing clients\s*5/.test(split) && /New clients\s*4/.test(split))
  /* Up to the 8th day of each: 9 now against 2 then (30 Sep is the 20th day, not yet reached). */
  t.ok('compared with last month by the same day', /up from 2 last month by the same day/.test(await page.getByTestId('intake-compare').innerText()))

  /* Rand instead of accounts: the axis reads in rand. */
  await page.getByTestId('measure-capital').click()
  await page.waitForTimeout(300)
  const yTicks = await page.getByTestId('intake-chart').locator('.recharts-cartesian-axis-tick-labels text').evaluateAll((ts) => ts.map((x) => x.textContent ?? ''))
  t.ok('the bars can be shown in rand', yTicks.some((x) => /^R\d+k$/.test(x.trim())))
  await page.getByTestId('measure-accounts').click()
  await page.waitForTimeout(300)

  const text = await page.locator('body').innerText()
  for (const tile of ['Open leads', 'Mandates signed', 'Deals open', 'Deal value won']) {
    t.ok(`the sales tile "${tile}" sits in the panel`, (await page.getByTestId('work-coming-in').innerText()).includes(tile))
  }

  /* ---------- The book ---------- */
  const ring = await page.getByTestId('book-ring').innerText()
  t.ok('the ring\'s centre is every account on the book', /\b30\b[\s\S]*Accounts/.test(ring))
  /* 21 on a desk + 3 on nobody's + 6 not being worked = 30: a partition, so it adds up. */
  t.ok('being worked is the live accounts on a desk', /Being worked\s*21/.test(ring))
  t.ok('not yet allocated is its own slice', /Not yet allocated\s*3/.test(ring))
  t.ok('the rest of the book is a slice too, so the ring adds up', /Not being worked\s*6/.test(ring))
  t.ok('clients and gone quiet are listed, not drawn as slices', /Clients with live accounts\s*4/.test(ring) && /Gone quiet\s*1/.test(ring))
  t.ok('what is owed on those accounts is under the ring', /Owed on those accounts\s*R\s?189[\s,]240/.test(await page.getByTestId('owed').innerText()))

  /* ---------- every figure is a way in ---------- */
  t.check('not yet allocated opens the unallocated view', await page.getByTestId('ring-unallocated').getAttribute('href'), '/accounts?book=active&who=nobody')
  t.check('gone quiet opens the gone-quiet view', await page.getByTestId('ring-quiet').getAttribute('href'), '/accounts?book=active&quiet=30')
  t.ok('not yet allocated is flagged gold when there are any', /bg-gold-100/.test(await page.getByTestId('ring-unallocated').innerHTML()))
  t.check('View all on Work coming in opens the period\'s handovers',
    await page.getByTestId('work-coming-in').getByRole('link', { name: /View all/ }).getAttribute('href'),
    '/accounts?book=whole&from=2026-10-11&to=2026-11-10')

  /* ---------- Departments ---------- */
  t.ok('each department carries its headline: sales', /4\s+accounts from new clients/.test(await page.getByTestId('headline-Sales').innerText()))
  t.ok('...communications', /5\s+accounts from existing clients/.test(await page.getByTestId('headline-Communications').innerText()))
  t.ok('...administration', /9\s+accounts loaded/.test(await page.getByTestId('headline-Administration').innerText()))
  t.ok('...call centre, in rand', /R\s?0\s+collected this month/.test(await page.getByTestId('headline-Call centre').innerText()))
  t.check('four departments in one row', await page.getByTestId('departments').locator('a').count(), 4)
  t.check('...each on its own photograph', await page.getByTestId('departments').locator('img[src^="/brand/departments/"]').count(), 4)
  const row = await page.getByTestId('departments').locator('a').evaluateAll((as) => as.map((a) => Math.round(a.getBoundingClientRect().top)))
  t.ok('...on one line at a laptop\'s width', new Set(row).size === 1)
  t.ok('yours is marked', /Administration[\s\S]*Yours/.test(await page.getByTestId('department-Administration').innerText()))

  /* ---------- the promise the screen was agreed under ---------- */
  t.ok('no commission on the screen', !/commission/i.test(text.replace(/Commission and Annexure B income are deliberately not on[\s\S]*?audience\./, '')))
  t.ok('the hero is still the company hero', /the beginning/i.test(text))

  await page.setViewportSize({ width: 1300, height: 900 })
  await t.shot(page, 'company-dashboard')
  /* The page scrolls inside <main>, so the full-page shot is the hero; this one is the new layout. */
  await page.getByTestId('work-coming-in').scrollIntoViewIfNeeded()
  await page.evaluate(() => { const m = document.querySelector('main'); if (m) m.scrollTop += 120 })
  await t.shot(page, 'company-dashboard-panels')
  /* A bar opens the accounts handed over that day (12 Oct). */
  await nowLayer.locator('.recharts-bar-rectangle').first().click()
  await page.waitForURL(/\/accounts\?/, { timeout: 10000 }).catch(() => {})
  t.ok('clicking a day opens that day\'s handovers', /\/accounts\?book=whole&from=2026-10-12&to=2026-10-12/.test(page.url()))

  /* ---------- View all opens the period's handovers (the firm, 18 Oct: "this button doesn't work") ---------- */
  await page.goto(`http://localhost:${PORT}/`)
  await page.getByTestId('work-coming-in').waitFor({ timeout: 15000 })
  await page.setViewportSize({ width: 1180, height: 1024 })
  await page.waitForTimeout(300)
  const viewAll = page.getByTestId('work-coming-in').getByRole('link', { name: /View all/ })
  t.ok('View all is not covered by anything at iPad width', await viewAll.evaluate((a) => {
    a.scrollIntoView({ block: 'center' }); const r = a.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return a === hit || a.contains(hit)
  }))
  await page.getByTestId('work-coming-in').getByRole('link', { name: /View all/ }).click()
  await page.waitForURL(/\/accounts\?/, { timeout: 10000 }).catch(() => {})
  t.ok('...and opens the accounts handed over in the period, on the whole book', /\/accounts\?book=whole&from=2026-10-11&to=2026-11-10/.test(page.url()))
  await page.setViewportSize({ width: 1440, height: 900 })

  /* ---------- over six months, one bar a month (the firm, 18 Oct) ---------- */
  await page.goto(`http://localhost:${PORT}/`)
  await page.getByTestId('intake-chart').waitFor({ timeout: 15000 })
  await page.locator('select:has(option[value="last6"])').first().selectOption('last6')
  await page.waitForTimeout(800)
  await page.getByTestId('intake-chart').locator('.recharts-bar-rectangle').first().waitFor({ timeout: 15000 })
  const monthTicks = await page.getByTestId('intake-chart').locator('.recharts-xAxis-tick-labels text').allTextContents()
  t.check('over Last 6 months the chart draws six months, not a hundred and eighty days', JSON.stringify(monthTicks), JSON.stringify(['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov']))
  /* WHOSE WORK, AND BARS OR LINES (the firm, 18 Oct): the tiles filter; the lines compare new and existing. */
  const chart = page.getByTestId('intake-chart')
  const layers = async () => JSON.stringify([await chart.locator('.recharts-bar').count(), await chart.locator('.recharts-line').count()])
  t.check('everybody\'s work: two stacked layers, no lines', await layers(), '[2,0]')
  await page.getByTestId('intake-who-new').click(); await page.waitForTimeout(300)
  t.check('New clients only: one layer', await layers(), '[1,0]')
  t.ok('...the tile says it is the one chosen', (await page.getByTestId('intake-who-new').getAttribute('aria-pressed')) === 'true')
  await page.getByTestId('intake-who-all').click()
  await page.getByTestId('intake-show-line').click(); await page.waitForTimeout(300)
  t.check('Line: existing against new, a line each, no bars', await layers(), '[0,2]')
  await page.getByTestId('intake-show-both').click(); await page.waitForTimeout(300)
  t.check('Both: the bars and the two lines', await layers(), '[2,2]')
  await page.getByTestId('intake-who-existing').click(); await page.waitForTimeout(300)
  t.check('...Existing only, with Both: one layer and its line', await layers(), '[1,1]')
  await page.getByTestId('intake-who-all').click(); await page.getByTestId('intake-show-bars').click(); await page.waitForTimeout(300)
  await page.getByTestId('work-coming-in').scrollIntoViewIfNeeded()
  await t.shot(page, 'company-dashboard-months')
  /* No faint layer in month mode, so existing is the first layer. */
  await page.getByTestId('intake-chart').locator('.recharts-bar').nth(0).locator('.recharts-bar-rectangle').last().click()
  await page.waitForURL(/\/accounts\?/, { timeout: 10000 }).catch(() => {})
  t.ok('...and a month bar opens that whole sales month, the 11th to the 10th', /\/accounts\?book=whole&from=2026-(\d\d)-11&to=2026-\d\d-10$/.test(page.url()) && (() => { const m = page.url().match(/from=2026-(\d\d)-11&to=2026-(\d\d)-10/); return !!m && Number(m[2]) === Number(m[1]) + 1 })())

  /* ---------- the communications dashboard: signed, nothing handed over ---------- */
  await page.goto(`http://localhost:${PORT}/dashboard/communications`)
  await page.getByTestId('awaiting-first-handover').waitFor({ timeout: 15000 })
  const aw = await page.getByTestId('awaiting-first-handover').innerText()
  t.ok('the communications dashboard lists clients signed with nothing handed over', /Signed, nothing handed over yet · 2/.test(aw))
  t.ok('...the longest waiting first, with how long', aw.indexOf('Gone Cold Holdings') >= 0 && aw.indexOf('Gone Cold Holdings') < aw.indexOf('Recently Signed') && /78 days/.test(aw))
  t.check('...each opens the client', await page.getByTestId('awaiting-first-handover').getByRole('link', { name: 'Gone Cold Holdings' }).getAttribute('href'), '/companies/c2')
  await page.getByTestId('awaiting-first-handover').scrollIntoViewIfNeeded()
  await t.shot(page, 'communications-awaiting')

  await context.close()
} finally {
  if (browser) await browser.close()
  stopServer(server)
}

process.exit(t.finish() ? 0 : 1)

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
const INTAKE = [
  { day: '2026-10-12', accounts: 4, capital: 80000 },
  { day: '2026-10-14', accounts: 2, capital: 50000 },
  { day: '2026-10-17', accounts: 3, capital: 57500 },
]

const server = await startServer()
let browser
try {
  browser = await chromium.launch()
  const seen = []
  const handlers = [
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
    [(u) => /\/rest\/v1\/rpc\/company_snapshot/.test(u), () => ({ body: SNAPSHOT })],
    [(u) => /\/rest\/v1\/rpc\/company_intake_by_day/.test(u), () => ({ body: INTAKE })],
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
  const fills = await page.getByTestId('intake-chart').locator('.recharts-bar-rectangle path').evaluateAll(
    (ps) => ps.map((p) => p.getAttribute('fill')))
  /* Recharts draws no rectangle for a zero, so the drawn bars are the three days with work. */
  t.check('three days brought work in', fills.length, 3)
  t.check('a weekday is gold, a Saturday grey', JSON.stringify(fills),
    JSON.stringify(['var(--color-gold-400)', 'var(--color-gold-400)', 'var(--color-slate-300)']))
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

  /* ---------- Departments ---------- */
  t.check('four departments in one row', await page.getByTestId('departments').locator('a').count(), 4)
  const row = await page.getByTestId('departments').locator('a').evaluateAll((as) => as.map((a) => Math.round(a.getBoundingClientRect().top)))
  t.ok('...on one line at a laptop\'s width', new Set(row).size === 1)
  t.ok('yours is marked', /Administration[\s\S]*yours/.test(await page.getByTestId('department-Administration').innerText()))

  /* ---------- the promise the screen was agreed under ---------- */
  t.ok('no commission on the screen', !/commission/i.test(text.replace(/Commission and Annexure B income are deliberately not on[\s\S]*?audience\./, '')))
  t.ok('the hero is still the company hero', /the beginning/i.test(text))

  await page.setViewportSize({ width: 1300, height: 900 })
  await t.shot(page, 'company-dashboard')
  /* The page scrolls inside <main>, so the full-page shot is the hero; this one is the new layout. */
  await page.getByTestId('work-coming-in').scrollIntoViewIfNeeded()
  await page.evaluate(() => { const m = document.querySelector('main'); if (m) m.scrollTop += 120 })
  await t.shot(page, 'company-dashboard-panels')
  await context.close()
} finally {
  if (browser) await browser.close()
  stopServer(server)
}

process.exit(t.finish() ? 0 : 1)

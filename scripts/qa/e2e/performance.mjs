/**
 * The Performance screen against target, in a real browser.
 *
 * WHY THIS PAGE NEEDED THIS LAYER. The pace arithmetic is checked to the rand beside this folder
 * in check-collection-pace.mjs, and none of that can tell you the card never rendered — which is
 * the failure this project has actually shipped once, in a bundle that provably contained the
 * panel. The month header and the two tables here are new panels on a page whose whole body sits
 * inside a three-way branch (loading / no book / a book), and the branch a team leader lands in
 * is not the one a developer usually looks at.
 *
 * WHAT IS ASSERTED IS DELIBERATELY MONTH-INDEPENDENT. The page opens on the sales month
 * containing today, so "20 work days" is true in September and false in October. Every check
 * below therefore either reads a label, or uses a figure whose standing cannot change with the
 * point in the month: 120% of target is "Target reached" on any day, and 0.5% of target is
 * "Critical" on any day. A check that only passes in September is a check that fails in October
 * for no reason, and gets deleted.
 *
 * Run: node scripts/qa/e2e/performance.mjs
 */
import {
  OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer,
} from './harness.mjs'
import { COLLEAGUE, PROFILE, TEAM, USER_ID } from './fixtures.mjs'

const t = makeRunner('performance')
const seen = []

/** A third collector, on nobody's team — two of the firm's own thirty clerks are exactly this. */
const LOOSE = {
  ...PROFILE,
  id: '66666666-6666-4666-8666-666666666666',
  name: 'Unteamed Clerk',
  email: 'loose@raptor.test',
  role: 'Pre-legal Agent',
  team_id: null,
}

/**
 * The floor, chosen so every standing on the screen is fixed whatever day it is read on.
 *
 *   Test Leader   R120 000 in against R100 000  — past target, so "Target reached" always
 *   Thandi Junior      R500 in against R100 000 — half a per cent, so "Critical" always
 *   Unteamed Clerk  R7 000 in against nothing   — "No target", and last in the list always
 */
const perfRow = (id, collected, over = {}) => ({
  user_id: id,
  in_play_accounts: 400,
  in_play_value: 2_000_000,
  collected,
  payments: 12,
  calls: 40,
  calls_answered: 14,
  emails_sent: 9,
  sms_sent: 6,
  notes_written: 20,
  promises_made: 8,
  promises_kept: 5,
  promises_broken: 2,
  accounts_touched: 120,
  ...over,
})

const PERFORMANCE = [
  perfRow(USER_ID, 120_000),
  perfRow(COLLEAGUE.id, 500),
  perfRow(LOOSE.id, 7_000),
]

const target = (scopeId, value) => ({
  id: `target-${scopeId}`,
  scope_type: 'user',
  scope_id: scopeId,
  metric: 'collected',
  /* Standing, not for one month — so the fixture stays right when the month rolls over. */
  period_key: null,
  target_value: value,
  threshold_value: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
})

const TARGETS = [target(USER_ID, 100_000), target(COLLEAGUE.id, 100_000)]

const handlers = [
  [(u) => u.includes('/auth/v1/user'), () => ({ body: { id: USER_ID, email: PROFILE.email } })],
  [
    (u) => u.includes('/rest/v1/profiles'),
    (u) => {
      const one = /id=eq\.([0-9a-f-]+)/.exec(u)?.[1]
      const all = [PROFILE, COLLEAGUE, LOOSE]
      return { body: one ? all.filter((p) => p.id === one) : all }
    },
  ],
  [(u) => u.includes('/rest/v1/teams'), () => ({ body: [TEAM] })],
  [(u) => u.includes('/rest/v1/targets'), () => ({ body: TARGETS })],
  [(u) => u.includes('/rpc/collector_performance'), () => ({ body: PERFORMANCE })],
  [(u) => u.includes('/rpc/nav_counts'), () => ({ body: { mail: 0, tasks: 0, disputes: 0, diary: 0 } })],
]

let server
let browser
try {
  server = startServer()
  browser = await chromium.launch()
  const { page } = await signedInPage(browser, PROFILE, handlers, seen)

  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))

  let up = false
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/performance`, { timeout: 2000 }); up = true; break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  t.ok('the dev server answers', up)

  await page.getByRole('heading', { name: 'Collections', exact: true }).waitFor({ timeout: 20000 })
  await page.getByText('Work days').first().waitFor({ timeout: 20000 })
  await t.shot(page, '40-performance')

  /* ---------- the month header, once ---------- */

  /*
   * THE HEADER IS THE THING EVERY PERCENTAGE BELOW IT IS READ AGAINST. Ten per cent collected is
   * exactly on pace on the second working day of the month and a crisis on the eighteenth, and
   * without the work-day count on screen a team leader cannot tell which they are looking at.
   */
  for (const label of ['Work days', 'Worked', 'Left', 'Expected pace']) {
    t.check(`the month header carries "${label}", once`, await page.getByText(label, { exact: true }).count(), 1)
  }
  /* Each fact on the header is a label with its value in the next paragraph. Read that way round
     so an assertion is about THAT fact's figure and not about a number somewhere on the page. */
  const fact = async (label) => (
    await page.locator('p', { hasText: new RegExp(`^${label}$`) })
      .locator('xpath=following-sibling::p[1]').first().innerText()
  ).trim()

  const workDays = Number(await fact('Work days'))
  t.ok('the work-day count is a real month, not nought', workDays >= 15 && workDays <= 23)

  /*
   * COLUMNS ARE READ OFF THE HEADER CELLS, not looked up by role.
   *
   * getByRole('columnheader') resolves to NOTHING in this Playwright build — every `th` on the
   * page, and there are seventeen. An assertion that a column is absent would therefore have
   * passed whether the column was there or not, which is the exact shape of a check that proves
   * nothing. The text of the header cells is asserted instead, and asserted present before it is
   * asserted absent, so an empty page cannot satisfy either half.
   *
   * The text comes back as the stylesheet renders it: upper-cased.
   */
  const headers = async () => (await page.locator('th').allInnerTexts()).map((h) => h.trim())
  const shown = await headers()
  t.ok('the tables have header cells at all', shown.length > 8)

  /*
   * The floor's target is the sum of the people's: R100 000 and R100 000, with the third person
   * contributing nothing because nobody set them one. A total of R300 000 would mean somebody had
   * quietly counted an unset target as a figure of nought — which is the whole reason paceLine
   * returns nulls rather than zeros.
   */
  const floorTarget = await fact('Target')
  t.ok(`the floor target sums only the targets actually set (${floorTarget})`,
    /200[,\s]000/.test(floorTarget))
  t.check('...and nobody invented a third', /300[,\s]000/.test(floorTarget), false)
  t.ok('the header carries what is still needed', (await fact('Still needed')).length > 2)
  t.ok('...and says how many of the floor have one',
    await page.getByText(/sum of 2 of 3 collectors/).first().isVisible())

  /* ---------- the fair table is still what the page opens on ---------- */

  /*
   * Ranking collectors on rand measures the book somebody was handed at least as much as it
   * measures them. The attention list is a pace tool and must never quietly become the ranking.
   */
  t.ok('the page opens on the fair comparison', shown.includes('PER 100'))
  t.check('and the target columns are not up yet', shown.includes('GAP VS PACE'), false)
  t.ok('the reason is still on the screen',
    await page.getByText(/not by rand/).first().isVisible())

  /* ---------- teams ---------- */

  t.ok('the teams sheet is on the page', shown.includes('TEAM') && shown.includes('PEOPLE'))
  t.ok('...naming the team', await page.locator('td', { hasText: new RegExp(`^${TEAM.name}$`) }).first().isVisible())
  /*
   * A collector on nobody's team is a line of their own, not a rounding error. Dropping them
   * would make the teams table add up to less than the floor total directly above it.
   */
  t.ok('...and carrying the collectors with no team',
    await page.locator('td', { hasText: /^No team/ }).first().isVisible())
  /* A team nobody was given a figure has no target at all — "Target from 0 of 1" beside a
     "No target" pill is noise, and a warning that fires when nothing is wrong stops being read. */
  t.check('a team with nothing set is not nagged about it',
    await page.getByText(/Target from 0 of/).count(), 0)
  t.ok('the teams sheet carries the weekly figure', shown.includes('NEEDED A WEEK'))

  /* ---------- the attention list ---------- */

  await page.getByRole('button', { name: 'Needing attention' }).click()
  await page.waitForTimeout(300)
  await t.shot(page, '41-needing-attention')

  const afterToggle = await headers()
  t.ok('the target columns come up', afterToggle.includes('GAP VS PACE'))
  t.ok('...along with what is still needed',
    afterToggle.includes('STILL NEEDED') && afterToggle.includes('NEEDED A DAY'))
  t.check('...and the fair ranking goes away', afterToggle.includes('PER 100'), false)
  t.ok('it says it is not a ranking of collectors',
    await page.getByText(/not a ranking of collectors/).first().isVisible())

  /*
   * WORST FIRST is the whole point of a list headed "needing attention" — the collector at half
   * a per cent of target is who a team leader goes and stands next to this morning.
   */
  const rows = page.locator('table').last().locator('tbody tr')
  const firstRow = await rows.first().innerText()
  t.ok(`the worst collector is first (${firstRow.split('\n')[0]})`, firstRow.includes(COLLEAGUE.name))
  t.ok('...and is marked Critical', firstRow.includes('Critical'))

  const lastRow = await rows.last().innerText()
  t.ok('somebody with no target is last', lastRow.includes(LOOSE.name))
  /* Not "0.0%" — nought per cent of nothing is not an achievement of nought. */
  t.ok('...and is marked as having no target, not nought', lastRow.includes('No target'))
  t.check('...with no invented percentage against them', /\d\.\d%/.test(lastRow), false)

  const middleRow = await rows.nth(1).innerText()
  t.ok('past the target reads as reached', middleRow.includes('Target reached'))

  const real = errors.filter((e) => !/favicon|404 \(Not Found\)/i.test(e))
  t.check('no console errors', real.length, 0)
  if (real.length) console.log('  console:', real.slice(0, 5))
} catch (e) {
  t.ok(`the run finished without throwing (${String(e).split('\n')[0].slice(0, 140)})`, false)
  try {
    const pages = browser ? browser.contexts().flatMap((c) => c.pages()) : []
    if (pages[0]) await t.shot(pages[0], '49-where-it-stopped')
  } catch { /* nothing more to learn */ }
  console.log('\n--- what the app asked Supabase for ---')
  console.log(seen.slice(-14).join('\n') || '(nothing)')
} finally {
  if (browser) await browser.close()
  stopServer(server)
}

const good = t.finish(`The month is on the screen in work days, the floor target is the sum of the
people who actually have one and says so, the fair ranking is still what the page opens on, and
the attention list puts the collector at half a per cent of target at the top. Screenshots in ${OUT}.`)
process.exit(good ? 0 : 1)

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
 *   Test Leader     R120 000 against R100 000 set   — past target, so "Target reached" always,
 *                                                     and a bar on its second lap at 20%
 *   Thandi Junior        R500 against R100 000 set  — half a per cent, so "Critical" always
 *   Unteamed Clerk     R7 000 against nothing set   — R80 000 from their grade, and on no team
 *
 * THE DAY AND THE PERIOD ARE DIFFERENT FIGURES, deliberately. Answering both out of one fixture
 * would put the same number on "Collected today" and "Collected this period", which looks exactly
 * like a working pair of tiles and is a stub counting the same rows twice. The stub reads the
 * range off the request and answers accordingly — see the handler below.
 */
const perfRow = (id, collected) => ({
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
})

/** The period to date: R127 500 across the floor. */
const PERIOD = [
  perfRow(USER_ID, 120_000),
  perfRow(COLLEAGUE.id, 500),
  perfRow(LOOSE.id, 7_000),
]
/** The day being read: R27 000, and nothing like the period total. */
const DAY = [
  perfRow(USER_ID, 20_000),
  perfRow(COLLEAGUE.id, 0),
  perfRow(LOOSE.id, 7_000),
]
/** Last period, for the comparisons on the secondary tiles. */
const PRIOR = [perfRow(USER_ID, 90_000)]

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

/* Two of the three are set; the third falls back to their grade, which is what proves the
   fallback is wired rather than everybody happening to have a figure. */
const TARGETS = [target(USER_ID, 100_000), target(COLLEAGUE.id, 100_000)]

/**
 * When the sales month the page opens on began: the 11th of this month, or of last month before
 * the 11th. Four lines of arithmetic rather than a date typed in, because a fixture pinned to
 * September is a fixture that fails in October for no reason and then gets deleted.
 */
const PERIOD_STARTS = (() => {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 11)
  if (now.getDate() < 11) start.setMonth(start.getMonth() - 1)
  return start.toISOString()
})()

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
  [
    (u) => u.includes('/rpc/collector_performance'),
    (u, req) => {
      /*
       * THE STUB ANSWERS THE RANGE IT WAS ASKED FOR.
       *
       * Three calls come back from one page load — the period to date, the day being read, and
       * last period — and answering them all out of one fixture would put the same figure on
       * "Collected today" and "Collected this period". That looks like a working pair of tiles
       * and is a stub counting the same rows three times, which is the shape of vacuous fixture
       * this suite has already shipped once.
       */
      const body = req.postDataJSON?.() ?? {}
      const from = String(body.p_from ?? '')
      const to = String(body.p_to ?? '')
      /* One calendar day at both ends is the day being read. */
      if (from.slice(0, 10) === to.slice(0, 10)) return { body: DAY }
      /* The prior period is the only one that ENDS before this one begins. Computed rather than
         written as a date, so the fixture is still right next month. */
      if (to < PERIOD_STARTS) return { body: PRIOR }
      return { body: PERIOD }
    },
  ],
  [(u) => u.includes('/rpc/nav_counts'), () => ({ body: { mail: 0, tasks: 0, disputes: 0, diary: 0 } })],
  /*
   * A year of days behind the trend chart. Deliberately UNEVEN: every day the same would draw a
   * flat chart, which looks exactly like a chart with no data in it and would let a broken
   * bucketing pass unnoticed.
   */
  [
    (u) => u.includes('/rpc/collector_daily'),
    () => {
      const out = []
      const start = new Date()
      start.setMonth(start.getMonth() - 11)
      for (let i = 0; i < 330; i += 7) {
        const d = new Date(start)
        d.setDate(d.getDate() + i)
        out.push({
          on_day: d.toISOString().slice(0, 10),
          collected: 5000 + (i % 40) * 900,
          payments: 1 + (i % 5),
        })
      }
      return { body: out }
    },
  ],
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

  await page.getByRole('heading', { name: /Recovery today/ }).waitFor({ timeout: 20000 })
  await page.getByText('Monthly progress').waitFor({ timeout: 20000 })
  await t.shot(page, '40-collections')

  /* ---------- the hero renders, and renders the real figures ---------- */

  /*
   * A HERO IS THE ONE PANEL THAT CAN SHIP INVISIBLE AND NOBODY NOTICE for a week — it is a
   * background image, a scrim and four glass tiles, and every one of those is a CSS property
   * that can fail silently. The source checks beside this folder cannot tell you the photograph
   * 404'd or that the scrim swallowed the type.
   */
  const heroBox = page.locator('.collections-hero')
  t.ok('the hero is on the page', await heroBox.isVisible())
  const hero = await heroBox.evaluate((el) => {
    const s = getComputedStyle(el)
    const scrim = getComputedStyle(el, '::before')
    return { image: s.backgroundImage, position: s.backgroundPosition, scrim: scrim.backgroundImage,
      height: el.getBoundingClientRect().height }
  })
  t.ok(`the photograph is actually attached (${hero.image.slice(0, 48)})`,
    /collections-hero/.test(hero.image))
  /* getComputedStyle resolves the keyword: `center` reads back as `50% 50%`. */
  t.ok(`...centred, which is the whole valley (${hero.position})`, /^50% 50%$/.test(hero.position))
  t.ok('...with a scrim over it', /gradient/.test(hero.scrim))
  t.ok(`the panel has real height (${Math.round(hero.height)}px)`, hero.height > 320)

  /*
   * AND THE TYPE ON IT IS READABLE. A scrim that is too light is the failure a screenshot flatters
   * and a person notices immediately; this measures the heading against the panel behind it.
   */
  const heading = await page.locator('.collections-hero h1').evaluate((el) => ({
    text: el.innerText, colour: getComputedStyle(el).color, size: getComputedStyle(el).fontSize,
  }))
  t.check('the title is the firm’s own line',
    heading.text.replace(/\s+/g, ' ').trim(), 'Recovery today. A stronger tomorrow.')
  t.ok(`...set large (${heading.size})`, parseFloat(heading.size) >= 28)
  t.ok('...in white on the dark panel', /255, 255, 255/.test(heading.colour))
  /*
   * BROKEN WHERE THE FIRM BREAKS IT. Half the point of the line is the shape it makes — today
   * over tomorrow — and left to wrap on its own the break lands wherever the window happens to
   * be wide. innerText renders the <br> as a newline, so this reads the rendered break rather
   * than the presence of a tag.
   */
  t.check('...over two lines, today then tomorrow',
    heading.text.trim().split('\n').map((l) => l.trim()).join(' | '),
    'Recovery today. | A stronger tomorrow.')

  /*
   * THE PANEL DOES NOT NAME THE SCREEN, AND SOMETHING ELSE HAS TO.
   *
   * It carried "Collections" twice at one point — a gold eyebrow and the heading under it — and
   * the firm's design for it carries the word nowhere at all. That is only safe because the
   * route is titled in the bar above it, which it was NOT until this change: /performance was
   * missing from the table and the bar was blank. Both halves are asserted together, because
   * checking the hero alone passes happily on a screen that names itself nowhere.
   */
  const heroWords = (await heroBox.innerText()).match(/Collections/gi) ?? []
  t.check(`the panel leaves the naming to the bar (${heroWords.length})`, heroWords.length, 0)
  t.ok('...and the bar does name it',
    await page.getByRole('heading', { name: 'Collections', exact: true }).isVisible())

  /*
   * IT IS A CARD, INSET AND ROUNDED LIKE EVERY OTHER HERO. It ran full bleed with square corners
   * for a version and the firm sent it back: one square panel bleeding into the sidebar beside
   * eight rounded ones reads as the screen somebody forgot to finish. Measured off the scrolling
   * area rather than read off the class, because a margin the parent clips is a margin that did
   * nothing either way.
   */
  const frame = await page.evaluate(() => {
    const el = document.querySelector('.collections-hero')
    const hero = el.getBoundingClientRect()
    const main = document.querySelector('main').getBoundingClientRect()
    return {
      left: hero.left - main.left, right: main.right - hero.right, top: hero.top - main.top,
      radius: parseFloat(getComputedStyle(el).borderTopLeftRadius),
    }
  })
  t.ok(`it sits inside the page's padding, left (${Math.round(frame.left)}px)`, frame.left >= 12)
  t.ok(`...right (${Math.round(frame.right)}px)`, frame.right >= 12)
  t.ok(`...and top (${Math.round(frame.top)}px)`, frame.top >= 12)
  t.ok(`...with the corners rounded (${frame.radius}px)`, frame.radius >= 8)

  /*
   * AND THE FOUR FIGURES SIT ON ONE LINE.
   *
   * They did not: the labels above them are different lengths and one carries a date, so at any
   * width where "Collected this period" wraps onto a second line and "Ahead of pace" does not,
   * the four big numbers land at four different heights and the row stops reading as a row.
   *
   * MEASURED AT TWO WIDTHS, because this is a wrapping bug and one width proves nothing about
   * the next — the firm found it on an iPad, not on the laptop this suite runs at. 1300 is a
   * width where two of the four labels wrap and two do not, which is the shape of the bug;
   * below 1280 the tiles stack two-up and there is no line left to hold.
   */
  const figureTops = async () => page.evaluate(() =>
    [...document.querySelectorAll('.collections-hero .grid > div')]
      .map((tile) => Math.round(tile.querySelectorAll('p')[1].getBoundingClientRect().top)))

  const wide = await figureTops()
  t.check('all four figures are there to line up', wide.length, 4)
  t.ok(`...and they are on one line (${wide.join(', ')})`, new Set(wide).size === 1)

  await page.setViewportSize({ width: 1300, height: 1000 })
  const narrow = await figureTops()
  t.ok(`...still on one line where the labels wrap (${narrow.join(', ')})`, new Set(narrow).size === 1)
  /*
   * AND THE LABELS REALLY DO WRAP AT THAT WIDTH, or the line above passes for the wrong reason —
   * a check that only ever sees one-line labels proves nothing about the case it exists for.
   *
   * Counted off a Range rather than off the elements' heights, which is the trap the first
   * version of this fell into: reserving the second line is the fix, so every label box is the
   * same height whether or not it wrapped, and comparing heights found nothing by construction.
   * A Range over the text gives one rect per line box, which is the actual wrap.
   */
  const lines = await page.evaluate(() =>
    [...document.querySelectorAll('.collections-hero .grid > div')].map((tile) => {
      const range = document.createRange()
      range.selectNodeContents(tile.querySelector('p'))
      return range.getClientRects().length
    }))
  t.ok(`...and at least one label wraps there (${lines.join(', ')})`, Math.max(...lines) >= 2)
  t.ok('...while another does not, which is what knocked them out of line',
    Math.min(...lines) === 1)
  await page.setViewportSize({ width: 1440, height: 1000 })

  /* The firm's own lines, which is most of why they asked for the panel. */
  t.ok('the greeting is on it',
    await heroBox.getByText(/Good (morning|afternoon|evening), /).isVisible())
  t.ok('...and the gold line under the headline',
    await heroBox.getByText('Discipline drives results').isVisible())
  t.ok('...and the rail beside it',
    await heroBox.getByText(/Higher\s*Performance\s*Closer\s*Tomorrow/).isVisible())
  t.ok('...and the one at the foot',
    await heroBox.getByText('Built for a higher standard').isVisible())

  /* The controls live IN the hero, not in a card below it. */
  t.check('the period picker is inside the panel', await heroBox.locator('select').count() >= 2, true)
  t.check('...and the as-at date', await heroBox.locator('input[type="date"]').count(), 1)
  t.check('...and nothing was left behind outside it',
    await page.locator('input[type="date"]').count(), 1)

  /* ---------- the day and the period are different questions ---------- */

  /*
   * THE FIRST QUESTION EVERY MORNING is what came in yesterday, which is why the firm's own sheet
   * leads with it. The fixture answers the day with R27 000 and the period with R127 500, so a
   * tile showing the period's figure under "Collected today" fails here rather than looking
   * plausible for a month.
   */
  const tile = async (label) => (
    await page.locator('p', { hasText: new RegExp(`^${label}$`, 'i') })
      .locator('xpath=following-sibling::p[1]').first().innerText()
  ).trim()

  const todayTile = await tile('Collected today')
  t.ok(`the day's own figure leads (${todayTile})`, /27[,\s\u00a0]000/.test(todayTile))
  const periodTile = await tile('Collected this period')
  t.ok(`...beside the period's (${periodTile})`, /127[,\s\u00a0]500/.test(periodTile))
  t.check('...and they are not the same number', todayTile === periodTile, false)

  /* ---------- the month on one bar ---------- */

  /*
   * THE HEADER IS WHAT EVERY PERCENTAGE BELOW IT IS READ AGAINST. Ten per cent collected is
   * exactly on pace on the second working day and a crisis on the eighteenth.
   */
  t.ok('the working days behind and ahead are on the screen',
    await page.getByText(/of \d+ working days completed/).first().isVisible())
  t.ok('...and the pace expected by now is marked on the bar',
    await page.getByText(/% expected by now/).first().isVisible())
  t.ok('the report can be read as at a day', await page.locator('input[type="date"]').first().isVisible())

  /* ---------- the clerk sheet ---------- */

  const headers = async () => (await page.locator('th').allInnerTexts()).map((h) => h.trim())
  const shown = await headers()
  t.ok('the tables have header cells at all', shown.length > 8)
  t.ok('the clerk sheet carries the target', shown.includes('TARGET'))
  t.ok('...and what is achieved of it', shown.includes('ACHIEVED'))
  t.ok('...and what is needed a day', shown.includes('NEEDED / DAY'))
  t.ok('the teams sheet carries the weekly figure', shown.includes('NEEDED A WEEK'))

  /*
   * TWO TABS, NOT THREE. The firm dropped "Target reached". Asserted against the TAB ROW and not
   * against the page, because "Target reached" is also what the status pill says on a row that
   * has passed its target — a page-wide check for the words would fail on correct code, and the
   * obvious "fix" would be to delete the check.
   */
  const tabs = page.locator('div.flex.rounded-lg.border').first()
  const tabText = await tabs.innerText()
  t.ok(`the clerk sheet has an all-clerks tab (${tabText.replace(/\n/g, ' | ')})`, tabText.includes('All clerks'))
  t.ok('...and a needs-attention tab', tabText.includes('Needs attention'))
  t.check('...and no target-reached tab', /Target reached/i.test(tabText), false)
  /* ...while the pill on the row that earned it is still there, which is the other half. */
  t.ok('a collector past target is marked as having reached it',
    await page.getByText('Target reached').first().isVisible())

  /*
   * THE ROSTER IS ALPHABETICAL, NOT RANKED. Sorted by rand it would quietly become a leaderboard
   * on the one figure that measures the book somebody was handed rather than the person.
   */
  const clerkRows = page.locator('table').nth(1).locator('tbody tr')
  /* The name cell also carries the avatar's initials on their own line — "TL\nTest Leader" — and
     sorting those compares TJ against TL rather than Thandi against Test. */
  const names = await clerkRows.evaluateAll((rows) => rows.map(
    (r) => (r.querySelector('td')?.innerText.trim().split('\n').pop() ?? '').trim(),
  ))
  t.check('every clerk is listed', names.length, 3)
  t.check('...alphabetically', JSON.stringify(names),
    JSON.stringify([...names].sort((a, b) => a.localeCompare(b, 'en-ZA'))))
  /*
   * AND IT IS NOT THE ORDER OF THEIR RAND. Asserting only "alphabetical" is not enough on its own
   * — on this floor the top collector also happens to come first alphabetically, so a table
   * silently sorted by rand would satisfy it. The two orders differ at the second and third rows,
   * which is what makes the assertion mean something.
   */
  const byRand = [PROFILE.name, LOOSE.name, COLLEAGUE.name]
  t.check('...and not the order of their rand',
    JSON.stringify(names) === JSON.stringify(byRand), false)

  /* A target nobody set follows the grade, and the row says where the figure came from. */
  t.ok('a grade-supplied target says so', await page.getByText('from grade').first().isVisible())

  /* ---------- the bar laps past target ---------- */

  /*
   * THE FIRM'S OWN IDEA, and it cannot be checked by reading source: "when somebody has exceeded
   * their target, the bar that's there starts over, but now it's a different colour." Test Leader
   * is at 120% of target, so their bar must be a FIFTH full and a different colour from Thandi
   * Junior's, who is at half a per cent. A bar pinned at 100% would show them full and gold.
   */
  const barOf = async (name) => {
    const row = clerkRows.filter({ hasText: name }).first()
    return row.locator('td span[class*="rounded-full"] span').first().evaluate((el) => ({
      width: el.getBoundingClientRect().width,
      track: el.parentElement.getBoundingClientRect().width,
      colour: getComputedStyle(el).backgroundColor,
    }))
  }
  const over = await barOf('Test Leader')
  const under = await barOf('Thandi Junior')
  t.ok('both bars are drawn', over.track > 10 && under.track > 10)
  const overFill = over.width / over.track
  t.ok(`a collector at 120% shows a fifth of a bar, not a full one (${Math.round(overFill * 100)}%)`,
    overFill > 0.1 && overFill < 0.32)
  t.ok(`...in a different colour from somebody still short (${over.colour} vs ${under.colour})`,
    over.colour !== under.colour)

  /* ---------- the team filter narrows everything, including the totals ---------- */

  /*
   * A FILTER THAT CHANGED THE TABLE AND LEFT THE HEADLINE ALONE would have a team leader reading
   * their team's list against the firm's numbers.
   */
  await page.getByRole('combobox').last().selectOption({ label: TEAM.name })
  await page.waitForTimeout(400)
  const filteredTile = await tile('Collected this period')
  t.ok(`the headline follows the filter (${filteredTile})`, /120[,\s\u00a0]500/.test(filteredTile))
  t.check('...and the unteamed collector is gone from the list',
    await page.getByText(LOOSE.name).count(), 0)
  await page.getByRole('combobox').last().selectOption({ label: 'All teams' })
  await page.waitForTimeout(400)

  /* ---------- needs attention is only people behind their own pace ---------- */

  await page.getByRole('button', { name: /Needs attention/ }).click()
  await page.waitForTimeout(300)
  await t.shot(page, '41-needs-attention')
  const attention = await page.locator('table').nth(1).locator('tbody tr')
    .evaluateAll((rows) => rows.map((r) => r.innerText))
  t.ok('the collector at half a per cent is on the list',
    attention.some((r) => r.includes('Thandi Junior')))
  t.check('...and the one past target is not', attention.some((r) => r.includes('Test Leader')), false)

  /* ---------- the fair comparison survived the redesign ---------- */

  /*
   * Rand leads the page now, which is what the firm runs the month on. The figures that compare
   * two collectors fairly must still be on the screen, or the redesign quietly turned the page
   * into the rand leaderboard the whole of collectorScore.ts exists to prevent.
   */
  t.ok('the fair comparison is still on the page', (await headers()).includes('PER 100'))
  t.ok('...and still says what it is for',
    await page.getByText(/should decide who is promoted/).first().isVisible())

  /* ---------- the ranking the firm asked for, with its context ---------- */

  /*
   * THE RANKING ON RAND EXISTS AND IS NOT THE DEFAULT. The firm asked for it and answered the
   * obvious objection themselves: "so the people know that if they're senior collectors they get
   * more work, it's not a pissing contest." That only holds if the grade and the book are on the
   * row beside the rand, which is what is checked here — in the browser, because it is a claim
   * about what somebody reading the row actually sees.
   */
  await page.getByRole('button', { name: 'Ranking' }).click()
  await page.waitForTimeout(300)
  await t.shot(page, '42-ranking')
  const ranked = await headers()
  t.ok('the ranking gives everybody a place', ranked.includes('PLACE'))
  t.ok('...with their grade beside it', ranked.includes('GRADE'))
  t.ok('...and the size of their book', ranked.includes('ACCOUNTS'))
  t.ok('...and how many people paid them', ranked.includes('PAYMENTS'))
  t.ok('...and what the average payment was', ranked.includes('AVERAGE PAYMENT'))
  t.ok('...and says in words why rand and book are read together',
    await page.getByText(/part of their rand is the book they were handed/).first().isVisible())

  const rankRows = page.locator('table').nth(1).locator('tbody tr')
  /*
   * The name cell carries the avatar's initials on their own line, and on your own row a "(you)"
   * after the name — so neither the first line nor the last is reliably the name. Dropping both
   * markers is what leaves it.
   */
  const order = await rankRows.evaluateAll((rows) => rows.map((r) => {
    const lines = (r.querySelectorAll('td')[1]?.innerText ?? '').split('\n')
      .map((l) => l.trim()).filter(Boolean)
    return lines.filter((l) => l !== '(you)' && !/^[A-Z]{1,3}$/.test(l))[0] ?? ''
  }))
  /* Test Leader R120 000, Unteamed Clerk R7 000, Thandi Junior R500 — biggest first. */
  t.check('the biggest collector is first', order[0], PROFILE.name)
  t.check('...and the smallest last', order[order.length - 1], COLLEAGUE.name)

  /* ---------- one collector's own page ---------- */

  await rankRows.first().getByRole('link').click()
  await page.getByText('On the floor this month').waitFor({ timeout: 20000 })
  /* The chart's bars grow from nothing on mount, and a screenshot taken on the first frame shows
     an empty frame. The bar COUNT below is the real check; this is so the picture is worth
     looking at. */
  await page.waitForTimeout(900)
  await t.shot(page, '43-collector')

  t.ok('a collector has a page of their own',
    page.url().includes(`/performance/${USER_ID}`))
  t.ok('...saying where they stand on rand',
    await page.getByText(/1st of 3/).first().isVisible())
  t.ok('...with their grade above it',
    await page.getByText(/Senior collector/).first().isVisible())
  t.ok('...and the size of their book beside it',
    await page.getByText(/400 accounts on the book/).first().isVisible())
  t.ok('...their promises, taken kept and broken',
    await page.getByText('Still to come').first().isVisible())
  t.ok('...how the day is spent', await page.getByText('How the day is spent').first().isVisible())
  t.ok('...what they did with their traces', await page.getByText('Traces').first().isVisible())
  t.ok('...and twelve months behind them',
    await page.getByText(/Collections, last 12 months/).first().isVisible())
  /*
   * AND THE CHART ACTUALLY HAS BARS IN IT. The heading renders whether or not a single figure
   * reached it, so asserting the heading alone would pass over an empty frame — which is exactly
   * what a broken bucketing looks like: axes, gridlines, target line, and nothing drawn.
   */
  const bars = await page.locator('.recharts-bar-rectangle').count()
  t.ok(`the twelve months are drawn, not just framed (${bars} bars)`, bars >= 6)
  /*
   * WHATSAPP IS SAID, NOT LEFT BLANK. Raptor does not send or store one, and a tile reading
   * "WhatsApp 0" would be a lie that looks like a quiet month.
   */
  t.ok('WhatsApp is named as not counted',
    await page.getByText(/WhatsApp is not counted here/).first().isVisible())

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

const good = t.finish(`The day and the period are different figures, the month is marked with the
pace expected by now, the roster is alphabetical rather than a rand leaderboard, a collector past
target gets a second bar in another colour, and the team filter moves the headline as well as the
list. Screenshots in ${OUT}.`)
process.exit(good ? 0 : 1)

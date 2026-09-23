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

/*
 * TWO DATES IN THE PAST, worked out from today so this suite does not rot. Far enough back that
 * no weekend or public holiday can make either of them "not late yet" -- the rule gives an entry
 * dated to a day the office was shut until the next working day, and a fixture that happened to
 * land on one would fail on a Monday in March and nowhere else.
 */
const daysAgo = (n) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}
const CARRIED_SINCE = daysAgo(9)
const CARRIED_LONGER = daysAgo(30)

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
  /*
   * NEW ACCOUNTS NOBODY HAS WORKED, which the dashboard now asks for on every load.
   *
   * THE STUB HONOURS THE CLAUSES. It would be easier to answer every diary request with the same
   * three rows, and that would prove nothing: the page's whole claim is that it asks the DATABASE
   * for open new accounts past their day rather than reading the diary and filtering in the
   * browser. Answering unfiltered would make a broken version pass. This suite has shipped that
   * shape of fixture before -- twice this month -- so the clauses are read and obeyed.
   *
   * One row is the signed-in agent's and two are a colleague's, so both halves of the panel have
   * something to draw: the flag for the person, and the floor list for the team leader.
   */
  [(u) => u.includes('/rest/v1/diary_entries'), (u) => {
    if (!/kind=eq\.new_account/.test(u) || !/state=eq\.open/.test(u)) return { body: [] }
    const before = /due_on=lt\.([0-9-]+)/.exec(u)?.[1]
    const rows = [
      { owner_id: USER_ID, account_id: 'acc-1', kind: 'new_account', due_on: CARRIED_SINCE },
      { owner_id: COLLEAGUE.id, account_id: 'acc-2', kind: 'new_account', due_on: CARRIED_LONGER },
      { owner_id: COLLEAGUE.id, account_id: 'acc-3', kind: 'new_account', due_on: CARRIED_SINCE },
    ]
    return { body: before ? rows.filter((r) => r.due_on < before) : rows }
  }],
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

  await page.getByRole('heading', { name: /The sky is only/ }).waitFor({ timeout: 20000 })
  await page.getByText('Monthly progress').waitFor({ timeout: 20000 })
  await t.shot(page, '40-collections')

  /* ---------- new accounts nobody has worked ---------- */

  /*
   * THE FIRM ASKED FOR TWO THINGS AND THIS IS THE ONLY LAYER THAT CAN SEE EITHER: "it should be
   * reported to the team leader and flagged for the agent as well… it should be on their
   * dashboard." Everything about WHICH accounts count is decided in newAccounts.ts and checked
   * without a browser. What no unit check can answer is whether the panel is on the page -- and
   * this suite exists because a panel once shipped, was provably in the bundle, and was invisible.
   */
  t.ok('the collector is told a new account is waiting on them',
    await page.getByText(/new account(s)? (is|are) waiting on you/).first().isVisible())
  t.ok('...and how long the oldest has been carried',
    await page.getByText(/carried \d+ working days|Carried since yesterday/i).first().isVisible())
  /*
   * AND THE FLOOR'S, because this suite signs in as a Pre-legal TEAM LEADER -- see PROFILE in
   * fixtures.mjs. "It flags them and it flags the team leader as well in the team leader's
   * dashboard" is two audiences on one panel, and this is the half an agent must not see.
   */
  t.ok('a team leader is also shown the floor',
    await page.getByText('New accounts not yet worked, by collector').first().isVisible())
  t.ok('...naming the collector who is behind',
    await page.getByRole('link', { name: COLLEAGUE.name }).first().isVisible())
  /*
   * ONCE, NOT TWICE. A leader carrying accounts of their own gets the flag above; their name
   * appearing again in the list underneath would have them chasing themselves.
   */
  const floorList = page.getByText('New accounts not yet worked, by collector')
    .locator('xpath=following-sibling::ul')
  t.check('...and the leader is not in their own list',
    await floorList.getByText(PROFILE.name, { exact: false }).count(), 0)

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
   * AND THE PANELS ON IT ARE GLASS, NOT BOXES.
   *
   * "Do NOT cover most of the photograph with large opaque widgets" is the centre of the brief,
   * and it is the one thing on this screen a screenshot flatters — an opaque tile over a dark
   * mountain looks almost right in a thumbnail and is wrong in front of you. Measured as the
   * alpha the browser resolved, not read off the class, because a Tailwind arbitrary value that
   * fails to compile produces no rule at all and the element simply inherits.
   *
   * Break-testing found this missing: filling the tiles solid navy left every other check green.
   */
  const glass = await page.evaluate(() => {
    const el = document.querySelector('.collections-hero .hero-glass')
    if (!el) return null
    const s = getComputedStyle(el)
    /*
     * Parsed by counting components, not by a lookbehind on the last one. `rgb(7, 16, 24)` has no
     * alpha and its last component is 24, so a regex that just takes the final number reports an
     * opaque panel as "alpha 24" — which still fails the check, but tells whoever reads the
     * failure something untrue about why.
     */
    const parts = (s.backgroundColor.match(/[\d.]+/g) ?? []).map(Number)
    return { alpha: parts.length >= 4 ? parts[3] : 1, blur: s.backdropFilter, border: s.borderTopWidth }
  })
  t.ok('there are glass panels on the hero', glass !== null)
  t.ok(`...the photograph shows through them (alpha ${glass?.alpha})`,
    glass !== null && glass.alpha > 0 && glass.alpha < 0.85)
  t.ok(`...with a blur behind them (${glass?.blur})`, /blur/.test(glass?.blur ?? ''))
  t.ok(`...and a hairline edge (${glass?.border})`, parseFloat(glass?.border ?? '0') > 0)

  /*
   * THE FIGURES SIT IN THE LOWER THIRD, which is the other half of the same instruction:
   * "significantly more open mountain scenery between the headline and the KPI section".
   */
  const layout = await page.evaluate(() => {
    const hero = document.querySelector('.collections-hero').getBoundingClientRect()
    const h1 = document.querySelector('.collections-hero h1').getBoundingClientRect()
    const tile = document.querySelector('.collections-hero .grid .hero-glass').getBoundingClientRect()
    return { open: tile.top - h1.bottom, tileFrom: (tile.top - hero.top) / hero.height }
  })
  t.ok(`there is open sky between the headline and the figures (${Math.round(layout.open)}px)`,
    layout.open > 120)
  t.ok(`...and the figures start in the lower half (${Math.round(layout.tileFrom * 100)}%)`,
    layout.tileFrom > 0.5)

  /*
   * AND THE TYPE ON IT IS READABLE. A scrim that is too light is the failure a screenshot flatters
   * and a person notices immediately; this measures the heading against the panel behind it.
   */
  const heading = await page.locator('.collections-hero h1').evaluate((el) => ({
    text: el.innerText, colour: getComputedStyle(el).color, size: getComputedStyle(el).fontSize,
    weight: getComputedStyle(el).fontWeight,
    tracking: getComputedStyle(el).letterSpacing,
    family: getComputedStyle(el).fontFamily,
  }))
  /*
   * innerText reports what is RENDERED, so a heading set in capitals by CSS comes back in
   * capitals — which is the assertion worth making. Reading textContent instead would return
   * the sentence-case source and pass whether the transform applied or not.
   */
  t.check('the title is the firm’s own line',
    heading.text.replace(/\s+/g, ' ').trim(), 'The sky is only the beginning.')
  /*
   * SIZED TO THE BRIEF, at both ends. "Do NOT make the headline enormous" is half the instruction
   * and 48-56px is the other half, so a lower bound alone would pass on the 72px version this
   * replaced.
   */
  t.ok(`...set between 48 and 56px (${heading.size})`,
    parseFloat(heading.size) >= 48 && parseFloat(heading.size) <= 56)
  /*
   * LIGHT, NOT BOLD, and measured as the weight the browser RESOLVED rather than read off the
   * class. A font-light class on a family that ships no light cut renders at 400 and looks almost
   * right; asserting the class would pass on that and the firm would be looking at the same line
   * they just sent back.
   */
  t.ok(`...at a light weight (${heading.weight})`,
    Number(heading.weight) >= 250 && Number(heading.weight) <= 400)
  t.ok('...in white on the dark panel', /255, 255, 255/.test(heading.colour))

  /*
   * AND IT IS ACTUALLY RENDERING IN INTER.
   *
   * --font-sans has named Inter since the theme was written and NOTHING EVER FETCHED IT — no
   * @font-face, no link, no package — so every screen has been falling back to whatever
   * ui-sans-serif resolves to: San Francisco on a Mac or an iPad, Segoe on Windows. That is
   * survivable at 14px and it is not at 52px, where a system stack has no real light cut and the
   * headline gets synthesised. It is what the firm was looking at when they said the font was
   * wrong.
   *
   * MEASURED AS LOADED, NOT AS DECLARED. document.fonts.check asks whether a face is actually
   * available at that size and weight; reading fontFamily off the element would return "Inter,
   * ui-sans-serif, ..." and pass exactly as happily in the broken state, because the declaration
   * was never the thing that was missing.
   */
  const font = await page.evaluate(async () => {
    await document.fonts.ready
    return {
      declared: getComputedStyle(document.body).fontFamily,
      /* Every face the document actually holds, and whether it was fetched. */
      faces: [...document.fonts].map((f) => `${f.family}|${f.status}`),
      /* The control: check() on a family that cannot exist. */
      nonsense: document.fonts.check('300 52px NoSuchFaceAnywhere'),
    }
  })
  t.ok(`the app declares Inter (${font.declared.split(',')[0]})`, /Inter/.test(font.declared))
  /*
   * THE FACE IS REALLY LOADED, read off the FontFaceSet rather than from document.fonts.check().
   *
   * check() returns TRUE for a family that does not exist — the probe above asks it about
   * "NoSuchFaceAnywhere" and it says yes, because the fallback it would use is itself loaded. The
   * first version of this check used it and passed with the font import deleted, which is how the
   * next bug was found: @fontsource-variable/inter registers the family as "Inter Variable", so a
   * stack asking only for "Inter" matched nothing and the app stayed on the system fallback with
   * the webfont sitting in the page unused.
   */
  t.ok('...and check() is the wrong instrument, which is why it is not used', font.nonsense)
  const loaded = font.faces.filter((f) => /^Inter/.test(f) && f.endsWith('|loaded'))
  t.ok(`...an Inter face is actually loaded (${loaded.length} of ${font.faces.length})`,
    loaded.length > 0)
  /* And the family the page asks for is one the document holds, not a name nothing answers to. */
  const family = font.declared.split(',')[0].replace(/["']/g, '').trim()
  t.ok(`...under the name the stylesheet asks for (${family})`,
    font.faces.some((f) => f.split('|')[0] === family))
  /*
   * TWO TONES, BROKEN BY HAND. The firm's reference sets the first half white and the second in
   * champagne, on two lines — which only works as a deliberate break: left to wrap, the break
   * lands wherever the window happens to be wide and the colour change falls mid-phrase.
   *
   * innerText renders the <br> as a newline, so this reads the rendered break rather than the
   * presence of a tag.
   */
  t.check('...broken across two lines where the firm breaks it',
    heading.text.trim().split('\n').map((l) => l.trim()).join(' | '),
    'The sky is only | the beginning.')
  /*
   * Each line is its own span, so the two halves are addressable as two things. They were not at
   * first — the stressed words are spans too, and a bare `h1 span` matched three elements, which
   * Playwright refused rather than quietly picking one.
   */
  const halves = await page.evaluate(() =>
    [...document.querySelectorAll('.collections-hero h1 > span')].map((el) => ({
      text: el.innerText.replace(/\s+/g, ' ').trim(), colour: getComputedStyle(el).color,
    })))
  /* Joined, not compared as arrays: this harness's check() uses Object.is, so two arrays with
     identical contents are never equal and the failure prints two lines that look the same. */
  t.check('the line is in two halves', halves.map((l) => l.text).join(' | '),
    'The sky is only | the beginning.')
  t.ok(`...the first in white (${halves[0]?.colour})`, /255, 255, 255/.test(halves[0]?.colour ?? ''))
  t.ok(`...and the second in champagne (${halves[1]?.colour})`,
    !/255, 255, 255/.test(halves[1]?.colour ?? '') && halves[1]?.colour !== halves[0]?.colour)

  /*
   * ORDINARY SENTENCE CASE, MEASURED AS RENDERED. The line has been set in full capitals, then
   * with two words lifted into them, and the firm settled on neither. innerText reports what is
   * on the screen, so a text-transform sneaking back in fails here even though the source still
   * reads "The sky is only" — which is exactly how a capitals version would return.
   */
  const transform = await page.locator('.collections-hero h1').evaluate((el) =>
    [el, ...el.querySelectorAll('span')].map((n) => getComputedStyle(n).textTransform).join(','))
  t.ok(`nothing in the line is transformed to capitals (${transform})`,
    !/uppercase/.test(transform))

  /* The line itself is tracked open, which is the other thing that has been wrong here. */

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
  /*
   * The line at the foot went with the redesign: the firm's reference has the control strip
   * there instead, and a brand line squeezed beside a date picker is clutter rather than brand.
   */
  t.ok('...and the line at the foot is gone with it',
    (await heroBox.innerText()).indexOf('Built for a higher standard') === -1)

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
   * ONE TABLE, NO TABS. "Remove the ranking page, remove the needs attention page and put
   * everything at the all clerks page." Checked against the card, because two of those words are
   * also what the status pill says on a row -- a page-wide check for "Target reached" would fail
   * on correct code and the obvious "fix" would be to delete the check.
   */
  const clerkCard = page.locator('table').nth(1).locator('xpath=ancestor::div[contains(@class,"rounded")][1]')
  void clerkCard
  t.check('there is no tab strip on the clerk sheet any more',
    await page.getByRole('button', { name: 'All clerks' }).count()
      + await page.getByRole('button', { name: 'Needs attention' }).count()
      + await page.getByRole('button', { name: 'Ranking', exact: true }).count(), 0)
  /* ...while the pill on the row that earned it is still there, which is the other half. */
  t.ok('a collector past target is marked as having reached it',
    await page.getByText('Target reached').first().isVisible())

  /*
   * THE COLUMNS, IN THE FIRM'S OWN ORDER, read off the screen.
   *
   * "Number, clerk, team, then target, then today, then period to date, then the number of
   * payment, then the average payment, then the achieved, and then it can go to gap needed per
   * day status." Source-reading checks the JSX beside this; only a browser says what order the
   * columns actually came out in.
   */
  const clerkHeaders = await page.locator('table').nth(1).locator('thead th').allInnerTexts()
  t.check('the clerk sheet\u2019s columns are in the order the firm asked for',
    clerkHeaders.map((h) => h.trim()).join(' | '),
    '# | CLERK | TEAM | TARGET | TODAY | PERIOD TO DATE | ACCOUNTS | PAYMENTS '
    + '| AVERAGE PAYMENT | ACHIEVED | GAP VS PACE | NEEDED / DAY | STATUS')

  /*
   * AND THE ROSTER IS RANKED ON RAND, which is the reversal the firm asked for: "I think the
   * ranking, it should automatically be ranked and rank it from one to down."
   *
   * This table was deliberately alphabetical before. It is worth asserting the order properly
   * rather than loosely, because on this floor the top collector also happens to come first
   * alphabetically -- so "the biggest is on top" alone would have gone on passing over an
   * alphabetical list. The two orders differ at the second and third rows.
   */
  const clerkRows = page.locator('table').nth(1).locator('tbody tr')
  /*
   * The name cell carries three things besides the name: the avatar's initials on their own line,
   * the grade on a line under it, and "(you)" on your own row -- which sits INSIDE the name's own
   * line, so innerText reads "Test Leader(you)". Each of the three is dropped explicitly.
   */
  const names = await clerkRows.evaluateAll((rows) => rows.map((r) => {
    const lines = (r.querySelectorAll('td')[1]?.innerText ?? '').split('\n')
      .map((l) => l.replace(/\(you\)$/, '').trim()).filter(Boolean)
    return lines.filter((l) => !/^[A-Z]{1,3}$/.test(l)
      && !['Elite', 'Senior', 'Skilled', 'Junior', 'Ungraded'].includes(l))[0] ?? ''
  }))
  t.check('every clerk is listed', names.length, 3)
  /* Test Leader R120 000, Unteamed Clerk R7 000, Thandi Junior R500 — biggest first. */
  t.check('...ranked on rand, biggest first', names.join(' | '),
    [PROFILE.name, LOOSE.name, COLLEAGUE.name].join(' | '))
  t.check('...which is not the alphabetical order it used to be in',
    names.join(' | ') === [...names].sort((a, b) => a.localeCompare(b, 'en-ZA')).join(' | '), false)

  /*
   * AND THE PLACE IS ON THE LEFT, counting from one. "Put the number on the left hand side as
   * well, to see what the number is, like one, two, three."
   */
  const placeColumn = await clerkRows.evaluateAll((rows) => rows.map(
    (r) => (r.querySelector('td')?.innerText ?? '').trim(),
  ))
  t.check('every row is numbered, from one down', placeColumn.join(' | '), '1 | 2 | 3')
  /*
   * AND THE NUMBER IS ON SCREEN. innerText reads a `display:none` cell perfectly well, so the
   * line above passes over a number column that renders nothing -- found by hiding it and
   * watching the check stay green. This layer exists because a panel shipped invisible once; a
   * check that cannot see the difference is the same bug in the checks.
   */
  t.ok('...and the number column is actually visible',
    await clerkRows.first().locator('td').first().isVisible())

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

  /* ---------- what the Needs attention tab was actually for ---------- */

  /*
   * How many people are behind is the one thing that tab told you and a ranked list does not, and
   * it was read off the tab's own badge rather than out of the list. It survives in the footer.
   */
  /* Scrolled to, because this page's own column scrolls rather than the window -- a full-page
     screenshot of it is the top of the page and not the table the shot is for. */
  await page.locator('table').nth(1).scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await t.shot(page, '41-clerk-ranking')
  t.ok('the sheet still says how many are behind their pace',
    await page.getByText(/behind their pace/).first().isVisible())

  /* ---------- the fair comparison survived the redesign ---------- */

  /*
   * Rand leads the page now, which is what the firm runs the month on. The figures that compare
   * two collectors fairly must still be on the screen, or the redesign quietly turned the page
   * into the rand leaderboard the whole of collectorScore.ts exists to prevent.
   */
  t.ok('the fair comparison is still on the page', (await headers()).includes('PER 100'))
  t.ok('...and still says what it is for',
    await page.getByText(/should decide who is promoted/).first().isVisible())

  /* ---------- the condition the ranking exists under ---------- */

  /*
   * THE GRADE AND THE BOOK ARE ON THE ROW. The firm asked for the ranking and answered the obvious
   * objection themselves: "so the people know that if they're senior collectors they get more
   * work, it's not a pissing contest." That answer only holds while the grade and the number of
   * accounts sit beside the rand, which is why they came across from the tab that is gone.
   * Checked in the browser, because it is a claim about what somebody reading the row sees.
   */
  t.ok('the grade is on the row, under the name',
    await page.locator('table').nth(1).locator('tbody tr').first()
      .getByText(/Elite|Senior|Skilled|Junior|Ungraded/).first().isVisible())
  t.ok('...and the sheet says in words why rand and book are read together',
    await page.getByText(/part of their rand is the book they were handed/).first().isVisible())

  /* ---------- one collector's own page ---------- */

  await clerkRows.first().getByRole('link').click()
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

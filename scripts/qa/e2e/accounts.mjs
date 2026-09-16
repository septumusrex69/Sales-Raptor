/**
 * The accounts screen, driven in a real browser.
 *
 * WHAT THIS CATCHES THAT NOTHING ELSE DOES. The .mjs checks beside this folder read source and
 * assert against pure functions, which is why they are fast and why they cannot tell you the
 * panel never rendered. Earlier this session a panel shipped, was present in the deployed
 * bundle, and was invisible — a placement bug no unit check could have seen. This is the layer
 * that sees it.
 *
 * Run: node scripts/qa/e2e/accounts.mjs
 * Screenshots land in .qa-screenshots/ so the result can be looked at, not just read.
 */
import {
  OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer,
} from './harness.mjs'
import {
  BENCH, BOOK_SUMMARY, COMPANY, FACETS, PROFILE, COLLEAGUE, TEAM, UNGRADED, USER_ID, VIEW_COUNTS,
  accountsPage,
} from './fixtures.mjs'

const t = makeRunner('accounts')
const PAGE_SIZE = 100
const seen = []

/* What the app asks for, and what it gets back. First match wins. */
const handlers = [
  [(u) => u.includes('/auth/v1/user'), () => ({ body: { id: USER_ID, email: PROFILE.email } })],
  [
    (u) => u.includes('/rest/v1/profiles'),
    (u) => {
      /*
       * AuthContext asks for ONE profile with .maybeSingle(), which PostgREST fails if more than
       * one row comes back — and a failed profile fetch leaves currentUser null, so the app runs
       * as somebody with no role at all. That shows up as a missing view and dead checkboxes
       * three screens later, nowhere near the cause. So an id-scoped request gets exactly one row.
       */
      const one = /id=eq\.([0-9a-f-]+)/.exec(u)?.[1]
      const all = [PROFILE, COLLEAGUE, UNGRADED, ...BENCH]
      if (one) return { body: all.filter((p) => p.id === one) }
      return { body: all }
    },
  ],
  [(u) => u.includes('/rest/v1/companies'), () => ({ body: [COMPANY] })],
  [(u) => u.includes('/rest/v1/teams'), () => ({ body: [TEAM] })],
  [(u) => u.includes('/rpc/book_summary'), () => ({ body: [BOOK_SUMMARY] })],
  [(u) => u.includes('/rpc/book_facets'), () => ({ body: FACETS })],
  [(u) => u.includes('/rpc/account_view_counts'), () => ({ body: [VIEW_COUNTS] })],
  [(u) => u.includes('/rpc/nav_counts'), () => ({ body: { mail: 0, tasks: 0, disputes: 0 } })],
  /* What the hand-out planner reads: who carries what, and what is already in their diaries. */
  [(u) => u.includes('/rpc/collector_book_load'), () => ({
    body: [
      { user_id: PROFILE.id, in_play_accounts: 120, in_play_value: 900000, total_accounts: 140 },
      { user_id: COLLEAGUE.id, in_play_accounts: 470, in_play_value: 300000, total_accounts: 480 },
      // Uneven books across the bench, so the list is not a column of identical rows.
      ...BENCH.map((p, i) => ({
        user_id: p.id, in_play_accounts: 20 + (i * 17) % 260,
        in_play_value: 100000 + i * 40000, total_accounts: 300,
      })),
    ],
  })],
  /*
   * ONE DIARY THAT IS ALREADY OVERFULL, on purpose. With every diary empty the plan can never
   * push anybody past their day, so the red path in the preview is never rendered and a check
   * that "the red count agrees with the cells" passes by both sides being zero — which is exactly
   * what happened the first time it was written. A collector holding 60 against a 50-a-day
   * capacity makes the case real.
   */
  [(u) => u.includes('/rpc/diary_day_load'), () => ({
    body: [{ owner_id: BENCH[0].id, due_on: '2026-09-16', entries: 60 }],
  })],
  [(u) => u.includes('/rest/v1/diary_entries'), () => ({ body: [] })],
  [
    (u) => u.includes('/rest/v1/debtor_accounts'),
    (u, req) => {
      /*
       * An id list is a different question from a filter: the hand-out modal asks for exactly
       * the accounts that were ticked. Answering it with a page of the whole book would make the
       * modal offer to hand out a hundred accounts somebody never selected — and look correct.
       */
      const idList = /id=in\.\(([^)]*)\)/.exec(decodeURIComponent(u))?.[1]
      if (idList) {
        const wanted = new Set(idList.split(',').map((s) => s.replace(/^"|"$/g, '')))
        const rows = accountsPage(VIEW_COUNTS.whole_book).filter((r) => wanted.has(r.id))
        return {
          body: rows,
          headers: { 'content-range': `0-${Math.max(0, rows.length - 1)}/${rows.length}` },
        }
      }

      /*
       * The total comes from the content-range header, not the body — that is how PostgREST
       * reports a count and how fetchAccounts reads it. A fixture that returned the rows and
       * omitted this would make the pager and the scope line silently say "of 0".
       */
      const total = narrowedTotal(u)
      /*
       * THE PAGE SIZE IS HONOURED, or the control that sets it cannot be tested. postgrest-js
       * asks for a page with a Range HEADER, not a query parameter, so a fixture reading only the
       * URL hands back a hundred rows however many were asked for — and "Show 500" then looks
       * broken on a screen that is working. Both forms are read because which one is sent is a
       * detail of the client library, not of this app.
       */
      const range = /(\d+)-(\d+)/.exec(req?.headers()?.range ?? '')
      const from = Number(/offset=(\d+)/.exec(u)?.[1] ?? range?.[1] ?? 0)
      const limit = Number(/limit=(\d+)/.exec(u)?.[1]
        ?? (range ? Number(range[2]) - Number(range[1]) + 1 : PAGE_SIZE))
      const rows = accountsPage(Math.max(0, Math.min(limit, total - from)), from)
      const last = from + rows.length - 1
      return {
        body: rows,
        headers: { 'content-range': `${from}-${Math.max(from, last)}/${total}` },
      }
    },
  ],
]

/** The filters the URL carries, reflected in the count, so narrowing visibly changes the screen. */
function narrowedTotal(url) {
  if (url.includes('bucket=eq.Failed')) return VIEW_COUNTS.broken_promises
  if (url.includes('sub_status=eq.Promise')) return VIEW_COUNTS.promises_due
  if (url.includes('assigned_to=is.null')) return VIEW_COUNTS.unallocated
  if (url.includes(`assigned_to=eq.${USER_ID}`)) return VIEW_COUNTS.my_desk
  if (url.includes('diary_date=is.null')) return VIEW_COUNTS.adrift
  return VIEW_COUNTS.whole_book
}

const server = await startServer()
let browser
try {
  browser = await chromium.launch()
  const { page } = await signedInPage(browser, PROFILE, handlers, seen)

  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)) })
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 160)}`))

  let up = false
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/accounts`, { timeout: 2000 }); up = true; break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  t.ok('the dev server answers', up)

  const table = page.locator('table tbody tr')
  await table.first().waitFor({ timeout: 20000 })
  await t.shot(page, '01-accounts-whole-book')

  /* ---------- the views row ---------- */

  const views = page.locator('button', { hasText: /^(Whole book|My desk|Unallocated|No diary date|Broken promises|Promises due|Gone quiet)/ })
  const viewLabels = (await views.allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim())
  console.log('  views on screen:', JSON.stringify(viewLabels))
  console.log('  scope line:', JSON.stringify((await page.locator('text=/Showing .* of /').first().innerText().catch(() => '(none)'))))
  t.check('all seven views are offered', await views.count(), 7)

  const bookBtn = page.getByRole('button', { name: /Whole book/ })
  t.ok('the whole book shows its count', (await bookBtn.innerText()).includes('736'))
  t.ok('broken promises shows its count',
    (await page.getByRole('button', { name: /Broken promises/ }).innerText()).includes('40'))
  t.ok('gone quiet shows its count',
    (await page.getByRole('button', { name: /Gone quiet/ }).innerText()).includes('557'))

  /* ---------- the scope line ---------- */

  const scope = page.locator('text=/Showing .* of /').first()
  t.ok('the scope line is on screen', await scope.isVisible())
  t.ok('...and names both figures', /Showing 100 of 736/.test(await scope.innerText()))
  t.ok('...and is not claiming to be narrowed', !(await scope.innerText()).includes('narrowed'))

  /*
   * HOW MANY ROWS, AT THE TOP. This lived only at the foot of the table as "Load 100 more", so
   * asking for more of the book meant scrolling past all of it first — and a shuffle is three
   * thousand accounts that have to be ticked in one go.
   *
   * Asserted inside the scope bar, not the page: "Load 500 more" at the bottom would satisfy a
   * body-wide search while the control was still in the wrong place, which is the whole bug.
   */
  const sizes = page.locator('text=/Showing .* of /').first().locator('..')
  t.ok('the page size sits with the count it changes', /Show/.test(await sizes.innerText()))
  /*
   * Compared on DIGITS, not on the rendered string. This Chromium renders en-ZA thousands with a
   * comma where Node renders the non-breaking space the house notes describe — same locale, two
   * ICU builds — so an assertion on "1 000" fails on a screen that is perfectly correct. The
   * separator is not what this check is about.
   */
  const offered = (await sizes.locator('button[aria-pressed]').allInnerTexts())
    .map((x) => Number(x.replace(/\D/g, '')))
  t.check('...offering the sizes this book can fill', offered.join(), '100,500,1000')
  /*
   * And NOT 2 000, which 736 accounts cannot fill. A control that does nothing when pressed is
   * one people stop trusting the rest of.
   */
  t.ok('...and not one it cannot', !offered.includes(2000))
  /* It has to actually change the request, not just light up. */
  await sizes.locator('button[aria-pressed]').nth(1).click()
  await page.waitForFunction(() => /Showing 500 of 736/.test(document.body.innerText), { timeout: 15000 })
  t.ok('choosing a bigger page actually loads it',
    /Showing 500 of 736/.test(await page.locator('body').innerText()))
  await sizes.locator('button[aria-pressed]').first().click()
  await page.waitForFunction(() => /Showing 100 of 736/.test(document.body.innerText), { timeout: 15000 })

  /* ---------- clicking a view narrows, visibly ---------- */

  await page.getByRole('button', { name: /Broken promises/ }).click()
  await page.waitForFunction(() => /Showing \d+ of 40/.test(document.body.innerText), { timeout: 15000 })
  await t.shot(page, '02-accounts-broken-promises')

  t.ok('the URL says what is on screen', page.url().includes('bucket=Failed+PTPs'))
  const narrowedScope = await page.locator('text=/Showing .* of /').first().innerText()
  t.ok('the scope line follows', /of 40/.test(narrowedScope))
  /*
   * Asked for directly rather than read off the "Showing ..." element. A text= locator matches
   * the SMALLEST element containing the text, which is the span holding the figures -- and
   * "narrowed" is its sibling, so reading innerText there would report the warning missing
   * whether or not it was on screen.
   */
  t.ok('...and admits it is narrowed', await page.getByText('narrowed', { exact: true }).isVisible())
  t.ok('...and offers the way back',
    await page.getByRole('button', { name: 'Show the whole book' }).isVisible())
  t.ok('the chip reads in the firm’s words, not Swordfish’s',
    await page.getByRole('button', { name: /Broken promises/ }).nth(1).isVisible()
      || (await page.locator('body').innerText()).includes('Broken promises'))
  t.check('the rows follow the filter', await table.count(), 40)

  /* ---------- and the way back ---------- */

  await page.getByRole('button', { name: 'Show the whole book' }).click()
  await page.waitForFunction(() => /Showing \d+ of 736/.test(document.body.innerText), { timeout: 15000 })
  t.ok('the whole book comes back', (await page.locator('text=/Showing .* of /').first().innerText()).includes('736'))

  /* ---------- the filter panel ---------- */

  await page.getByRole('button', { name: /^Filters/ }).click()
  await page.waitForTimeout(300)
  await t.shot(page, '03-accounts-filters-open')
  const panel = await page.locator('body').innerText()
  t.ok('the panel offers a status', panel.includes('Any status'))
  t.ok('...and a sub-status', panel.includes('Any sub-status'))
  t.ok('...and a team', panel.includes('Any team'))
  /*
   * The two the firm asked to be taken away. "Bucket" is Swordfish's word for its own work queue
   * and nobody there uses it; mandate drift was not wanted as a filter.
   */
  t.ok('no bucket control', !panel.includes('Any bucket'))
  t.ok('no mandate-rate filter', !panel.includes('Off their mandate rate'))
  await page.keyboard.press('Escape')

  /* ---------- selection and the bulk bar ---------- */

  const boxes = page.locator('table tbody input[type="checkbox"]')
  await boxes.nth(0).check()
  await boxes.nth(1).check()
  await boxes.nth(2).check()
  t.ok('the bulk bar counts what is ticked',
    (await page.locator('text=/\\d+ selected/').first().innerText()).startsWith('3'))
  await t.shot(page, '04-accounts-selection')

  /* The page is not the book: ticking the header offers the rest. */
  await page.locator('thead input[type="checkbox"]').check()
  const selectAll = page.getByRole('button', { name: /Select all .* matching/ })
  t.ok('selecting the page offers the whole filter', await selectAll.isVisible())
  await selectAll.click()
  t.ok('...and the count becomes the whole book',
    (await page.locator('text=/\\d+ selected/').first().innerText()).includes('736'))

  /* ---------- the allocate modal ---------- */

  /* ---------- the hand-out planner ---------- */

  /*
   * Back to a page-sized selection first: the plan is built in the browser from the accounts it
   * actually loaded, and "all 736 matching" is above the bulk ceiling on purpose.
   */
  await page.getByRole('button', { name: /Broken promises/ }).first().click()
  await page.waitForFunction(() => /Showing \d+ of 40/.test(document.body.innerText), { timeout: 15000 })
  await page.locator('thead input[type="checkbox"]').check()
  await page.getByRole('button', { name: /^Hand out/ }).click()
  await page.waitForFunction(
    () => /accounts to hand out/.test(document.body.innerText), { timeout: 20000 },
  )
  await page.waitForTimeout(400)
  await t.shot(page, '05-hand-out-plan')
  const modal = await page.locator('body').innerText()

  t.ok('the modal says how many it is handing out', /40 accounts to hand out/.test(modal))
  /*
   * A grade is what makes somebody a collector, and both fixture people have one — so both are
   * offered, with what they carry and what they work in a day.
   */
  t.ok('it offers the graded people', modal.includes('Test Leader') && modal.includes('Thandi Junior'))
  /*
   * The list states the same facts in one line each: grade, then book against ceiling. The card
   * layout's sentence ("Senior · 120/500 on the book · 40 a day") is gone, so the old assertions
   * described a screen that no longer exists.
   */
  t.ok('a row carries the grade', /Senior/.test(modal))
  t.ok('...and the book against the ceiling', /120\/500/.test(modal))
  t.ok('...including an overloaded one', /470\/150/.test(modal))
  /*
   * THE CASE THE FIRM CAUGHT. A pre-legal clerk with no grade used to be filtered out entirely,
   * so a firm whose clerks were all ungraded saw a hand-out screen offering nobody. The role
   * admits them; the grade only widens which accounts they may be given.
   */
  t.ok('an ungraded clerk is still offered', modal.includes('Itumeleng Agent'))
  t.ok('...marked as ungraded', /Not graded/.test(modal))

  /*
   * A LIST THAT SURVIVES A REAL FLOOR. Eight collectors fitted in cards; thirty-eight do not, and
   * choosing four of them meant scrolling past thirty-four. The list is capped and searchable,
   * and the choice is summarised above it so it stays visible while you scroll.
   */
  t.ok('the list says how many there are to search',
    /Search 38 collectors by name/.test(
      await page.getByPlaceholder(/Search \d+ collectors/).getAttribute('placeholder') ?? ''))
  t.ok('...and how many are chosen', /\d+ of \d+ chosen/.test(modal))

  const nameBox = page.getByPlaceholder(/Search \d+ collectors by name/)
  await nameBox.fill('khumalo')
  await page.waitForTimeout(250)
  /*
   * READ THE LIST, NOT THE PAGE. This read the whole body and passed for the wrong reason: the
   * name it asserted was gone was gone from the LIST, and at the time the plan below happened not
   * to mention it either. The moment the planner started spreading work across everybody chosen,
   * the plan preview named all of them and the check failed — on working code. A check that
   * depends on what a neighbouring panel happens to contain is not checking the search box.
   */
  const list = page.locator('[data-qa="collector-list"]')
  const filtered = await list.innerText()
  t.ok('searching narrows the list', filtered.includes('Sipho Khumalo'))
  t.ok('...and hides the rest', !filtered.includes('Annelize Venter'))
  await nameBox.fill('zzzznobody')
  await page.waitForTimeout(250)
  t.ok('a search matching nobody says so',
    /Nobody matching/.test(await page.locator('body').innerText()))
  await nameBox.fill('')
  await page.waitForTimeout(250)

  /*
   * THE GATE THAT MATTERS. Every eighth fixture account is R180 000 — Major — and only the
   * Senior may take those. If the plan gave one to the Junior the screen would look identical.
   */
  t.ok('the plan is on screen', /across \d+ (person|people)/.test(modal))
  /*
   * THE GRID SHOWS THE DAY'S REAL TOTAL, not the daily limit. It used to read "+1 /50", and the
   * firm's objection was exact: /50 is the same number in every cell of every column and tells
   * you nothing. What a leader needs before pressing the button is what each person will actually
   * be holding that day — one or two over is nobody's problem, a screen full of red means the
   * window wants widening.
   */
  t.ok('the day grid shows what lands when', /\+\d+/.test(modal))
  t.ok('...and no longer repeats the daily limit in every cell', !/\+\d+ \/\d+/.test(modal))
  /*
   * The fixture's overfull diary is 60 against a 50-a-day capacity, and the plan adds nothing to
   * that day — so a cell reading a bare 60 is the day's REAL total being drawn, which is the
   * change. A grid that only ever showed what it was adding could not produce that number.
   *
   * READ FROM THE GRID, not the page. Written against the whole modal first, it passed with the
   * existing-load rendering deleted — because "60" is also the Off their mandate rate tile behind
   * the modal. A number that common has to be looked for where it means something.
   */
  const grid = await page.locator('[data-qa="plan-rows"]').innerText()
  t.ok('...and shows what is already sitting in a diary', /\b60\b/.test(grid))
  t.ok('...with the colours explained', /what that person will have in their diary that day/.test(modal))
  /*
   * And the count under the table has to agree with the cells above it, because they are computed
   * by two different pieces of code over the same plan. With thirty-eight collectors and forty
   * accounts nobody is near their fifty, so the honest reading is "nobody" — and a warning that
   * fires when nothing is wrong is worse than none.
   */
  t.ok('...and how much red there is', /daily limit/.test(modal))
  /*
   * Scoped to the grid. A page-wide count of the red class also picks up the over-ceiling figure
   * in the collector list and the warning inside this very sentence — it was written that way
   * first and disagreed with itself.
   */
  const reds = await page.locator('[data-qa="plan-rows"] .text-rose-700').count()
  const saysNone = /Nobody goes past their daily limit/.test(modal)
  /*
   * The fixture puts one collector on 60 against a 50-a-day capacity, so this side is exercised
   * rather than passing by both halves being zero. Compared as a number, not as a sign: the
   * sentence and the cells are computed by two different pieces of code over the same plan, and
   * "both non-zero" would let them disagree about how many.
   */
  const claimed = Number(/(\d+) days? goe?s? past/.exec(modal)?.[1] ?? 0)
  t.ok('somebody is over, so the red path is actually drawn', reds > 0)
  t.ok('...and the sentence does not claim otherwise', !saysNone)
  t.check('...and counts exactly the red cells', claimed, reds)
  /*
   * THE BUG THE FIRM REPORTED FROM A SCREENSHOT, held at the level they saw it: thirty-eight
   * collectors ticked, and the line underneath read "100 accounts across one person" over "five
   * working days" that turned out to be two. Both halves were the planner dealing to whoever had
   * the most raw headroom and filling each day to capacity before moving on.
   *
   * check-hand-out.mjs owns the arithmetic. What is held here is the SENTENCE, because that is
   * what the person handing out the work actually reads, and it is what was wrong on the screen.
   */
  t.ok('the work does not all land on one desk', !/across 1 person/.test(modal))
  /*
   * THE SENTENCE AND THE GRID MUST AGREE. They are computed from the same plan by two different
   * pieces of code — planSummary counts distinct users, the grid renders a row per collector
   * taking — so "40 accounts across 9 people" over a grid of three rows is a disagreement only a
   * rendered page can show. That is what this layer is for.
   *
   * NOT asserted here: that the work spreads at all. It cannot be. Forty accounts across
   * thirty-eight collectors goes one each whatever the dealing rule is, so an "across more than
   * one person" assertion passes on the broken rule too — it was written, it passed on code
   * deliberately reverted to the bug, and it came out again. check-hand-out.mjs holds the
   * distribution against the firm's own figures and fails when the rule is reverted.
   */
  const acrossN = Number(/across (\d+) (?:person|people)/.exec(modal)?.[1] ?? 0)
  t.ok('the summary names how many people are taking work', acrossN > 0)
  t.check('...and the grid shows exactly that many',
    await page.locator('[data-qa="plan-rows"] tr').count(), acrossN)
  t.ok('...and says how many days it spans', /over \d+ working days?/.test(modal))
  /*
   * And the box says what it now means. It used to read as a deadline, which is how "over five
   * working days" produced two — a person who reads the label and gets something else stops
   * trusting the screen.
   */
  t.ok('the window box says the rate it implies', /About [\d\s\u00a0,]+ a day across \d+ working days?/.test(modal))

  /*
   * THE EVEN SPLIT, OFF BY DEFAULT. The ordinary rule gives each desk a share of the room it has,
   * which protects a nearly-full book — right for a handover and wrong for a shuffle, where the
   * firm wants it flat. So it is a box, and it starts unticked: a default that quietly ignored
   * ceilings would be the planner making a policy decision on its own.
   */
  const evenBox = page.getByRole('checkbox', { name: /Distribute the accounts equally/ })
  t.ok('an even split is offered', await evenBox.isVisible())
  t.ok('...and starts unticked', !(await evenBox.isChecked()))
  /*
   * Ticked, the spread has to actually change on screen. The bench carries uneven books, so the
   * share-of-room rule and a flat split cannot produce the same grid — if they did, this check
   * would be passing on a box that does nothing.
   */
  const beforeRows = await page.locator('[data-qa="plan-rows"] tr').count()
  const before = await page.locator('[data-qa="plan-rows"]').innerText()
  await evenBox.check()
  await page.waitForTimeout(500)
  const after = await page.locator('[data-qa="plan-rows"]').innerText()
  t.ok('ticking it changes the plan', after !== before)
  /*
   * Forty accounts across thirty-eight people does not divide, so the honest test of "equal" is
   * that nobody is more than one ahead of anybody else — which is what an exact split looks like
   * when the number does not go round.
   */
  const each = (await page.locator('[data-qa="plan-rows"] tr td:last-child').allInnerTexts())
    .map((x) => Number(x.trim()))
  t.ok('...to one nobody can be jealous of', each.length > 0
    && Math.max(...each) - Math.min(...each) <= 1)
  t.ok('...across everybody chosen', each.length >= beforeRows)
  await evenBox.uncheck()
  await page.waitForTimeout(500)
  /*
   * A DROPDOWN, NOT A NUMBER BOX. "That thing doesn't work for me" — a spinner is a desktop
   * control, and on an iPad it is a small box needing a keyboard to change a number you were
   * only ever going to pick from a handful.
   */
  const windowBox = page.locator('select').filter({ hasText: 'working days' }).first()
  t.ok('the window is picked from a list', await windowBox.isVisible())
  t.ok('...offering one day', (await windowBox.innerText()).includes('1 working day'))
  t.check('...with the firm\'s default on it', await windowBox.inputValue(), '5')
  await windowBox.selectOption('2')
  await page.waitForTimeout(400)
  t.ok('choosing fewer days repaces the work',
    /across 2 working days/.test(await page.locator('body').innerText()))
  await windowBox.selectOption('5')
  await page.waitForTimeout(400)

  /*
   * AND THE TWO FIELDS DO NOT COLLIDE — but read what this does and does not cover before
   * trusting it. The real bug is iOS-only: a grid item's min-width defaults to auto, so it will
   * not shrink below its content's intrinsic width, and on iOS an input[type=date] has a large
   * one. This Chromium's date input is narrow, so removing the min-w-0 that fixes it does NOT
   * fail here — that was tried. The guard for the actual bug is the source check in
   * check-bulk-allocate.mjs; this one catches gross layout breakage and is worth the two lines,
   * not the thing the firm reported.
   */
  const dateBox = page.locator('input[type="date"]').first()
  const a = await dateBox.boundingBox()
  const b = await windowBox.boundingBox()
  t.ok('the date field and the window field do not overlap',
    !!a && !!b && (a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1 || a.y + a.height <= b.y + 1))
  /*
   * NOT asserting the over-ceiling warning here any more, because with thirty-eight collectors
   * and forty accounts there is ample headroom and nobody IS pushed over — the warning staying
   * quiet is the correct result. Asserting it would only pass by making the fixture lie.
   *
   * What is visible, and worth holding, is that somebody already over their ceiling is shown as
   * such and is given nothing. The planner's own checks own the warning arithmetic:
   * check-hand-out.mjs proves overBy counts only what a plan adds.
   */
  t.ok('an already-overloaded collector is shown as such', /470\/150/.test(modal))
  t.ok('...and the plan does not claim to have pushed anybody over',
    !/goes? over their book ceiling/.test(modal))
  /*
   * ALLOCATION IMPLIES REFERRAL, and the screen has to make that unavailable rather than merely
   * discouraged. Both modes are offered, "allocate and refer" is the default, and there is no
   * third option that would put an account on a desk with nobody booked to ring it.
   */
  t.ok('both modes are offered',
    modal.includes('Allocate and refer') && modal.includes('Refer only'))
  t.ok('...and allocating is the default',
    await page.getByRole('button', { name: 'Allocate and refer', exact: true }).last().isVisible())
  t.ok('...with no allocate-without-booking', !/Allocate only/.test(modal))

  /*
   * HOW YOU ARE CHOOSING, THEN WHO — and this is the layer that can prove the second row actually
   * appears, because the rank and team chips only exist once a mode is picked. A source check can
   * see the JSX; only a browser can see that clicking Rank puts Senior on the screen.
   */
  t.ok('everyone can be picked at once', await page.getByRole('button', { name: 'Everyone' }).isVisible())
  t.ok('...or by rank', await page.getByRole('button', { name: 'Rank', exact: true }).isVisible())
  t.ok('...or by team', await page.getByRole('button', { name: 'Team', exact: true }).isVisible())
  t.ok('...or cleared', await page.getByRole('button', { name: 'None', exact: true }).isVisible())
  /*
   * NEITHER ROW IS ON SCREEN until a mode is chosen. Asserted absent first, and for a rank AND a
   * team: a check that only looks afterwards passes on the flat row this replaced, and a check
   * that looks for a rank alone passes while every team chip is on display, because Everyone is
   * not Rank. Both, or it is not testing the gate.
   */
  const rankChips = page.getByRole('button', { name: /^(Junior|Skilled|Senior|Elite|Not graded) \d+$/ })
  const teamChips = page.getByRole('button', { name: /^(Pre-legal|No team) \d+$/ })
  t.check('no rank is offered before a mode is picked', await rankChips.count(), 0)
  t.check('...and no team either', await teamChips.count(), 0)
  await page.getByRole('button', { name: 'Rank', exact: true }).click()
  await page.waitForTimeout(250)
  const seniorChip = page.getByRole('button', { name: /^Senior \d+$/ })
  t.ok('...and is offered after', await seniorChip.isVisible())
  t.ok('...with how many people are behind it',
    /\d+/.test(await seniorChip.innerText()))
  /*
   * Picking a mode clears the selection, so the count below is exactly what the chips added --
   * which is what makes "two of the five teams" checkable at all.
   */
  t.ok('choosing how to pick starts from nobody',
    /Nobody chosen/.test(await page.locator('body').innerText()))
  await seniorChip.click()
  await page.waitForTimeout(250)
  const afterOne = Number(/(\d+) of \d+ chosen/.exec(await page.locator('body').innerText())?.[1] ?? 0)
  t.ok('a rank chip selects its people', afterOne > 0)
  const eliteChip = page.getByRole('button', { name: /^Elite \d+$/ })
  await eliteChip.click()
  await page.waitForTimeout(250)
  const afterTwo = Number(/(\d+) of \d+ chosen/.exec(await page.locator('body').innerText())?.[1] ?? 0)
  /*
   * THE BUG THE SPLIT ROW EXISTS TO FIX. Every chip used to REPLACE the selection, so picking a
   * second one silently threw the first away and the screen said nothing about it. Two chips must
   * add up.
   */
  t.ok('a second chip adds to the first rather than replacing it', afterTwo > afterOne)
  await eliteChip.click()
  await page.waitForTimeout(250)
  const afterOff = Number(/(\d+) of \d+ chosen/.exec(await page.locator('body').innerText())?.[1] ?? 0)
  t.check('...and clicking it again takes just that group back out', afterOff, afterOne)
  await page.getByRole('button', { name: 'Everyone' }).click()
  await page.waitForTimeout(250)

  /* Picking nobody is reachable now, so it must read as a state rather than an empty panel. */
  await page.getByRole('button', { name: 'None', exact: true }).click()
  await page.waitForTimeout(300)
  t.ok('picking nobody says so',
    /Nobody chosen, so there is nothing to plan/.test(await page.locator('body').innerText()))
  await page.getByRole('button', { name: 'Everyone' }).click()
  await page.waitForTimeout(300)

  /* ---------- nothing broke on the way ---------- */

  const real = errors.filter((e) => !/favicon|404 \(Not Found\)/i.test(e))
  t.check('no console errors', real.length, 0)
  if (real.length) console.log('  console:', real.slice(0, 5))
} catch (e) {
  /*
   * A failed wait must REPORT, not explode. A TimeoutError stack tells you a locator did not
   * appear; the request log and a screenshot tell you why, and the why is usually a fixture that
   * answered a URL the app never sent.
   */
  t.ok(`the run finished without throwing (${String(e).split('\n')[0].slice(0, 120)})`, false)
  try {
    const pages = browser ? browser.contexts().flatMap((c) => c.pages()) : []
    if (pages[0]) await t.shot(pages[0], '99-where-it-stopped')
  } catch { /* nothing more to learn */ }
  console.log('\n--- what the app asked Supabase for ---')
  console.log(seen.slice(-14).join('\n') || '(nothing)')
} finally {
  if (browser) await browser.close()
  stopServer(server)
}

const good = t.finish(`The account list renders its seven views with the right counts, narrows when
one is clicked, says so in the scope line and the URL, and hands the selection to the allocate
modal with a number on it. Screenshots in ${OUT}.`)
process.exit(good ? 0 : 1)

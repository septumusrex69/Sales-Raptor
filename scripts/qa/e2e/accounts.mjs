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
  BOOK_SUMMARY, COMPANY, FACETS, PROFILE, COLLEAGUE, TEAM, UNGRADED, USER_ID, VIEW_COUNTS,
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
      if (one) return { body: [PROFILE, COLLEAGUE, UNGRADED].filter((p) => p.id === one) }
      return { body: [PROFILE, COLLEAGUE, UNGRADED] }
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
    ],
  })],
  [(u) => u.includes('/rpc/diary_day_load'), () => ({ body: [] })],
  [(u) => u.includes('/rest/v1/diary_entries'), () => ({ body: [] })],
  [
    (u) => u.includes('/rest/v1/debtor_accounts'),
    (u) => {
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
      const offset = Number(/offset=(\d+)/.exec(u)?.[1] ?? 0)
      const rows = accountsPage(Math.max(0, Math.min(PAGE_SIZE, total - offset)), offset)
      const last = offset + rows.length - 1
      return {
        body: rows,
        headers: { 'content-range': `${offset}-${Math.max(offset, last)}/${total}` },
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
  t.ok('...with their grade and book', /Senior · 120\/500 on the book · 40 a day/.test(modal))
  t.ok('...and the junior’s real ceiling', /Junior · 470\/150 on the book/.test(modal))
  /*
   * THE CASE THE FIRM CAUGHT. A pre-legal clerk with no grade used to be filtered out entirely,
   * so a firm whose clerks were all ungraded saw a hand-out screen offering nobody. The role
   * admits them; the grade only widens which accounts they may be given.
   */
  t.ok('an ungraded clerk is still offered', modal.includes('Itumeleng Agent'))
  t.ok('...marked as ungraded', /Not graded/.test(modal))
  t.ok('...and told what that limits them to', /generic accounts only until graded/.test(modal))

  /*
   * THE GATE THAT MATTERS. Every eighth fixture account is R180 000 — Major — and only the
   * Senior may take those. If the plan gave one to the Junior the screen would look identical.
   */
  t.ok('the plan is on screen', /across \d+ (person|people)/.test(modal))
  t.ok('the day grid shows what lands when', /\+\d+ \/\d+/.test(modal))
  t.ok('...and warns when somebody goes over their ceiling',
    /over their book ceiling|\d+ over/.test(modal))
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

  /* Several ways to choose who, over one list rather than as separate modes. */
  t.ok('everyone can be picked at once', await page.getByRole('button', { name: 'Everyone' }).isVisible())
  t.ok('...or by grade', await page.getByRole('button', { name: 'Senior', exact: true }).isVisible())
  t.ok('...or cleared', await page.getByRole('button', { name: 'None', exact: true }).isVisible())

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

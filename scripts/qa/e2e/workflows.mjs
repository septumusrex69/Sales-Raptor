/**
 * The workflow, read back in a real browser.
 *
 * WHY THIS PAGE NEEDS THIS LAYER MORE THAN MOST. The definition is checked to the day beside this
 * folder, and none of that can tell you the table never rendered — which this project has shipped
 * once already, in a bundle that provably contained the panel. It matters more here because the
 * WHOLE PURPOSE of the screen is that somebody who knows the work reads the dates and says whether
 * they are right. A screen that renders the workflow wrongly, or not at all, does not fail loudly:
 * it just means nobody ever checks the workflow, and the first person to notice is a debtor's
 * attorney.
 *
 * Run: node scripts/qa/e2e/workflows.mjs
 */
import {
  OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer,
} from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('workflows')

const server = await startServer()
const browser = await chromium.launch()
try {
  const { page } = await signedInPage(browser, PROFILE, [], [])

  let up = false
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/accounts/workflows`, { timeout: 2000 }); up = true; break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  t.ok('the dev server answers', up)

  await page.getByRole('heading', { name: 'Pre-legal collections' }).waitFor({ timeout: 20000 })

  /*
   * THE DATE IS FIXED BEFORE ANYTHING IS ASSERTED. The page opens on today, so every date on it
   * moves daily and a check written against today's output is a check that fails tomorrow. 18
   * September 2026 is the day the firm handed the chart over, which is what makes the numbers
   * readable against the chart they drew.
   */
  await page.locator('input[type="date"]').fill('2026-09-18')
  await page.getByRole('cell', { name: 'Demand and section 129' }).waitFor({ timeout: 10000 })
  await t.shot(page, '10-workflow')

  /* ---------- the sequence is on the page, with the chart's day numbers ---------- */

  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('table tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.innerText.trim())))
  t.ok(`every step rendered (${rows.length})`, rows.length >= 15)

  const byLabel = Object.fromEntries(rows.map((r) => [r[2], r]))
  t.check('the section 129 is day 1', byLabel['Demand and section 129'][0], '1')
  t.check('...and dated from the handover on screen',
    byLabel['Demand and section 129'][1].split('\n')[0], '2026-09-19')
  t.check('the final notice is day 35', byLabel['Final notice'][0], '35')
  t.check('the recommendation is day 160', byLabel['Recommendation'][0], '160')
  /* The one the chart got wrong, showing as what it actually is. */
  t.check('the listing is confirmed on day 38, not the chart’s 42',
    byLabel['Listing confirmed'][0], '38')

  /*
   * A STEP MOVED OFF A WEEKEND SAYS SO. Day 155 is a Saturday from this handover, and a date that
   * silently disagrees with its own day number reads as a bug to whoever is checking the workflow
   * — which is the only person this screen is for.
   */
  t.ok('the closure report shows that it moved off its own day',
    /moved off 2027-02-20/.test(byLabel['Closure report'][1]))
  t.check('...while keeping its day number', byLabel['Closure report'][0], '155')

  /*
   * Statutory notices are marked, and the unwritten ones separately. Matched case-insensitively
   * because the badges are set in capitals by CSS and innerText reports what is RENDERED — the
   * same trap the hero headline hit. Reading textContent instead would match the source casing
   * and pass whether the badge rendered at all.
   */
  const s129 = byLabel['Demand and section 129'][3]
  t.ok('the section 129 is marked statutory', /statutory/i.test(s129))
  t.ok('...and marked as having no wording yet', /not written/i.test(s129))
  t.ok('a notice the firm writes itself is not marked statutory',
    !/statutory/i.test(byLabel['Follow-up and offer'][3]))

  /* ---------- the finding the firm has to decide on ---------- */

  /*
   * COMPUTED FOR THE DATE ON SCREEN, not stated once. Whether the fourth clerk is ever reached
   * depends on the month of the handover, so it is a property of the date rather than of the
   * workflow — and a banner that said it always would be wrong on the dates where it is false.
   */
  t.ok('the screen says clerk 4 never receives the file',
    await page.getByText(/Clerk 4 never receives this file/).isVisible())
  t.ok('...and the rotation list marks the rotation that comes too late',
    await page.getByText('after the file has closed').isVisible())

  /* ---------- the exits, and what is still to be written ---------- */

  for (const branch of ['Payment arrangement', 'Default on the arrangement', 'Dispute',
    'Sequestration — natural person', 'Liquidation and business rescue — juristic person']) {
    t.ok(`the ${branch} exit is on the page`, await page.getByText(branch, { exact: true }).isVisible())
  }
  t.ok('a missed instalment goes to the default branch with no renegotiation',
    await page.getByText(/no renegotiation first/).isVisible())

  const outstanding = await page.evaluate(() => {
    const heading = [...document.querySelectorAll('h3')].find((h) => h.innerText.trim() === 'Still to be written')
    return [...heading.closest('.card').querySelectorAll('li')].map((li) => li.innerText.replace(/\s+/g, ' ').trim())
  })
  t.check(`nine notices are still to be written (${outstanding.length})`, outstanding.length, 9)
  t.check('...four of them statutory',
    outstanding.filter((l) => /^statutory\b/i.test(l)).length, 4)
  /* And the rest are marked as the firm's own, so no line is left unlabelled. */
  t.check('...and the rest are marked as the firm\u2019s own',
    outstanding.filter((l) => /^(statutory|firm)/i.test(l)).length, 9)

  /* ---------- and the way in is findable ---------- */

  await page.goto(`http://localhost:${PORT}/accounts`)
  await page.getByRole('link', { name: 'Workflows' }).waitFor({ timeout: 20000 })
  t.ok('the accounts book links to it', true)
  await page.getByRole('link', { name: 'Workflows' }).click()
  await page.getByRole('heading', { name: 'Pre-legal collections' }).waitFor({ timeout: 10000 })
  t.ok('...and the link lands on the workflow', true)
  /* The bar above it names the screen rather than calling it an account. */
  t.ok('the top bar calls it Workflows',
    await page.getByRole('heading', { name: 'Workflows', exact: true }).first().isVisible())

} finally {
  await browser.close()
  stopServer(server)
}

/*
 * OUTSIDE THE try/finally, AND IT EXITS. run-all.mjs reads a non-zero exit code, not the output —
 * so a check that only prints its failures is a check the suite reports as "ok". This file did
 * exactly that until break-testing it: five deliberate breaks, every one of them printed, every
 * one of them reported green. A check that passes on broken code is worse than no check.
 */
const good = t.finish(`
A workflow nobody can read is a workflow nobody checks, and the only reason this screen exists is
to be checked. The chart's day numbers, the one it got wrong shown as what it is, the step that
moved off a Saturday saying so, and the finding that the fourth clerk is never reached computed for
the handover date on screen rather than stated once. Screenshots in ${OUT}.`)
process.exit(good ? 0 : 1)

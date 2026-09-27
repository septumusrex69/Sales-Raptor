/**
 * ISSUING THE SECTION 129 — THE BUTTON, IN A REAL BROWSER.
 *
 * THE FIRM, ASKED HOW IT SHOULD WORK: "the moment the section 129 is sent out via email, that is
 * when the workflow is triggered." Before this there was no way to start that sequence at all:
 * the eleven steps were written, dated in business days, and unreachable, because the only thing
 * in the system that ever created a run was the allocation trigger in the database.
 *
 * WHY THIS LAYER AND NOT ONLY A SOURCE CHECK. The account screen had NO browser test of any kind,
 * and the panel this button sits in returns null on an account with no runs — which is exactly
 * the account a section 129 is started on. A button that is written, is in the bundle, and never
 * renders is the failure this layer exists for; it has happened here once already.
 *
 * Run: node scripts/qa/e2e/workflow-start.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { COMPANY, PROFILE, accountsPage } from './fixtures.mjs'

const t = makeRunner('workflow-start')

const ACCOUNT = accountsPage(1)[0]
const VERSION_ID = 'ver-129'
/* One published workflow that waits for a person, as the firm's own library has it. */
const VERSION = {
  id: VERSION_ID,
  trigger_note: 'Started by the collector once the file is ready: address confirmed, no dispute, no arrangement.',
  workflows: { name: 'Section 129 / letter of demand' },
  /*
   * BUSINESS DAYS AND A DAY-1 FIRST STEP, which is the firm's own chart and the reason this file
   * has to pin the clock. The button says when the first notice goes, and on a business-day
   * sequence that is today only if today is a working day -- the firm pressed it on a Sunday, read
   * "the first step goes out now", and nothing went. Left off the fixture the version reads as
   * calendar day 0 and the weekend case can never arise here, which is a check that passes because
   * it is testing nothing.
   */
  day_unit: 'business',
  workflow_nodes: [
    /* Day 1 is the demand and it waits for a person, which is the firm's own chart -- and it is
       what makes "it starts on Monday" and "it sends on Monday" two different sentences. */
    { day: 1, needs_release: true },
    { day: 7, needs_release: false },
    { day: 12, needs_release: false },
  ],
}

/* A Wednesday and the Sunday the firm pressed it. Fixed with page.clock so the wording under the
   button is decided by the fixture rather than by the day the suite happens to run. */
const WEDNESDAY = '2026-09-30T09:00:00Z'
const SUNDAY = '2026-09-27T19:00:00Z'

/** The panel after the sequence has started: day 1 sent, day 7 waiting. */
const RUN_AFTER = [{
  id: 'run-1',
  /* The version it follows, which is also what says the account has BEEN through it -- the panel
     reads the same rows to decide whether to offer the button again. */
  version_id: VERSION_ID,
  state: 'running',
  left_reason: null,
  started_on: '2026-09-25',
  workflow_versions: { day_unit: 'business', workflows: { name: 'Section 129 / letter of demand' } },
  workflow_run_steps: [
    {
      id: 'step-129', due_on: '2026-09-25', state: 'sent', note: null, sent_at: '2026-09-25T08:10:00Z',
      workflow_nodes: { label: 'Section 129 / letter of demand', channel: 'email', day: 1, needs_release: true },
    },
    {
      id: 'step-reminder', due_on: '2026-10-06', state: 'pending', note: null, sent_at: null,
      workflow_nodes: { label: 'Reminder', channel: 'email', day: 7, needs_release: false },
    },
  ],
}]

/**
 * The account screen, with the workflow tables answered however the case needs.
 *
 * `runs` is what workflow_runs returns; `started` is what /api/workflow/start answers with. The
 * endpoint is stubbed rather than reached: this is the browser half, and what the server does
 * with a live promise is decided in api/_lib/workflow/start.ts and checked beside it.
 */
async function openAccount(browser, { runs = [], versions = [VERSION], start = null, now = WEDNESDAY, tab = true }) {
  const handlers = [
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [PROFILE] })],
    [(u) => /\/rest\/v1\/companies/.test(u), () => ({ body: [COMPANY] })],
    [(u) => /\/rest\/v1\/debtor_accounts/.test(u), () => ({ body: [ACCOUNT] })],
    [(u) => /\/rest\/v1\/workflow_versions/.test(u), () => ({ body: versions })],
    [(u) => /\/rest\/v1\/workflow_runs/.test(u), () => ({ body: runs })],
  ]
  /* THE DAY, FIXED BEFORE ANY APP CODE RUNS -- the wording under the button depends on it, and
     the session's own expiry is dated from the same clock or the page is the login screen. */
  const { context, page } = await signedInPage(browser, PROFILE, handlers, [], { now })
  if (start) {
    await page.route('**/api/workflow/start', async (route) => {
      await route.fulfill({
        status: start.status ?? 200,
        contentType: 'application/json',
        body: JSON.stringify(start.body),
      })
    })
  }
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/accounts/${ACCOUNT.id}`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  /*
     * THE WORKFLOW IS A TAB OF ITS OWN NOW. The firm: "we should make like a separate little tab
     * there for the workflow. Then we have a whole pane there where we can see with the past
     * workflows. And current ones." It was a card in the account's two-hundred-pixel rail, which
     * is what every compromise in the track was paying for.
     */
  if (tab) {
    await page.getByRole('button', { name: /^Workflow/ }).first().click({ timeout: 20000 })
  } else {
    /* The Overview, where the action row is. Waited for the tab strip all the same, because that
       is the first thing drawn once the account is loaded -- and the offers the row reads arrive
       on a query of their own after it. */
    await page.getByRole('button', { name: /^Workflow/ }).first().waitFor({ timeout: 20000 })
  }
  await page.waitForTimeout(600)
  return { context, page }
}

const server = await startServer()
let browser
try {
  browser = await chromium.launch()

  /* ---------- it is offered, and asks before it sends ---------- */
  {
    /* Answers "started, and the first step went" -- and the runs table then has the run on it,
       which is what the panel reloads into. */
    let reloaded = false
    const { context, page } = await openAccount(browser, {
      runs: [],
      start: { body: { ok: true, workflow: 'Section 129 / letter of demand', startedOn: '2026-09-25', sent: 2, held: 0, notes: [] } },
    })
    /* After the start, workflow_runs answers with the run. Re-routed here so the first load is
       genuinely empty -- an account with no run is the case the panel used to draw nothing for. */
    await page.route('**/rest/v1/workflow_runs*', async (route) => {
      reloaded = true
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-expose-headers': 'content-range' },
        body: JSON.stringify(RUN_AFTER),
      })
    })

    const start = page.getByRole('button', { name: /Start: Section 129/ })
    t.ok('the button is offered on an account with no run', await start.isVisible())

    await start.click()
    const body = await page.locator('body').innerText()
    /* ASKED TWICE, because a statutory demand that has gone has gone. */
    t.ok('...and it asks before it sends', /Start Section 129 \/ letter of demand\?/.test(body))
    t.ok('...saying the first step goes out now', /The first step goes out now/.test(body))
    t.ok('...and that later steps still wait for you', /still wait for you/.test(body))
    /* The firm's own sentence about when to start it, where they wrote it. */
    t.ok('...with the firm’s own note on it', /once the file is ready/.test(body))
    t.ok('...and a way out', await page.getByRole('button', { name: 'Not yet' }).isVisible())

    await page.getByRole('button', { name: /Yes, send it now/ }).click()
    await page.waitForTimeout(1500)
    const after = await page.locator('body').innerText()
    t.ok('the panel reloads from the database rather than guessing', reloaded)
    t.ok('...and the sequence is on the account', /Reminder/.test(after))
    t.ok('...with the demand shown as sent', /Section 129 \/ letter of demand/.test(after))
    /* And the button is gone: the account has been through it, so offering it again would be
       offering a second clock on one debt. */
    t.check('...and it is not offered a second time',
      await page.getByRole('button', { name: /Start: Section 129/ }).count(), 0)
    await context.close()
  }

  /* ---------- a refusal is shown in the server's own words ---------- */
  {
    const { context, page } = await openAccount(browser, {
      runs: [],
      start: {
        status: 409,
        body: { error: 'There is a live promise to pay on this account. A demand would go to somebody the firm has an arrangement with.' },
      },
    })
    await page.getByRole('button', { name: /Start: Section 129/ }).click()
    await page.getByRole('button', { name: /Yes, send it now/ }).click()
    await page.waitForTimeout(1200)
    const body = await page.locator('body').innerText()
    /*
     * VERBATIM. "There is a live promise to pay on this account" says what to go and look at; a
     * generic "could not start" sends somebody to ask somebody else.
     */
    t.ok('the reason the server gave is shown', /live promise to pay on this account/.test(body))
    t.ok('...and nothing claims it started', !/The first step goes out now[\s\S]*sent/.test(body))
    await context.close()
  }

  /* ---------- what is NOT offered ---------- */
  {
    /* Already been through it: the run exists, so the offer must not. Filtered in the browser as
       well as refused by the server -- a button that appears to work and is then refused is worse
       than one that is not there. */
    const { context, page } = await openAccount(browser, { runs: RUN_AFTER })
    t.check('a workflow the account has been through is not offered',
      await page.getByRole('button', { name: /Start: Section 129/ }).count(), 0)
    t.ok('...while what it has been through is still shown', /Reminder/.test(await page.locator('body').innerText()))
    await context.close()
  }
  {
    /* Nothing published that waits for a person: no offer, and on an account with no runs the
       panel draws nothing at all rather than an empty card. */
    const { context, page } = await openAccount(browser, { runs: RUN_AFTER, versions: [] })
    t.check('no offer where nothing is published for a person to start',
      await page.getByRole('button', { name: /Start:/ }).count(), 0)
    await context.close()
  }

  /* ---------- pressed on a Sunday, which now sends ---------- */
  {
    /*
     * THE FIRM'S CORRECTION, IN A BROWSER. They pressed a section 129 on a Sunday, were told the
     * demand would go on the Monday, and said: "if you issue the section 129, it should be done
     * immediately. Shouldn't wait one day."
     *
     * SO DAY 1 IS THE PRESS AND NOT A CHART DAY. This case previously asserted the opposite -- that
     * the question named the Monday and the button read "Yes, start it" -- and both were correct
     * for the behaviour of the day and wrong about what the firm wanted. Kept rather than deleted,
     * because the Sunday press is exactly the case that was wrong and the one worth holding here.
     */
    const { context, page } = await openAccount(browser, { runs: [], now: SUNDAY })
    await page.getByRole('button', { name: /Start: Section 129/ }).click()
    const body = await page.locator('body').innerText()
    t.ok('a Sunday press says the first step goes out now', /first step goes out now/.test(body))
    t.ok('...and does not put it off to a working day', !/Nothing goes out today/.test(body))
    t.ok('...nor name the Monday', !/Monday 28 Sep 2026/.test(body))
    /* THE BUTTON SAYS THE SAME THING ITS SENTENCE DOES -- it is the half somebody presses. */
    t.ok('...and the press says send', await page.getByRole('button', { name: /Yes, send it now/ }).isVisible())
    t.check('...not merely start', await page.getByRole('button', { name: /Yes, start it/ }).count(), 0)
    await context.close()
  }

  /* ---------- the 129 in the action row, beside the other two workflows ---------- */
  {
    /*
     * THE FIRM PUT IT THERE: "on this page where the account is, I think we should have like
     * something here that says, like start the section 129... I think 129, promise to pay and
     * escalate is kind of like, it's three workflows actually, so they should be together."
     *
     * THE ROW IS ON THE OVERVIEW, so this case does not open the tab first -- which is the whole
     * point of the button.
     */
    const { context, page } = await openAccount(browser, { runs: [], tab: false })
    const row = page.getByRole('button', { name: /^Section 129$/ })
    t.ok('the action row offers the section 129', await row.isVisible())
    /* GROUPED WITH THE OTHER TWO. Asserted as the order of the row's own text rather than as
       pixels: Promise to Pay, Escalate, then this. */
    const labels = await page.locator('button').allInnerTexts()
    const at = (re) => labels.findIndex((l) => re.test(l.trim()))
    t.ok('...after Promise to Pay', at(/^Promise to Pay$/) >= 0 && at(/^Section 129$/) > at(/^Promise to Pay$/))
    t.ok('...and after Escalate', at(/^Escalate$/) >= 0 && at(/^Section 129$/) > at(/^Escalate$/))
    /*
     * AND IT DOES NOT CONFIRM IT ITSELF. The second press and its wording are legal wording; asked
     * in two places it becomes two wordings. The row opens the tab's card.
     */
    await row.click()
    await page.waitForTimeout(500)
    const body = await page.locator('body').innerText()
    t.ok('...and pressing it opens the question on the Workflow tab',
      /Start Section 129 \/ letter of demand\?/.test(body))
    t.ok('...with the same sentence under it', /first step goes out now/.test(body))
    t.ok('...and a way out', await page.getByRole('button', { name: 'Not yet' }).isVisible())
    await context.close()
  }
  {
    /* NOTHING IN THE ROW WHERE THERE IS NOTHING TO START. A permanently dashed "Section 129" on
       every account that has been through one is noise in the row that must stay trustworthy. */
    const { context, page } = await openAccount(browser, { runs: RUN_AFTER, tab: false })
    t.check('the row has no 129 on an account that has been through it',
      await page.getByRole('button', { name: /^Section 129$/ }).count(), 0)
    await context.close()
  }
} catch (e) {
  /*
   * A CRASH IS A FAILURE, REPORTED. Thrown out of the try, the run prints a stack and no count at
   * all -- and run-all reads the count, so a file that reports nothing is a file whose assertions
   * nobody sees. Found by break-testing: removing the confirmation step made this whole file exit
   * silently rather than failing.
   */
  t.ok(`the run finished without throwing (${String(e).slice(0, 140)})`, false)
  try {
    const pages = browser ? browser.contexts().flatMap((c) => c.pages()) : []
    if (pages[0]) await t.shot(pages[0], '49-where-it-stopped')
  } catch { /* nothing more to learn */ }
} finally {
  if (browser) await browser.close()
  await stopServer(server)
}

const good = t.finish(
  'A collector can issue the section 129 from the account, is asked once before it goes, and is\n'
  + 'told in the firm\'s own words when it may not.',
)
process.exit(good ? 0 : 1)

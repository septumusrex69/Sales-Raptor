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
}

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
async function openAccount(browser, { runs = [], versions = [VERSION], start = null }) {
  const handlers = [
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [PROFILE] })],
    [(u) => /\/rest\/v1\/companies/.test(u), () => ({ body: [COMPANY] })],
    [(u) => /\/rest\/v1\/debtor_accounts/.test(u), () => ({ body: [ACCOUNT] })],
    [(u) => /\/rest\/v1\/workflow_versions/.test(u), () => ({ body: versions })],
    [(u) => /\/rest\/v1\/workflow_runs/.test(u), () => ({ body: runs })],
  ]
  const { context, page } = await signedInPage(browser, PROFILE, handlers, [])
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
  await page.getByText('Workflow', { exact: true }).first().waitFor({ timeout: 20000 })
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

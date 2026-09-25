/**
 * THE SEQUENCE AS A ROW OF DOTS, IN A REAL BROWSER.
 *
 * THE FIRM, OF THE LIST THIS REPLACED: "this doesn't work for me. The layout here, it's long...
 * it'll be little things and it'll have different like colours if it's been successful or not
 * successful. But you can also like extend it to show every single step in the process."
 *
 * WHY THIS LAYER AND NOT ONLY A SOURCE CHECK. The complaint was about LENGTH and about what can
 * be read at a glance, and neither is visible in source: a check beside this folder can say the
 * track is drawn and the drop-down is shut, and still pass on a panel that runs off the bottom of
 * the rail. So the height is measured here, on the eleven-step sequence the firm actually runs,
 * in the column it actually sits in.
 *
 * Run: node scripts/qa/e2e/workflow-track.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { COMPANY, PROFILE, accountsPage } from './fixtures.mjs'

const t = makeRunner('workflow-track')
const ACCOUNT = accountsPage(1)[0]

const step = (id, label, channel, day, due, state, note, sent, needs = false) => ({
  id, due_on: due, state, note, sent_at: sent,
  workflow_nodes: { label, channel, day, needs_release: needs },
})

/* THE FIRM'S OWN SEQUENCE, at the length that caused the complaint: eleven steps, two of them
   stopped, on an account that also carries the finished handover run. */
const RUNS = [
  {
    id: 'run-handover', version_id: 'v-h', state: 'finished', left_reason: null, started_on: '2026-09-25',
    workflow_versions: { day_unit: 'calendar', workflows: { name: 'Handover' } },
    workflow_run_steps: [
      step('h1', 'Handover email', 'email', 0, '2026-09-25', 'sent', null, '2026-09-25T08:00:00Z'),
      step('h2', 'Handover SMS', 'sms', 0, '2026-09-25', 'sent', null, '2026-09-25T08:01:00Z'),
    ],
  },
  {
    id: 'run-129', version_id: 'v-129', state: 'running', left_reason: null, started_on: '2026-09-25',
    workflow_versions: { day_unit: 'business', workflows: { name: 'Section 129 / letter of demand' } },
    workflow_run_steps: [
      step('s1', 'Section 129 / letter of demand', 'email', 1, '2026-09-25', 'held',
        'Nothing on the account fills a field this needs. It needs {{listing_reference}}.', null),
      step('s2', 'Section 129 / letter of demand SMS', 'sms', 1, '2026-09-25', 'held',
        'The message before this one did not go.', null),
      step('s3', 'Reminder', 'email', 7, '2026-10-05', 'pending', null, null),
      step('s4', 'Final notice', 'email', 12, '2026-10-12', 'pending', null, null),
      step('s5', 'Final notice SMS', 'sms', 12, '2026-10-12', 'pending', null, null),
      step('s6', 'Credit bureau listing notice', 'email', 39, '2026-11-18', 'pending', null, null, true),
      step('s7', 'Listing SMS', 'sms', 39, '2026-11-18', 'pending', null, null, true),
      step('s8', 'Intended summons', 'email', 49, '2026-12-02', 'pending', null, null, true),
      step('s9', 'Summons SMS', 'sms', 49, '2026-12-02', 'pending', null, null, true),
      step('s10', 'Review the file', null, 55, '2026-12-10', 'pending', null, null),
      step('s11', 'Hand to attorneys', null, 60, '2026-12-17', 'cancelled', null, null),
    ],
  },
]

const server = await startServer()
let browser
try {
  browser = await chromium.launch()
  const handlers = [
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [PROFILE] })],
    [(u) => /\/rest\/v1\/companies/.test(u), () => ({ body: [COMPANY] })],
    [(u) => /\/rest\/v1\/debtor_accounts/.test(u), () => ({ body: [ACCOUNT] })],
    [(u) => /\/rest\/v1\/workflow_versions/.test(u), () => ({ body: [] })],
    [(u) => /\/rest\/v1\/workflow_runs/.test(u), () => ({ body: RUNS })],
  ]
  const { context, page } = await signedInPage(browser, PROFILE, handlers, [])
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/accounts/${ACCOUNT.id}`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  await page.getByText('Workflow', { exact: true }).first().waitFor({ timeout: 20000 })
  await page.waitForTimeout(600)

  /* THE RUN, NOT THE CARD. The panel draws both of this account's runs inside one card, so a
     card-wide locator counts the handover's dots as well and measures a height that is two
     sequences. Every assertion below is about the section 129 run on its own. */
  const card = page.locator('section', { hasText: 'Section 129 / letter of demand' }).last()

  /* ---------- there is a dot for every step ---------- */

  const dots = card.getByRole('button', { name: /—/ })
  t.check('every step of the run is a dot on the track', await dots.count(), 11)
  /*
   * AND EACH ONE SAYS WHAT IT IS. A colour with no words behind it cannot be read by anybody on a
   * screen reader, and the firm works on an iPad where hovering for a tooltip is not a gesture.
   */
  t.ok('...and a dot says its step and its state in words',
    (await dots.first().getAttribute('aria-label') ?? '').includes('Section 129 / letter of demand —'))

  /* ---------- it opens on what has stopped ---------- */

  const body = await card.innerText()
  t.ok('the panel opens on the step that stopped', /Waiting on you/.test(body))
  t.ok('...with the reason on it', /\{\{listing_reference\}\}/.test(body))
  t.ok('...and the button that sends it', await card.getByRole('button', { name: /Try again|Send it now/ }).count() > 0)
  /*
   * AND THE SECOND ONE IS COUNTED. One dot is in focus and the others are not, so a run with two
   * held steps would otherwise leave the second as a gold dot nobody counted.
   */
  t.ok('...and says how many are waiting altogether', /2 steps are waiting on you/.test(body))

  /* ---------- it is short ---------- */

  /*
   * THE WHOLE COMPLAINT, MEASURED. The list this replaced drew every one of the eleven steps as a
   * row, with the held ones lifted out above them as cards — about eight hundred pixels for one
   * run, and the account carries two. The number here is deliberately loose: it is not a design
   * spec, it is the line between "a panel" and "a page", and only a change that puts the list
   * back on the screen can cross it.
   */
  const shut = (await card.boundingBox())?.height ?? 0
  t.ok(`an eleven-step run fits in a panel (${Math.round(shut)}px)`, shut > 0 && shut < 460)

  /* ---------- and nothing is hidden ---------- */

  const more = card.getByRole('button', { name: /Every step \(11\)/ })
  const hasMore = await more.count() === 1
  t.ok('every step can still be had', hasMore)
  /* READ DEFENSIVELY. click() on a locator that matches nothing waits thirty seconds and then
     throws, taking the rest of the file with it — found by break-testing this very file, where
     opening the list by default made the button read "Hide the steps" and every assertion after
     it vanished rather than failing. CLAUDE.md names this trap. */
  if (hasMore) { await more.click(); await page.waitForTimeout(300) }
  const opened = await card.innerText()
  for (const label of ['Reminder', 'Final notice', 'Credit bureau listing notice', 'Intended summons', 'Review the file']) {
    t.ok(`...${label} is in the list`, opened.includes(label))
  }
  /* With its day number AND its unit: a number read as calendar days on a business-day chart is
     a fortnight out, and this is the screen somebody checks that on. */
  t.ok('...each with the day it falls on, in the unit the run counts in',
    /Business day 39 · 18 Nov 2026/.test(opened))
  const open = (await card.boundingBox())?.height ?? 0
  t.ok('...and opening it is what makes the panel long', open > shut + 200)

  /* ---------- a dot moves the detail ---------- */

  /*
   * THE POINT OF THE TRACK. Pressing a step that is not due yet has to answer "what is this and
   * when does it go" — which is the question the list used to answer for all eleven at once.
   */
  await dots.nth(7).click()
  await page.waitForTimeout(250)
  const picked = await card.innerText()
  t.ok('pressing a dot moves the detail to that step', /Intended summons/.test(picked))
  t.ok('...and says when it goes, in business days', /Business day 49 · due 2 Dec 2026/.test(picked))
  /* NO BUTTON ON A STEP THAT HAS NOT STOPPED. Day 49 asserts a fact that has to be true before it
     is said, and it is ten weeks out — a Send button under it was the firm's first complaint
     about this panel and must not come back through the track. */
  t.check('...and offers nothing to press on a step that is not due',
    await card.getByRole('button', { name: /Send it now|Try again/ }).count(), 0)

  await t.shot(page, '60-workflow-track')
  await context.close()
} catch (e) {
  /* A CRASH IS A FAILURE, REPORTED. Thrown out of the try, this file prints a stack and no count
     at all — and run-all reads the count, so a file that reports nothing is a file nobody sees. */
  t.ok(`the run finished without throwing (${String(e).slice(0, 140)})`, false)
} finally {
  if (browser) await browser.close()
  await stopServer(server)
}

const good = t.finish(
  'An eleven-step sequence reads as a row of dots that fits in the account rail, opens on the\n'
  + 'step that has stopped, and still gives up every step with its dates when asked.',
)
process.exit(good ? 0 : 1)

/**
 * THE DISCARD IS ON THE SCREEN, AND THIS IS THE PROOF.
 *
 * THE FIRM: "I still see the 12 accounts. There's no option to delete it or to reverse the
 * handover. Show me an actual screenshot of where that is."
 *
 * A fair demand, and the reason this file exists rather than another rule check: the discard was
 * shipped having been held only as source. check-handover-discard asserts the right strings are
 * in the right files, which is exactly the shape of thing that can be true while nothing draws --
 * the placement bug this whole folder was created for.
 *
 * Run: node scripts/qa/e2e/handover-discard.mjs
 */
import { PORT, OUT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE, COMPANY_ID } from './fixtures.mjs'

const t = makeRunner('handover-discard')

const ADMIN = { ...PROFILE, role: 'Administrator', name: 'Stephan' }
const COMPANY = {
  id: COMPANY_ID, name: 'Rinda Roo Company', code: 'RRC', account_owner_id: ADMIN.id,
  created_at: '2026-10-01T07:27:05Z', commission_rate: 0.3, mandate_signed_at: '2026-09-17T12:00:00Z',
}
/** Two batches of eight, which is what the firm actually has in front of them. */
const BATCHES = [
  { id: 'h-0001-0000-4000-8000-000000000001', company_id: COMPANY_ID, reference: 'Rinda Roo — 1 October', received_at: '2026-10-01T09:00:00Z' },
  { id: 'h-0002-0000-4000-8000-000000000002', company_id: COMPANY_ID, reference: 'Rinda Roo — 1 October (second)', received_at: '2026-10-01T11:53:00Z' },
]
const accountsFor = (handoverId, n) => Array.from({ length: n }, (_, i) => ({
  id: `${handoverId}-acc-${i}`, handover_id: handoverId, capital_outstanding: 916.4,
}))

const server = await startServer()
const browser = await chromium.launch()
try {
  const { context, page } = await signedInPage(browser, ADMIN, [
    [(u) => /\/rest\/v1\/profiles.*id=eq\./.test(u), () => ({ body: [ADMIN] })],
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
    [(u) => /\/rest\/v1\/companies/.test(u), () => ({ body: [COMPANY] })],
    [(u) => /\/rest\/v1\/handovers/.test(u), () => ({ body: BATCHES })],
    [(u) => /\/rest\/v1\/debtor_accounts/.test(u), (u) => {
      const m = /handover_id=eq\.([^&]+)/.exec(u)
      return { body: m ? accountsFor(decodeURIComponent(m[1]), 8) : [] }
    }],
    /* Eight runs for the second batch, each with its email and SMS sent -- which is the state the
       firm's own second import is in, and the line they most need to see before pressing. */
    [(u) => /\/rest\/v1\/workflow_runs/.test(u), () => ({
      body: accountsFor(BATCHES[1].id, 8).map((a) => ({ id: `run-${a.id}` })),
    })],
    [(u) => /\/rest\/v1\/workflow_run_steps/.test(u), () => ({
      body: [], headers: { 'content-range': '0-15/16' },
    })],
    /* Nothing has happened on them, so nothing refuses the discard. */
    [(u) => /\/rest\/v1\/(account_payments|promises_to_pay|account_documents|payover_run_lines)/.test(u),
      () => ({ body: [], headers: { 'content-range': '*/0' } })],
  ], [])
  await page.setViewportSize({ width: 1180, height: 1250 })
  for (let i = 0; i < 60; i += 1) {
    try {
      await page.goto(`http://localhost:${PORT}/settings?tab=Data+Import&client=${COMPANY_ID}`, { timeout: 2000 })
      break
    } catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  await page.waitForTimeout(3500)

  const body = await page.locator('body').innerText()
  t.ok('the Data Import screen loaded', /Data Import/i.test(body))
  t.ok('the handovers already in are listed', /Handovers already in/.test(body))
  t.ok('...with the account count', /8 accounts/.test(body))
  /* THE LINE THE FIRM MOST NEEDS BEFORE PRESSING: debtors have already been written to, and that
     is shown rather than being a refusal. */
  t.ok('...and that notices have gone to debtors', /already sent to debtors/.test(body))
  t.ok('the Discard button is drawn', await page.getByRole('button', { name: 'Discard' }).first().isVisible())
  await t.shot(page, 'discard-01-where-it-is')

  /* AND WHAT PRESSING IT ASKS FOR. */
  await page.getByRole('button', { name: 'Discard' }).first().click()
  await page.waitForTimeout(400)
  const asked = await page.locator('body').innerText()
  t.ok('it asks before doing anything', /Undo this handover\?/.test(asked))
  t.ok('...saying how many accounts go', /8 accounts worth/.test(asked))
  t.ok('...and that the word has to be typed', !!await page.getByPlaceholder('DISCARD').isVisible())
  /* AND IT IS DEAD UNTIL THE WORD IS TYPED, which is the half a screenshot cannot show. */
  const confirm = page.getByRole('button', { name: /Undo the handover/ })
  t.ok('the confirm is disabled until then', await confirm.isDisabled())
  await page.getByPlaceholder('DISCARD').fill('DISCARD')
  await page.waitForTimeout(250)
  t.ok('...and live once it is', !(await confirm.isDisabled()))
  await t.shot(page, 'discard-02-what-it-asks')
  await context.close()
} finally {
  await browser.close()
  await stopServer(server)
}

console.log(`\nScreenshots in ${OUT}`)
const good = t.finish(
  'The Discard is on Settings → Data Import, under "Handovers already in", once a client is\n'
  + 'chosen. It says how many accounts and what they are worth, warns that notices have already\n'
  + 'gone to debtors, and will not fire until DISCARD is typed.',
)
process.exit(good ? 0 : 1)

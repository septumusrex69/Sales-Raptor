/**
 * THE TICKET AS A PLACE YOU WORK, IN A REAL BROWSER.
 *
 * THE FIRM, looking at a request that had reached the liaison: "there needs to be options... it
 * should already be able to draft an email for the client. There should also be an option to call
 * the client just from the ticket. Make notes on the ticket."
 *
 * WHY THIS LAYER. check-ticket-work holds the words of the draft to the letter and holds the wiring
 * as source. What it cannot see is whether a liaison ever REACHES any of it: the panel is drawn
 * only on a ticket about an account, the compose box is shared with the forward and opens on a
 * flag, and the draft is composed from three fields the page fetches separately. A panel that is
 * provably in the bundle and never drawn is the failure this layer exists for, and it has happened
 * in this codebase before.
 *
 * SIGNED IN AS THE LIAISON, because the firm was: the buttons are gated on `canSendToClient`, and a
 * collector would see them refused for a reason that has nothing to do with this.
 *
 * Run: node scripts/qa/e2e/ticket-work.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { COMPANY, LIAISON, PROFILE, accountsPage } from './fixtures.mjs'

const t = makeRunner('ticket-work')

const ACC = { ...accountsPage(1)[0], status: 'Active: Activated' }
const QID = '77777777-7777-4777-8777-777777777777'
/* THE FIRM'S OWN TICKET, in the shape the database holds it: a request raised by the collector and
   given to the liaison, which is the row that was sitting on staging when they asked for this. */
const Q = {
  id: QID, account_id: ACC.id, handover_id: null, kind: 'request',
  request_for: 'Proof of communication',
  description: 'Debtor stated that they were not communicated with before handover and they feel '
    + 'like they are not responsible for fees.',
  category: null, status: 'open', stage: 'liaison',
  owner_id: LIAISON.id, raised_by: PROFILE.id, raised_by_name: 'Vusi Maringa',
  raised_at: '2026-10-02T06:39:59Z', chase_on: null,
  alleged_on: null, received_on: null, in_writing: false, sent_to_client_at: null,
  outcome: null, outcome_action: null, outcome_amount: null, outcome_done: false,
  closed_at: null, closed_by_name: null,
}
/* TWO ENTRIES ALREADY ON IT — one Raptor wrote when the ticket was raised, one a person wrote after
   ringing the client. Both are ordinary ACCOUNT notes carrying this ticket's id, which is the whole
   of the firm's "it should live in the client section and on the ticket". */
const NOTES = [
  {
    id: 'n1', account_id: ACC.id, query_id: QID, kind: 'query', source: 'system', pinned: false,
    body: 'Request raised: Proof of communication.',
    author_name: 'Vusi Maringa', created_by: PROFILE.id, created_at: '2026-10-02T06:40:00Z',
  },
  {
    id: 'n2', account_id: ACC.id, query_id: QID, kind: 'call', source: 'manual', pinned: false,
    body: 'Called Rinda at the client. They are pulling the file and will come back on Friday.',
    author_name: 'Nicole Loder', created_by: LIAISON.id, created_at: '2026-10-02T07:10:00Z',
  },
]

const server = await startServer()
let browser
try {
  browser = await chromium.launch()
  const { context, page } = await signedInPage(browser, LIAISON, [
    /* The signed-in row is fetched by id and the rest as a list. Answering both with two rows makes
       AuthContext's `maybeSingle` an error and leaves `currentUser` null — which silently disables
       every button on this page. Learned the hard way in escalate-box.mjs. */
    [(u) => u.includes('/rest/v1/profiles') && /id=eq\./.test(u), () => ({ body: [LIAISON] })],
    [(u) => u.includes('/rest/v1/profiles'), () => ({ body: [PROFILE, LIAISON] })],
    [(u) => u.includes('/rest/v1/companies'), () => ({ body: [COMPANY] })],
    [(u) => u.includes('/rest/v1/debtor_accounts'), () => ({ body: [ACC] })],
    [(u) => u.includes('/rest/v1/account_notes'), () => ({ body: NOTES })],
    [(u) => u.includes('/rest/v1/account_emails'), () => ({ body: [] })],
    [(u) => u.includes('/rest/v1/account_queries') && /id=eq\./.test(u), () => ({ body: Q })],
    [(u) => u.includes('/rest/v1/account_queries'), () => ({ body: [Q] })],
  ], [])
  await page.setViewportSize({ width: 1440, height: 900 })
  /* A CONNECTED MAILBOX, because mail goes out through the sender's own and the button says why it
     is disabled rather than failing on Send. Without this the whole email half is untestable. */
  await page.route('**/api/email/status', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ connected: true, email: 'nicole@bredellferreira.co.za' }),
  }))

  let up = false
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/queries/${QID}`, { timeout: 2000 }); up = true; break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  t.ok('the dev server answers', up)
  await page.waitForTimeout(2000)

  const body = await page.locator('body').innerText()
  /* THE SESSION RESOLVED, or every gate below is answered by a null user and the file tests
     nothing. Asserted rather than assumed — escalate-box.mjs was green for two broken builds
     because of exactly this. */
  t.ok('the page knows who is signed in', !/Loading…/.test(body))

  /* ---------- the three things a person does with a ticket ---------- */

  t.ok('the ticket offers to email the client', /Email the client/.test(body))
  t.ok('...to log a call', /Log a call/.test(body))
  t.ok('...and to add a note', /Add a note/.test(body))

  /* ---------- and the thread it already has ---------- */

  /*
   * READ BACK OFF THE ACCOUNT'S OWN NOTES. These are not a ticket table — they are the account's
   * history, filtered to this ticket — so a thread that draws proves the firm's "three places" is
   * one record rather than three copies.
   */
  t.ok('what has already happened is on the ticket', /Request raised: Proof of communication/.test(body))
  t.ok('...including a call somebody logged', /They are pulling the file/.test(body))
  t.ok('...and who wrote each one', /Vusi Maringa/.test(body) && /Nicole Loder/.test(body))
  /* OLDEST FIRST. A ticket is a short exchange read in order. */
  t.ok('...oldest first', body.indexOf('Request raised') < body.indexOf('They are pulling'))

  /* ---------- where it stands ---------- */

  t.ok('the rail says who has it', /Where it stands/.test(body) && /Nicole Loder/.test(body))
  /*
   * MATCHED IN CAPITALS, which is what `innerText` actually returns here: the labels carry a CSS
   * `uppercase`, and Chromium applies text-transform before giving the text back. Written in
   * sentence case first and it failed on a perfectly good rail — a check reporting a bug in the
   * stylesheet it happens to run under.
   */
  t.ok('...and what is being asked for', /ASKING FOR[\s\S]{0,40}Proof of communication/.test(body))
  /* THE FIGURES ARE DRAWN ONCE. In the rail on an account ticket, in the card on a batch — both and
     they would be the same four facts twice on one screen. Counted on the LABEL, which is
     uppercased, so the thread's own "Request raised:" cannot be mistaken for a second one. */
  t.check('...once, not twice', (body.match(/RAISED/g) ?? []).length, 1)

  await t.shot(page, 'ticket-work')

  /* ---------- the email is already written ---------- */

  /*
   * THE FIRM: "it should already be able to draft an email for the client." A liaison opening a
   * blank box has to go back up the page and retype what is written an inch above it, and what
   * they retype is shorter and vaguer every time.
   */
  await page.getByRole('button', { name: /Email the client/ }).click()
  await page.waitForTimeout(800)
  const dialog = page.locator('[data-modal-open]')
  t.ok('the compose box opens', await dialog.count() > 0)

  const inputs = await dialog.locator('input').evaluateAll((els) => els.map((e) => e.value))
  t.ok('the subject is already written',
    inputs.some((v) => /Proof of communication .* Mhlongo/.test(v)))

  const drafted = await dialog.locator('textarea').first().inputValue().catch(() => '')
  t.ok('...and so is the body', drafted.length > 100)
  t.ok('...asking for the thing the ticket asks for', /proof of communication/i.test(drafted))
  /* THE CLERK'S OWN WORDS, QUOTED. They wrote them with the debtor on the telephone. */
  t.ok('...quoting what was recorded on the account', /not communicated with before handover/.test(drafted))
  /*
   * AND NOT ONE BRACE. Every template in the library is a notice to a DEBTOR; this is a colleague
   * at a credit provider. A merge field reaching a client's inbox would mean the two vocabularies
   * had been crossed, and the next thing crossed would go to a debtor.
   */
  t.ok('...with no merge field left in it', !/\{\{|\}\}/.test(drafted))
  await t.shot(page, 'ticket-work-email')

  await context.close()
} catch (e) {
  /* A CRASH IS A FAILURE, REPORTED. Thrown out of the try the run prints a stack and no count at
     all — and run-all reads the count, so a file that reports nothing is a file nobody sees. */
  t.ok(`the run finished without throwing (${String(e).slice(0, 160)})`, false)
} finally {
  if (browser) await browser.close()
  await stopServer(server)
}

t.finish('A liaison can answer a ticket from the ticket, and what they do lands on the account too.')

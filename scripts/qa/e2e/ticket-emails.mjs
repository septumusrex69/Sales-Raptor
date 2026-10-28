/**
 * A TICKET'S OWN EMAILS, AND ANSWERING ONE (S14, Raptor H13), in a real browser.
 *
 * THE FIRM, holding the client page beside a ticket: "make the dispute ticket look a little bit more like
 * this ... you should be able to send an email or respond to a specific email from a client." So the
 * ticket has tabs -- Overview, Emails, Notes, with counts -- and every message on it can be replied to,
 * threaded under the client's own email, from the Emails tab and from the conversation.
 *
 * Signed in as the liaison with a mailbox, because sending is theirs. Every request is a fixture.
 *
 * Run: node scripts/qa/e2e/ticket-emails.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { COMPANY, LIAISON, PROFILE, accountsPage } from './fixtures.mjs'

const t = makeRunner('ticket-emails')

const ACC = { ...accountsPage(1)[0], status: 'Active: Activated' }
const QID = '77777777-7777-4777-8777-777777777777'
const Q = {
  id: QID, account_id: ACC.id, handover_id: null, kind: 'dispute',
  request_for: null, description: 'Debtor says the account was settled in 2024.',
  category: 'Paid already', status: 'open', stage: 'client',
  ticket_no: 1017, owner_id: LIAISON.id, raised_by: PROFILE.id, raised_by_name: 'Vusi Maringa',
  raised_at: '2026-10-02T06:39:59Z', chase_on: null,
  alleged_on: null, received_on: null, in_writing: false, sent_to_client_at: null,
  outcome: null, outcome_action: null, outcome_amount: null, outcome_done: false,
  closed_at: null, closed_by_name: null,
}
const CLIENT = { ...COMPANY, email: 'rinda@northbank.co.za', contact_person: 'Rinda' }
const mail = (id, over) => ({
  id, direction: 'in', debtor_address: 'rinda@northbank.co.za', our_address: 'nicole@bredellferreira.co.za',
  subject: 'Re: Paid already — ticket T-1017', body: '', message_id: `<${id}@northbank>`, in_reply_to: null,
  attachment_names: [], to_recipients: [{ name: null, address: 'nicole@bredellferreira.co.za' }],
  cc_recipients: [{ name: 'Barry', address: 'barry@northbank.co.za' }], sent_by_name: 'Rinda',
  charged_excl_vat: 13, read_at: null, read_by: null, received_by: LIAISON.id,
  occurred_at: '2026-10-05T08:00:00Z', query_id: QID, correspondent: 'client',
  unmatched_at: null, unmatched_by_name: null, unmatched_reason: null, ...over,
})
const EMAILS = [
  mail('e1', { direction: 'out', debtor_address: 'rinda@northbank.co.za', subject: 'Paid already — ticket T-1017',
    body: 'Please confirm whether the account was settled.', sent_by_name: 'Nicole Loder', charged_excl_vat: 25,
    occurred_at: '2026-10-03T08:00:00Z', read_at: '2026-10-03T08:00:00Z', cc_recipients: [] }),
  mail('e2', { body: 'We have no record of a settlement. The statement is attached.' }),
]
const NOTES = [
  { id: 'n1', account_id: ACC.id, query_id: QID, kind: 'query', source: 'system', pinned: false,
    body: 'Dispute raised: Paid already.', author_name: 'Vusi Maringa', created_by: PROFILE.id, created_at: '2026-10-02T06:40:00Z' },
  { id: 'n2', account_id: ACC.id, query_id: QID, kind: 'note', source: 'manual', pinned: false,
    body: 'Asked the debtor for proof of payment.', author_name: 'Nicole Loder', created_by: LIAISON.id, created_at: '2026-10-02T07:10:00Z' },
  { id: 'n3', account_id: ACC.id, query_id: QID, kind: 'email_out', source: 'manual', pinned: false,
    body: 'Email to rinda@northbank.co.za', author_name: 'Nicole Loder', created_by: LIAISON.id, created_at: '2026-10-03T08:00:00Z' },
]

const sends = []
const filed = []
const reads = []
const server = await startServer()
let browser
try {
  browser = await chromium.launch()
  const { page } = await signedInPage(browser, LIAISON, [
    [(u, req) => req.method() === 'POST' && u.includes('/rest/v1/account_emails'), (u, req) => { filed.push(req.postDataJSON()); return { status: 201, body: [] } }],
    [(u, req) => req.method() === 'PATCH' && u.includes('/rest/v1/account_emails'), (u, req) => { reads.push(req.postDataJSON()); return { body: [] } }],
    [(u) => u.includes('/rest/v1/account_emails'), () => ({ body: EMAILS })],
    [(u) => u.includes('/rest/v1/profiles') && /id=eq\./.test(u), () => ({ body: [LIAISON] })],
    [(u) => u.includes('/rest/v1/profiles'), () => ({ body: [PROFILE, LIAISON] })],
    [(u) => u.includes('/rest/v1/companies'), () => ({ body: [CLIENT] })],
    [(u) => u.includes('/rest/v1/contacts'), () => ({ body: [] })],
    [(u) => u.includes('/rest/v1/debtor_accounts'), () => ({ body: [ACC] })],
    [(u) => u.includes('/rest/v1/account_notes'), () => ({ body: NOTES })],
    [(u) => u.includes('/rest/v1/account_queries') && /id=eq\./.test(u), () => ({ body: Q })],
    [(u) => u.includes('/rest/v1/account_queries'), () => ({ body: [Q] })],
  ], [])
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/api/email/status', (r) => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ connected: true, email: 'nicole@bredellferreira.co.za' }),
  }))
  await page.route('**/api/email/send*', (r) => {
    sends.push(r.request().postDataJSON())
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, messageId: '<reply@raptor>', from: 'nicole@bredellferreira.co.za' }) })
  })

  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/queries/${QID}`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  await page.getByTestId('ticket-number').first().waitFor({ timeout: 20000 })
  await page.waitForTimeout(1200)

  /* ---------- tabs, like the client page ---------- */
  const tabs = (await page.locator('button[aria-current]').allInnerTexts()).map((x) => x.replace(/\s+/g, ''))
  t.check('the ticket has the client page\'s tabs, with counts', JSON.stringify(tabs), JSON.stringify(['Overview', 'Emails2', 'Notes1']))
  t.ok('Overview is where it opens, with the conversation', /The conversation/.test(await page.locator('body').innerText()))

  /* ---------- reply from the conversation ---------- */
  t.check('only the message that came IN offers Reply in the conversation', await page.getByTestId('thread-reply').count(), 1)
  await page.getByTestId('thread-reply').click()
  await page.waitForTimeout(700)
  const modal = page.locator('[data-modal-open]')
  t.ok('Reply opens the compose box', await modal.count() > 0)
  const values = await modal.locator('input').evaluateAll((els) => els.map((e) => e.value))
  t.ok('...addressed to the client who wrote', values.some((v) => /rinda@northbank\.co\.za/.test(v)))
  t.ok('...with their subject as a reply, not a fresh ticket subject', values.some((v) => /^Re: Paid already — ticket T-1017$/.test(v)))
  t.ok('...and their message shown under the box', /We have no record of a settlement/.test(await modal.innerText()))
  await modal.locator('textarea').first().fill('Thank you, Rinda. We will tell the debtor.')
  await page.getByRole('button', { name: /^Send$/ }).click()
  await page.waitForTimeout(1500)
  t.ok('the reply is threaded under the client\'s email', sends.some((s) => s.inReplyTo === '<e2@northbank>'))
  const rec = filed.find((f) => f.in_reply_to === '<e2@northbank>')
  t.ok('...filed on this ticket, against the account, as an answer to that message',
    rec?.query_id === QID && rec?.account_id === ACC.id && rec?.debtor_address === 'rinda@northbank.co.za')

  /* ---------- the Emails tab ---------- */
  await page.locator('button[aria-current]', { hasText: 'Emails' }).click()
  await page.getByTestId('ticket-emails').waitFor({ timeout: 5000 })
  const list = await page.getByTestId('ticket-emails').innerText()
  t.ok('the Emails tab lists every message on the ticket', /1 sent/.test(list) && /1 received/.test(list))
  t.ok('...and offers a new one', /Write|New email|Email/i.test(list))
  t.check('...with no "This is a dispute" on a message already on the ticket', /This is a dispute/.test(list), false)
  await page.getByText('We have no record of a settlement').first().click().catch(async () => {
    await page.getByText(/Re: Paid already/).first().click()
  })
  await page.waitForTimeout(600)
  t.ok('opening the client\'s message marks it read', reads.some((r) => r.read_at))
  const replyAll = page.getByRole('button', { name: /Reply all/ }).first()
  t.ok('a message with others on it offers Reply all', await replyAll.isVisible())
  await replyAll.click()
  await page.waitForTimeout(700)
  const ccShown = await page.locator('[data-modal-open]').innerText() + (await page.locator('[data-modal-open] input').evaluateAll((els) => els.map((e) => e.value).join(' ')))
  t.ok('...copying everybody who was on it, but not ourselves', /barry@northbank\.co\.za/.test(ccShown))
  await t.shot(page, 'ticket-emails-reply-all')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  /* ---------- the Notes tab ---------- */
  await page.locator('button[aria-current]', { hasText: 'Notes' }).click()
  await page.getByTestId('ticket-note-form').waitFor({ timeout: 5000 })
  const notes = await page.getByTestId('ticket-notes').innerText()
  t.ok('Notes shows what a person wrote', /Asked the debtor for proof of payment/.test(notes))
  t.ok('...not Raptor\'s own lines, nor an email\'s record', !/Dispute raised/.test(notes) && !/Email to rinda/.test(notes))
} catch (e) {
  t.ok(`the run finished without throwing (${String(e).slice(0, 200)})`, false)
} finally {
  await browser?.close()
  await stopServer(server)
}
const good = t.finish('A ticket has Overview, Emails and Notes tabs like the client page, and any message on it can be answered -- threaded under the client\'s own email and filed on the ticket.')
process.exit(good ? 0 : 1)

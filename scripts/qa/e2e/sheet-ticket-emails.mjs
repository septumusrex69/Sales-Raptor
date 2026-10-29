/**
 * A HANDOVER-SHEET TICKET SENDS EMAIL, NOT CHARGED (S15, Raptor · Handover 14), in a real browser.
 *
 * Stephan, asked whether a sheet ticket should send and receive email: yes, not charged. So a ticket
 * about a whole sheet has the Emails tab (no Notes -- a note lives on an account's timeline), Write
 * opens the same compose box with a subject naming the sheet and the ticket number, the box says it is
 * not charged, and what is filed has no account, the ticket, and R0.
 *
 * Signed in as the liaison with a mailbox. Every request is a fixture.
 *
 * Run: node scripts/qa/e2e/sheet-ticket-emails.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { COMPANY, LIAISON, PROFILE } from './fixtures.mjs'

const t = makeRunner('sheet-ticket-emails')

const QID = '88888888-8888-4888-8888-888888888888'
const HID = '99999999-9999-4999-8999-999999999999'
const Q = {
  id: QID, account_id: null, handover_id: HID, kind: 'request',
  request_for: 'Client references', description: 'Rows 4 to 19 of the sheet have no client reference.',
  category: null, status: 'open', stage: 'liaison',
  ticket_no: 1042, owner_id: LIAISON.id, raised_by: PROFILE.id, raised_by_name: 'Vusi Maringa',
  raised_at: '2026-10-20T06:39:59Z', chase_on: null,
  alleged_on: null, received_on: null, in_writing: false, sent_to_client_at: null,
  outcome: null, outcome_action: null, outcome_amount: null, outcome_done: false,
  closed_at: null, closed_by_name: null,
}
const BATCH = { id: HID, reference: 'Bonnitta Oct', received_at: '2026-10-19T08:00:00Z', company_id: COMPANY.id }
const CLIENT = { ...COMPANY, email: 'rinda@bonnitta.co.za', contact_person: 'Rinda' }

const sends = []
const filed = []
const server = await startServer()
let browser
try {
  browser = await chromium.launch()
  const { page } = await signedInPage(browser, LIAISON, [
    [(u, req) => req.method() === 'POST' && u.includes('/rest/v1/account_emails'), (u, req) => { filed.push(req.postDataJSON()); return { status: 201, body: [] } }],
    [(u) => u.includes('/rest/v1/account_emails'), () => ({ body: [] })],
    [(u) => u.includes('/rest/v1/profiles') && /id=eq\./.test(u), () => ({ body: [LIAISON] })],
    [(u) => u.includes('/rest/v1/profiles'), () => ({ body: [PROFILE, LIAISON] })],
    [(u) => u.includes('/rest/v1/companies'), () => ({ body: [CLIENT] })],
    [(u) => u.includes('/rest/v1/contacts'), () => ({ body: [] })],
    [(u) => u.includes('/rest/v1/handovers'), () => ({ body: BATCH })],
    [(u) => u.includes('/rest/v1/account_queries') && /id=eq\./.test(u), () => ({ body: Q })],
    [(u) => u.includes('/rest/v1/account_queries'), () => ({ body: [Q] })],
  ], [])
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/api/email/status', (r) => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ connected: true, email: 'nicole@bredellferreira.co.za' }),
  }))
  await page.route('**/api/email/send*', (r) => {
    sends.push(r.request().postDataJSON())
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, messageId: '<sheet@raptor>', from: 'nicole@bredellferreira.co.za' }) })
  })

  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/queries/${QID}`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  await page.getByText('Rows 4 to 19 of the sheet have no client reference.').first().waitFor({ timeout: 20000 })
  await page.waitForTimeout(1200)

  const tabs = (await page.locator('button[aria-current]').allInnerTexts()).map((x) => x.replace(/\s+/g, ''))
  t.check('a sheet ticket has Overview and Emails, and no Notes', JSON.stringify(tabs), JSON.stringify(['Overview', 'Emails0']))

  await page.locator('button[aria-current]', { hasText: 'Emails' }).click()
  await page.getByTestId('ticket-emails').waitFor({ timeout: 5000 })
  const write = page.getByTestId('ticket-emails').getByRole('button', { name: /Write|New email|Email/ }).first()
  t.ok('the Emails tab offers a new message', await write.isVisible())
  await write.click()
  await page.waitForTimeout(700)
  const modal = page.locator('[data-modal-open]')
  t.ok('it opens the compose box', await modal.count() > 0)
  const values = await modal.locator('input').evaluateAll((els) => els.map((e) => e.value))
  t.ok('...to the client', values.some((v) => /rinda@bonnitta\.co\.za/.test(v)))
  t.ok('...about the sheet, with the ticket number', values.some((v) => v === 'Your handover sheet — Bonnitta Oct — ticket T-1042'))
  const text = await modal.innerText()
  t.ok('...saying it is not charged', /Not charged: it is about the client/.test(text))
  await t.shot(page, 'sheet-ticket-compose')
  await page.getByRole('button', { name: /^Send$/ }).click()
  await page.waitForTimeout(1500)
  t.ok('the message goes', sends.length === 1)
  const rec = filed[0]
  t.ok('it is filed on the ticket with no account', rec?.query_id === QID && rec?.account_id === null)
  t.check('...and nothing is charged', rec?.charged_excl_vat, 0)
} catch (e) {
  t.ok(`the run finished without throwing (${e instanceof Error ? e.message.split('\n')[0] : e})`, false)
} finally {
  await browser?.close()
  await stopServer(server)
}
const good = t.finish('A handover-sheet ticket has an Emails tab, writes to the client about the sheet with its ticket number, says it is not charged, and files what it sent on the ticket with no account and R0.')
process.exit(good ? 0 : 1)

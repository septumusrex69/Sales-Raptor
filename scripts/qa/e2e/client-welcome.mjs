/**
 * A NEW CLIENT'S LIAISON, AND HER WELCOME -- WHICH IS HER PRESS (S8, 18 Oct; 23 Oct).
 *
 * What went wrong on 23 Oct: Camille converted Dr Alianna Labuschagne and assigned Nicole; the
 * welcome email went in Nicole's name at 11:55:58 without her; Nicole was later told to send it and
 * believed it had not gone. The firm: "The client liaison gets a notification and it becomes a task
 * that they have to send a welcome letter and that they have to do an introductory call."
 *
 * In a real browser, three people:
 *   1. SALES converts a lead and chooses the liaison: the client's code is proposed and saved, the
 *      assign route is asked, and NO welcome request goes;
 *   2. SALES assigns a client signed online from its Welcome card: the same, no welcome request;
 *   3. THE LIAISON presses Send welcome email on her client: one request, the card then says "sent on
 *      <date> by <her>", and Send it again goes only after a confirm.
 *
 * Run: RAPTOR_E2E_PORT=5701 node scripts/qa/e2e/client-welcome.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE, COMPANY, COMPANY_ID, LEAD, LEAD_ID, TEAM } from './fixtures.mjs'

const t = makeRunner('client-welcome')
const DEAN = { ...PROFILE, id: 'u-dean', name: 'Dean Fourie', email: 'd@x.co.za', role: 'Sales Manager' }
const BONITA = { ...PROFILE, id: 'u-bonita', name: 'Bonita Mahlangu', email: 'b@x.co.za', role: 'Liaison Manager' }
const RUAN = { ...PROFILE, id: 'u-ruan', name: 'Ruan Venter', email: 'r@x.co.za', role: 'Liaison' }
const PEOPLE = [DEAN, BONITA, RUAN]
const SIGNED_ONLINE = { id: COMPANY_ID, name: 'Abc Cricket', account_owner_id: DEAN.id, created_at: '2026-10-11T07:00:00Z',
  commission_rate: 0.25, mandate_signed_at: '2026-10-11T08:00:00Z', liaison_needed: true, code: 'ABC' }

/** Every request to the two routes this is about -- the welcome and the assignment -- with its body.
    The mailbox's background sync is answered and not counted. */
function mailSpy(page, answer) {
  const asked = []
  return page.route('**/api/email/**', async (route) => {
    const action = new URL(route.request().url()).pathname.replace(/^.*\/api\/email\//, '')
    const body = route.request().postDataJSON()
    if (action === 'welcome' || action === 'assign-liaison') asked.push({ action, body })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer(action, body)) })
  }).then(() => asked)
}

const people = (me) => [
  [(u) => /\/rest\/v1\/profiles.*id=eq\./.test(u), () => ({ body: [me] })],
  [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: PEOPLE })],
]
const open = async (page, path) => {
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}${path}`, { timeout: 2000 }); return }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
}

const server = await startServer()
const browser = await chromium.launch()
try {
  /* ---------- 1. Sales converts a lead and chooses the liaison ---------- */
  {
    const writes = []
    const { page } = await signedInPage(browser, DEAN, [
      [(u, req) => req.method() !== 'GET' && u.includes('/rest/v1/') && !u.includes('/rpc/'), (u, req) => {
        writes.push({ table: u.replace(/^.*\/rest\/v1\//, '').replace(/\?.*$/, ''), method: req.method(), body: req.postDataJSON() })
        return req.method() === 'PATCH' ? { status: 200, body: { id: 'x' } } : { status: 201, body: [] }
      }],
      ...people(DEAN),
      /* Northbank Properties has no code; another client already holds NOP, so it is offered NOP2. */
      [(u) => u.includes('/rest/v1/companies'), () => ({ body: [{ ...COMPANY, code: null },
        { id: 'c-other', name: 'Northern Ports', code: 'NOP', owner_id: DEAN.id, created_at: '2026-01-01T00:00:00Z' }] })],
      [(u) => u.includes('/rest/v1/teams'), () => ({ body: [TEAM] })],
      [(u) => u.includes('/rpc/nav_counts'), () => ({ body: { mail: 0, tasks: 0, disputes: 0, diary: 0 } })],
      [(u) => u.includes('/rest/v1/leads'), () => ({ body: [{ ...LEAD, owner_id: DEAN.id, status: 'Interested', party: 'company', services: ['Debt Collection'] }] })],
      [(u) => u.includes('/rest/v1/signing_requests'), () => ({ body: [
        { created_at: '2026-10-10T09:00:00Z', state: 'sent', mandate: { party: 'company', clientName: 'Vaal Fire Services', commission: { kind: 'rate', rate: 0.275 } } }] })],
    ], [], { now: '2026-10-18T10:00:00+02:00' })
    const asked = await mailSpy(page, () => ({ assigned: true }))
    await open(page, `/leads/${LEAD_ID}`)
    await page.getByRole('button', { name: 'Convert to Client' }).first().waitFor({ timeout: 20000 })
    await page.getByRole('button', { name: 'Convert to Client' }).first().click()
    const box = page.locator('[data-modal-open]')
    await box.getByTestId('convert-code').waitFor({ timeout: 10000 })
    t.check('Convert to Client proposes the client\'s code from its name, past the one taken', await box.getByTestId('convert-code').inputValue(), 'NOP2')
    await box.getByTestId('convert-code').fill('NOP')
    t.ok('...refuses a code another client has', /NOP already belongs to another client/.test(await box.innerText())
      && await box.getByRole('button', { name: 'Convert to Client' }).isDisabled())
    await box.getByTestId('convert-code').fill('NBP')
    await box.getByTestId('convert-liaison').selectOption(RUAN.id)
    t.ok('...the liaison hint promises tasks, not an email', /two tasks go on her list/.test(await box.innerText()))
    await page.waitForTimeout(400)
    await box.getByRole('button', { name: 'Convert to Client' }).click()
    await page.waitForTimeout(2000)
    const terms = writes.find((w) => w.table.startsWith('companies') && w.method === 'PATCH' && w.body && 'account_owner_id' in w.body)
    t.check('the code chosen is saved on the client with its terms', terms?.body?.code, 'NBP')
    t.check('the assign route is asked, once, for this client and her', JSON.stringify(asked.filter((a) => a.action === 'assign-liaison').map((a) => a.body)),
      JSON.stringify([{ companyId: COMPANY_ID, liaisonId: RUAN.id }]))
    t.check('...and NO welcome email is asked for', asked.filter((a) => a.action === 'welcome').length, 0)
    await page.context().close()
  }

  /* ---------- 2. Sales assigns a client signed online, from its Welcome card ---------- */
  {
    const { page } = await signedInPage(browser, DEAN, [...people(DEAN),
      [(u) => /\/rest\/v1\/companies/.test(u), () => ({ body: [SIGNED_ONLINE] })]], [], { now: '2026-10-18T10:00:00+02:00' })
    const asked = await mailSpy(page, () => ({ assigned: true, tasks: true }))
    await page.setViewportSize({ width: 1180, height: 900 })
    await open(page, `/companies/${COMPANY_ID}`)
    const card = page.getByTestId('welcome-card')
    await card.waitFor({ timeout: 20000 })
    t.ok('a client signed online shows the Assign a liaison box', /Assign a liaison/.test(await card.innerText()))
    const offered = await card.locator('select option').allTextContents()
    t.check('...offering liaisons only, the manager marked', JSON.stringify(offered), JSON.stringify(['Choose a liaison…', 'Bonita Mahlangu (manager)', 'Ruan Venter']))
    t.ok('...and nothing is pressed until one is chosen', await page.getByTestId('welcome-assign').isDisabled())
    t.check('...the button assigns; it does not promise a welcome', (await page.getByTestId('welcome-assign').innerText()).trim(), 'Assign')
    await card.locator('select').selectOption('u-bonita')
    await page.getByTestId('welcome-assign').click()
    await card.getByRole('status').waitFor({ timeout: 10000 })
    t.check('it asks the assign route for this client and this liaison', JSON.stringify(asked.map((a) => [a.action, a.body])),
      JSON.stringify([['assign-liaison', { companyId: COMPANY_ID, liaisonId: 'u-bonita' }]]))
    t.ok('...says what happened: hers, told, two tasks', /Bonita Mahlangu now looks after Abc Cricket\. She has been told, and two tasks are on her list: send the welcome email, and the welcome call\./.test(await card.innerText()))
    const ticks = await page.getByTestId('welcome-steps').locator('li').evaluateAll((lis) => lis.map((li) => li.querySelector('span')?.className.includes('bg-emerald') ?? false))
    t.check('...the steps: signed, assigned, NOT emailed, not called', JSON.stringify(ticks), '[true,true,false,false]')
    t.ok('...the email step says it waits for her', /waiting for the liaison to send it/.test(await page.getByTestId('welcome-steps').innerText()))
    t.check('...and Sales is not offered the Send', await page.getByTestId('welcome-send').count(), 0)
    await t.shot(page, 'client-welcome-1-assigned')
    await page.context().close()
  }

  /* ---------- 3. The liaison sends it: once, then "sent ... by ...", again only on a confirm ---------- */
  {
    const HERS = { ...SIGNED_ONLINE, account_owner_id: RUAN.id, liaison_needed: false, liaison_assigned_at: '2026-10-17T08:00:00Z' }
    const { page } = await signedInPage(browser, RUAN, [...people(RUAN),
      [(u) => /\/rest\/v1\/companies/.test(u), () => ({ body: [HERS] })]], [], { now: '2026-10-18T10:00:00+02:00' })
    const asked = await mailSpy(page, () => ({ sent: true, fromLiaison: true, sentAt: '2026-10-18T08:00:00Z', sentBy: RUAN.id }))
    await page.setViewportSize({ width: 1180, height: 900 })
    await open(page, `/companies/${COMPANY_ID}`)
    const card = page.getByTestId('welcome-card')
    await card.waitFor({ timeout: 20000 })
    t.ok('her client, not yet welcomed: she is offered Send welcome email', await page.getByTestId('welcome-send').isVisible())
    t.check('...and nothing has been asked of the server yet', asked.length, 0)
    await page.getByTestId('welcome-send').click()
    await page.getByTestId('welcome-sent').waitFor({ timeout: 10000 })
    /* The body also carries the handover sheet (e2e/handover-sheet holds its bytes); here only who
       and how often, and that the sheet rides along by default. */
    const strip = ({ attachments, ...rest }) => { void attachments; return rest }
    t.check('one press asks the welcome route once, for this client', JSON.stringify(asked.map((a) => [a.action, strip(a.body)])),
      JSON.stringify([['welcome', { companyId: COMPANY_ID }]]))
    t.check('...with the handover sheet attached', asked[0]?.body?.attachments?.[0]?.filename?.endsWith('handover sheet.xlsx'), true)
    t.check('the card then says when and by whom', (await page.getByTestId('welcome-sent').locator('p').innerText()).trim(), 'Welcome email sent on 18/10/2026 by Ruan Venter.')
    t.check('...the Send button is gone', await page.getByTestId('welcome-send').count(), 0)
    const ticks = await page.getByTestId('welcome-steps').locator('li').evaluateAll((lis) => lis.map((li) => li.querySelector('span')?.className.includes('bg-emerald') ?? false))
    t.check('...and the email step ticks', JSON.stringify(ticks), '[true,true,true,false]')
    await page.getByTestId('welcome-again').click()
    t.check('Send it again asks first, and sends nothing on the first press', asked.length, 1)
    t.ok('...in words', /It has already gone once\. Send it again\?/.test(await card.innerText()))
    await t.shot(page, 'client-welcome-2-sent')
    await page.getByTestId('welcome-again-confirm').click()
    await page.waitForTimeout(800)
    t.check('...and only the confirm sends it again, saying so', JSON.stringify(asked.slice(1).map((a) => [a.action, strip(a.body)])),
      JSON.stringify([['welcome', { companyId: COMPANY_ID, again: true }]]))
    await page.context().close()
  }
} finally {
  await browser.close()
  await stopServer(server)
}
const good = t.finish('Assigning a liaison sends nothing; she sends the welcome from the client\'s card, once, and the card says when and by whom.')
process.exit(good ? 0 : 1)

/**
 * THE CLIENT PORTAL, AS A CLIENT SEES IT (S14, Raptor H13). Nobody signed in to Raptor: a fresh browser
 * opens /portal, types an email, gets the same answer whoever they are, types the code, and sees one line
 * per debtor in the firm's words. Every /api/portal call is answered from fixtures.
 *
 * Run: node scripts/qa/e2e/client-portal.mjs
 */
import { PORT, chromium, makeRunner, startServer, stopServer } from './harness.mjs'

const t = makeRunner('client-portal')
const TOKEN = 'ab'.repeat(32)
const calls = []
const LINES = [
  { ourReference: 'RAP-125321', yourReference: 'ALIANNAPH/30209', debtor: 'Alicia Smith', client: 'Alianna Pharmacy',
    capitalHandedOver: 800.4, paidThisMonth: 100, paidToDate: 200, capitalOutstanding: 600.4, position: 'paying', positionLabel: 'Paying' },
  { ourReference: 'RAP-125327', yourReference: 'ALIANNAPH/30263', debtor: 'Annelie Fourie', client: 'Alianna Pharmacy',
    capitalHandedOver: 950.5, paidThisMonth: 0, paidToDate: 0, capitalOutstanding: 950.5, position: 'in_progress', positionLabel: 'In progress' },
]

/* Phase 2a (S15): one ticket waiting on the client, one closed. */
const TICKETS = [
  { ticketNo: 41, kind: 'dispute', status: 'open', stage: 'client', description: 'The debtor says she paid in March.',
    raisedAt: '2026-10-20T08:00:00Z', closedAt: null, caseNumber: 'RAP-125321', accountNumber: null, clientReference: 'ALIANNAPH/30209',
    debtor: 'Alicia Smith', sheetReference: null, lastMessageAt: '2026-10-21T08:00:00Z', messages: 1 },
  { ticketNo: 12, kind: 'client', status: 'closed', stage: 'liaison', description: 'Any arrangement yet?',
    raisedAt: '2026-09-02T08:00:00Z', closedAt: '2026-09-05T08:00:00Z', caseNumber: 'RAP-125327', accountNumber: null, clientReference: null,
    debtor: 'Annelie Fourie', sheetReference: null, lastMessageAt: null, messages: 0 },
]
const THREAD = [{ direction: 'out', subject: 'Dispute', body: 'Please send the statement for March.', at: '2026-10-21T08:00:00Z', from: 'Liesl Liaison', attachments: [] }]

const server = await startServer()
const browser = await chromium.launch()
try {
  const context = await browser.newContext()
  const page = await context.newPage()
  /* Nothing of Supabase is answered: the portal must not need it. */
  await context.route(/supabase\.co/, (r) => r.abort())
  await context.route('**/api/portal/**', (r) => {
    const req = r.request()
    const action = new URL(req.url()).pathname.split('/').pop()
    const body = req.postDataJSON() ?? {}
    const token = req.headers()['x-portal-token'] ?? null
    calls.push({ action, body, token })
    const json = (status, b) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) })
    if (action === 'request-code') return json(200, { message: 'If that address may sign in, a code is on its way. It lasts 10 minutes.' })
    if (action === 'verify') return String(body.code).replace(/\s/g, '') === '123456' ? json(200, { token: TOKEN, expiresAt: '2026-11-27T08:00:00Z' }) : json(400, { error: 'That code is not right. Check it, or ask for a new one.' })
    if (token !== TOKEN) return json(401, { error: 'Please sign in again.' })
    if (action === 'me') return json(200, { name: 'Jan Pharma', email: 'jan@alianna.co.za', client: 'Alianna Pharmacy' })
    if (action === 'book') {
      const lines = body.search ? LINES.filter((l) => l.debtor.toLowerCase().includes(String(body.search).toLowerCase())) : LINES
      return json(200, { total: lines.length, totals: { capitalHandedOver: 1750.9, paidThisMonth: 100, paidToDate: 200, capitalOutstanding: 1550.9 }, lines })
    }
    if (action === 'sign-out') return json(200, { ok: true })
    if (action === 'tickets') return json(200, { tickets: TICKETS })
    if (action === 'ticket') return json(200, { messages: body.ticketNo === 41 ? THREAD : [] })
    if (action === 'ticket-reply') return json(200, { ok: true })
    if (action === 'ask') return json(200, { ticketNo: 77 })
    if (action === 'callback') return String(body.phone ?? '').replace(/\D/g, '').length >= 9 ? json(200, { ok: true }) : json(400, { error: 'Type the number we should call.' })
    return json(404, { error: 'unknown' })
  })
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/portal`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  await page.getByTestId('portal-sign-in').waitFor({ timeout: 20000 })
  t.check('no staff navigation on the portal', await page.locator('nav').count(), 0)

  await page.getByTestId('portal-email').fill('jan@alianna.co.za')
  await page.getByRole('button', { name: 'Email me a code' }).click()
  await page.getByTestId('portal-code-sent').waitFor({ timeout: 5000 })
  t.ok('the answer does not say whether the address is known', /If that address may sign in/.test(await page.getByTestId('portal-code-sent').innerText()))

  await page.getByTestId('portal-code').fill('111 111')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByTestId('portal-error').waitFor({ timeout: 5000 })
  t.ok('a wrong code is refused and says so', /not right/.test(await page.getByTestId('portal-error').innerText()))

  await page.getByTestId('portal-code').fill('123 456')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByTestId('portal-book').waitFor({ timeout: 5000 })
  const verify = calls.filter((c) => c.action === 'verify').pop()
  t.ok('the code is sent with the address it was asked for', verify?.body?.email === 'jan@alianna.co.za' && verify?.body?.code === '123 456')
  t.ok('the book is asked for with the session, and names no client', calls.some((c) => c.action === 'book' && c.token === TOKEN && !('companyId' in c.body) && !('client' in c.body)))
  t.ok('the client is named at the top', /Alianna Pharmacy/.test(await page.locator('header').innerText()))

  const head = (await page.locator('[data-testid="portal-book"] thead').innerText()).replace(/\s+/g, ' ')
  for (const col of ['Debtor', 'Your reference', 'Our reference', 'Capital handed over', 'Paid this month', 'Paid to date', 'Capital outstanding', 'Where it stands']) {
    t.ok(`the column "${col}" is there`, head.includes(col))
  }
  t.ok('...and no balance, fee or commission column', !/balance|fee|commission|interest/i.test(head))
  t.check('one line per debtor', await page.getByTestId('portal-line').count(), 2)
  const first = (await page.getByTestId('portal-line').first().innerText()).replace(/\s+/g, ' ')
  t.ok('a line carries both references, the rands and the position in the firm\'s words', /RAP-125321/.test(first) && /ALIANNAPH\/30209/.test(first) && /R\s?600\.40/.test(first) && /Paying/.test(first))
  t.ok('the totals are shown', /R\s?1\s?550\.90/.test((await page.getByTestId('portal-totals').innerText()).replace(/ /g, ' ')))

  await page.getByTestId('portal-search').fill('annelie')
  await page.waitForTimeout(800)
  t.check('searching narrows the book', await page.getByTestId('portal-line').count(), 1)
  t.ok('...the search goes to the server', calls.some((c) => c.action === 'book' && c.body.search === 'annelie'))
  await t.shot(page, 'client-portal-book')

  /* ---- Phase 2a (S15): ask about a debtor, ask for a call, see and answer tickets. */
  await page.getByTestId('portal-ask-open').first().click()
  await page.getByTestId('portal-ask').waitFor({ timeout: 5000 })
  t.ok('Ask names the debtor and our reference', /Annelie Fourie/.test(await page.getByTestId('portal-ask').innerText()) && /RAP-125327/.test(await page.getByTestId('portal-ask').innerText()))
  await page.getByTestId('portal-ask-text').fill('Has she made an arrangement?')
  await page.getByTestId('portal-ask-send').click()
  await page.getByTestId('portal-asked').waitFor({ timeout: 5000 })
  const asked = calls.filter((c) => c.action === 'ask').pop()
  t.ok('the question goes by OUR reference, with the session', asked?.body?.caseNumber === 'RAP-125327' && asked?.token === TOKEN && /arrangement/.test(asked?.body?.question))
  t.ok('...and the client is told the ticket number', /T-77/.test(await page.getByTestId('portal-asked').innerText()))

  await page.getByTestId('portal-call-me').click()
  await page.getByTestId('portal-ask').waitFor({ timeout: 5000 })
  t.check('a call not about an account offers no question (a question is about an account)', await page.getByTestId('portal-ask-question').count(), 0)
  t.ok('...and cannot be sent without a number', await page.getByTestId('portal-ask-send').isDisabled())
  await page.getByTestId('portal-ask-phone').fill('082 123 4567')
  await page.getByTestId('portal-ask-when').fill('After two')
  await page.getByTestId('portal-ask-send').click()
  await page.getByTestId('portal-asked').waitFor({ timeout: 5000 })
  const cb = calls.filter((c) => c.action === 'callback').pop()
  t.ok('the callback carries the number and the time, and no account', cb?.body?.phone === '082 123 4567' && cb?.body?.when === 'After two' && !cb?.body?.caseNumber)

  await page.getByTestId('portal-tab-tickets').click()
  await page.getByTestId('portal-tickets').waitFor({ timeout: 5000 })
  t.check('both tickets are listed', await page.getByTestId('portal-ticket').count(), 2)
  const firstTicket = await page.getByTestId('portal-ticket').first().innerText()
  t.ok('the one waiting on the client says so, in their words', /Waiting on you/.test(firstTicket) && /The debtor disputes the account/.test(firstTicket))
  t.ok('...and the closed one says closed', /Closed/.test(await page.getByTestId('portal-ticket').nth(1).innerText()))
  await page.getByTestId('portal-ticket').first().locator('button').first().click()
  await page.getByTestId('portal-thread').waitFor({ timeout: 5000 })
  t.ok('the thread shows what the firm wrote, and who wrote it', /statement for March/.test(await page.getByTestId('portal-thread').innerText()) && /Liesl Liaison/.test(await page.getByTestId('portal-thread').innerText()))
  await page.getByTestId('portal-reply').fill('Attached is the proof.')
  await page.getByTestId('portal-reply-send').click()
  await page.waitForTimeout(500)
  const reply = calls.filter((c) => c.action === 'ticket-reply').pop()
  t.ok('a reply goes on the right ticket', reply?.body?.ticketNo === 41 && reply?.body?.message === 'Attached is the proof.')
  await page.getByTestId('portal-ticket').nth(1).locator('button').first().click()
  await page.waitForTimeout(500)
  t.check('a closed ticket offers no reply box', await page.getByTestId('portal-ticket').nth(1).getByTestId('portal-reply').count(), 0)
  await t.shot(page, 'client-portal-tickets')

  await page.reload()
  await page.getByTestId('portal-book').waitFor({ timeout: 10000 })
  t.ok('a reload stays signed in', true)
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.getByTestId('portal-sign-in').waitFor({ timeout: 5000 })
  t.ok('signing out asks the server to end the session', calls.some((c) => c.action === 'sign-out' && c.token === TOKEN))
} catch (e) {
  t.ok(`the run finished without throwing (${String(e).slice(0, 200)})`, false)
} finally {
  await browser.close()
  await stopServer(server)
}
const good = t.finish('A client signs in to the portal with an emailed code and sees one line per debtor, with no staff login and nothing but their own book.')
process.exit(good ? 0 : 1)

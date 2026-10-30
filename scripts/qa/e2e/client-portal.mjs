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
  /* Newest, and with the firm: listed first by the server, it must still come BELOW the one waiting on the client. */
  { ticketNo: 52, kind: 'client', status: 'open', stage: 'liaison', description: 'Please confirm the balance.',
    raisedAt: '2026-10-25T08:00:00Z', closedAt: null, caseNumber: 'RAP-125327', accountNumber: null, clientReference: null,
    debtor: 'Annelie Fourie', sheetReference: null, lastMessageAt: null, messages: 0 },
  { ticketNo: 41, kind: 'dispute', status: 'open', stage: 'client', description: 'The debtor says she paid in March.',
    raisedAt: '2026-10-20T08:00:00Z', closedAt: null, caseNumber: 'RAP-125321', accountNumber: null, clientReference: 'ALIANNAPH/30209',
    debtor: 'Alicia Smith', sheetReference: null, lastMessageAt: '2026-10-21T08:00:00Z', messages: 1 },
  { ticketNo: 12, kind: 'client', status: 'closed', stage: 'liaison', description: 'Any arrangement yet?',
    raisedAt: '2026-09-02T08:00:00Z', closedAt: '2026-09-05T08:00:00Z', caseNumber: 'RAP-125327', accountNumber: null, clientReference: null,
    debtor: 'Annelie Fourie', sheetReference: null, lastMessageAt: null, messages: 0 },
]
const DASH = {
  accounts: 3, open: 2,
  figures: { capitalHandedOver: 2505475.92, collectedToDate: 501095.18, collectedThisMonth: 100, capitalOutstanding: 1550.9 },
  outcomes: [
    { outcome: 'paying', label: 'Paying', finished: false, accounts: 1, handedOver: 800.4, outstanding: 600.4, paidToDate: 200 },
    { outcome: 'in_progress', label: 'In progress', finished: false, accounts: 1, handedOver: 950.5, outstanding: 950.5, paidToDate: 0 },
    { outcome: 'paid_up', label: 'Paid up', finished: true, accounts: 1, handedOver: 749.1, outstanding: 0, paidToDate: 300 },
  ],
  tickets: { waitingOnYou: 1, open: 1 },
  /* S16: a handover on the 5th of each of the last three months, and the liaison. */
  handoverDays: [3, 2, 1].map((back, i) => {
    const d = new Date(); d.setUTCDate(5); d.setUTCMonth(d.getUTCMonth() - back)
    return { day: d.toISOString().slice(0, 10), accounts: i + 2, capital: 1000 * (i + 1) }
  }),
  collectedMonths: [2, 1, 0].map((back, i) => {
    const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - back)
    return { month: d.toISOString().slice(0, 7), collected: 100 * (i + 1) }
  }),
  liaison: { name: 'Camille Liaison', email: 'camille@example.test', phone: '021 555 0101', whatsapp: '082 555 0101' },
}
const REPORTS = [{ id: 'r1', kind: 'remittance', version: 1, sentAt: '2026-10-12T08:00:00Z', title: 'Remittance', client: 'Alianna Pharmacy',
  amount: 420.5, periodStart: '2026-09-11', periodEnd: '2026-10-10', hasPdf: true, hasSheet: true }]
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
    if (action === 'verify') return String(body.code).replace(/\s/g, '') === '123456' ? json(200, { token: TOKEN, expiresAt: '2026-11-27T08:00:00Z', needsPassword: true }) : json(400, { error: 'That code is not right. Check it, or ask for a new one.' })
    /* S16: the password, set after the first code and used every visit after. */
    if (action === 'sign-in') return body.password === 'tafelberg sunrise' ? json(200, { token: TOKEN, expiresAt: '2026-11-27T08:00:00Z' }) : json(400, { error: 'That email address and password do not match.' })
    if (action === 'set-password') return token === TOKEN ? json(200, { ok: true }) : json(401, { error: 'Please sign in again.' })
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
    if (action === 'payment-report') return String(body.reference ?? '').trim() ? json(200, { ticketNo: 78 }) : json(400, { error: 'Put your reference on it.' })
    if (action === 'dashboard') return json(200, DASH)
    if (action === 'reports') return json(200, { reports: REPORTS })
    if (action === 'report-file') return json(200, { url: 'about:blank' })
    if (action === 'callback') return String(body.phone ?? '').replace(/\D/g, '').length >= 9 ? json(200, { ok: true }) : json(400, { error: 'Type the number we should call.' })
    return json(404, { error: 'unknown' })
  })
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/portal`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  await page.getByTestId('portal-sign-in').waitFor({ timeout: 20000 })
  t.check('no staff navigation on the portal', await page.locator('nav').count(), 0)

  /* S16: drawn to Stephan's brief -- the coastline and the mark, Secure client portal, and no Microsoft button
     ("do not introduce Microsoft sign-in unless ... already configured"). */
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(300)
  await t.shot(page, 'client-portal-sign-in')
  t.ok('the sign-in carries the BF circle and the wordmark over the coastline', await page.getByTestId('portal-sign-in-logo').locator('img').count() === 2)
  // The panel is taller than it is wide: the remittance strip (1672 x 609) stretched four times over there (S16, 30 Oct).
  t.ok('the sign-in photograph is its own tall cut, not the remittance strip', /portal-signin\.webp/.test(await page.getByTestId('portal-sign-in-logo').evaluate((e) => e.parentElement.style.background)))
  t.ok('...says it is the secure client portal, and offers no Microsoft sign-in', /secure client portal/i.test(await page.getByTestId('portal-page').innerText())
    && !/microsoft/i.test(await page.getByTestId('portal-page').innerText()))
  t.ok('...and a way to reach the firm', /^mailto:info@bredellferreira\.co\.za/.test(await page.getByTestId('portal-support').getAttribute('href') ?? ''))
  await page.getByTestId('portal-password').fill('peek')
  await page.getByTestId('portal-password-show').click()
  t.ok('the eye shows the password, and again hides it', await page.getByTestId('portal-password').getAttribute('type') === 'text')
  await page.getByTestId('portal-password-show').click()
  t.ok('...', await page.getByTestId('portal-password').getAttribute('type') === 'password')
  await page.getByTestId('portal-forgot').click()
  t.ok('Forgot your password? is the emailed code', await page.getByRole('button', { name: 'Email me a code' }).count() === 1)
  await page.getByRole('button', { name: 'I have a password' }).click()
  /* S16: the door is the address and a password; a wrong one is refused without saying which half was wrong. */
  await page.getByTestId('portal-email').fill('jan@alianna.co.za')
  await page.getByTestId('portal-password').fill('guess')
  await page.getByTestId('portal-sign-in-button').click()
  await page.getByTestId('portal-error').waitFor({ timeout: 5000 })
  t.ok('a wrong password is refused, and nothing is emailed for it', /do not match/.test(await page.getByTestId('portal-error').innerText())
    && !calls.some((c) => c.action === 'request-code'))
  /* The first visit: a code, then a password. */
  await page.getByTestId('portal-use-code').click()
  await page.getByRole('button', { name: 'Email me a code' }).click()
  await page.getByTestId('portal-code-sent').waitFor({ timeout: 5000 })
  t.ok('the answer does not say whether the address is known', /If that address may sign in/.test(await page.getByTestId('portal-code-sent').innerText()))

  await page.getByTestId('portal-code').fill('111 111')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByTestId('portal-error').waitFor({ timeout: 5000 })
  t.ok('a wrong code is refused and says so', /not right/.test(await page.getByTestId('portal-error').innerText()))

  await page.getByTestId('portal-code').fill('123 456')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByTestId('portal-new-password').waitFor({ timeout: 5000 })
  t.ok('after the code, the client is asked to choose a password before going in', await page.getByTestId('portal-dashboard').count() === 0)
  await page.getByTestId('portal-new-password').fill('short')
  await page.getByTestId('portal-new-password-again').fill('short')
  await page.getByTestId('portal-save-password').click()
  t.ok('...a short one is refused in words', /at least 8/.test(await page.getByTestId('portal-error').innerText())
    && !calls.some((c) => c.action === 'set-password'))
  await page.getByTestId('portal-new-password').fill('tafelberg sunrise')
  await page.getByTestId('portal-new-password-again').fill('tafelberg sunrise')
  await page.getByTestId('portal-save-password').click()
  /* S16, Stephan: "make it linger a little bit longer ... our logo ... some sort of epic cool animation ...
     PlayStation 2 vibes." The first opening in a tab is the full one, and it lingers, then the portal. */
  await page.getByTestId('portal-splash').waitFor({ timeout: 5000 })
  t.ok('the portal opens on the full opening, the logo and the drawn ring', await page.locator('[data-splash="full"]').count() === 1
    && await page.locator('.portal-splash-ring').count() === 1)
  await page.waitForTimeout(1700)
  await t.shot(page, 'client-portal-opening-1')
  t.ok('...and lingers: at 1.7 s it still covers the portal', await page.getByTestId('portal-splash').isVisible())
  await page.waitForTimeout(1100)
  await t.shot(page, 'client-portal-opening-2')
  await page.getByTestId('portal-dashboard').waitFor({ timeout: 8000 })
  await page.getByTestId('portal-splash').waitFor({ state: 'detached', timeout: 8000 })
  t.ok('...then dissolves into the dashboard', await page.getByTestId('portal-dashboard').isVisible())
  /* S15: the DASHBOARD opens first, with the sidebar in Stephan's order. */
  await page.getByTestId('portal-dashboard').waitFor({ timeout: 5000 })
  const nav = (await page.getByTestId('portal-sidebar').innerText()).replace(/\s+/g, ' ')
  t.ok('the sidebar reads Dashboard, Reports, Tickets, Accounts, in that order', /Dashboard.*Reports.*Tickets.*Accounts/.test(nav))
  const figs = (await page.getByTestId('portal-figures').innerText()).replace(/\u00a0/g, ' ')
  t.ok('the dashboard shows handed over, collected and outstanding', /Capital handed over/i.test(figs) && /Collected to date/i.test(figs) && /R\s?2[\s,]?505[\s,]?475/.test(figs) && /20% of capital/.test(figs))
  t.check('...one line per open outcome beside the ring', await page.getByTestId('portal-positions').locator('li').count(), 2)
  t.ok('...and the finished accounts by how they ended, paid up counted', await page.getByTestId('portal-finished').locator('li').count() === 1
    && (await page.getByTestId('portal-paid-up').innerText()).trim() === '1')
  /* The sidebar folds to a rail and remembers it (S15: "the sidebar should be able to minimize"). */
  await page.getByTestId('portal-fold').click()
  await page.waitForTimeout(400)
  t.ok('the sidebar folds to icons', !(await page.getByTestId('portal-sidebar').innerText()).includes('Reports'))
  await t.shot(page, 'client-portal-folded')
  await page.getByTestId('portal-fold').click()
  await page.waitForTimeout(400)
  t.ok('...and says a ticket is waiting on the client', /1 ticket is waiting on you/.test(await page.getByTestId('portal-waiting').innerText()))
  t.ok('...with no fee, commission or interest anywhere on it', !/fee|commission|interest/i.test(await page.getByTestId('portal-dashboard').innerText()))
  /* S16: Raptor's shape in the firm's colours (Stephan: "make it look and feel like Raptor ... more like Bredell"). */
  t.ok('the band is Raptor\'s, over the remittance coastline', /portal-hero/.test(await page.getByTestId('portal-hero').evaluate((e) => e.style.background))
    && /Dashboard/.test(await page.getByTestId('portal-hero').innerText()))
  t.check('the sidebar carries the BF circle beside the wordmark', await page.getByTestId('portal-logo').locator('img').count(), 2)
  const chart = page.getByTestId('portal-handovers')
  await chart.locator('.recharts-bar-rectangle').first().waitFor({ timeout: 5000 })
  t.ok('the handovers are drawn month by month, the communications dashboard\'s card', /Your handovers, month by month/.test(await chart.innerText())
    && await chart.locator('.recharts-bar-rectangle path').count() >= 3)
  const liaison = page.getByTestId('portal-liaison')
  t.ok('the liaison is named, and the number is a link to call', /Camille Liaison/.test(await liaison.innerText())
    && await liaison.locator('a[href="tel:0215550101"]').count() === 1 && await liaison.locator('a[href^="https://wa.me/27825550101"]').count() === 1)
  t.ok('the navy is the firm\'s inside the portal, whatever skin the browser has', (await page.getByTestId('portal-page')
    .evaluate((e) => getComputedStyle(e).getPropertyValue('--color-navy-900'))).trim().toLowerCase() === '#111e2d')
  await t.shot(page, 'client-portal-dashboard')
  /* S16, Stephan's second mock-up: a top bar, the rings side by side, a trend under the figures, actions as a list. */
  t.ok('the top bar searches the book', await page.getByTestId('portal-top-search').count() === 1)
  /* Side by side where they fit (2xl); on a laptop or an iPad one above the other, each with its legend beside the ring. */
  t.ok('the open and the finished accounts are matching cards, one above the other at 1440', (await page.getByTestId('portal-finished-card').boundingBox()).y > (await page.getByTestId('portal-open').boundingBox()).y
    && Math.abs((await page.getByTestId('portal-finished-card').boundingBox()).width - (await page.getByTestId('portal-open').boundingBox()).width) < 2)
  /* Stephan's brief: "No green ... No red" -- every slice of both rings is from the firm's palette. */
  const fills = await page.locator('[data-testid$="-ring"] circle[data-slice]').evaluateAll((cs) => cs.map((c) => (c.getAttribute('stroke') || '').toUpperCase()))
  t.ok('every ring slice is a Bredell Ferreira colour', fills.length > 0 && fills.every((f) => ['#203B60', '#C69F54', '#97B4CC', '#46607B', '#32404D', '#525D66', '#B4BFCC', '#D5E1EB'].includes(f)))
  t.ok('...and each legend dot is its slice\'s colour', (await page.locator('[data-legend]').evaluateAll((ds) => ds.map((d) => getComputedStyle(d).backgroundColor))).length === fills.length)
  t.ok('the figures carry a trend drawn from the months sent', await page.getByTestId('portal-figures').locator('svg path').count() >= 4)
  /* LEAN (Stephan, 30 Oct: "way too big and bulky"): on an iPad on its side, the four in one row and short. */
  {
    const vp = page.viewportSize()
    await page.setViewportSize({ width: 1180, height: 820 }); await page.waitForTimeout(600)
    const boxes = await page.getByTestId('portal-figure').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), h: r.height, fits: e.scrollWidth <= e.clientWidth + 1 } }))
    t.ok('on an iPad the four figures sit in one row', boxes.length === 4 && new Set(boxes.map((b) => b.top)).size === 1)
    t.ok('...each lean (no taller than 120 px), and no figure cut off', boxes.every((b) => b.h <= 120 && b.fits))
    t.ok('...and no label cut short', await page.getByTestId('portal-figure-label').evaluateAll((els) => els.length === 4 && els.every((e) => e.scrollWidth <= e.clientWidth + 1)))
    await t.shot(page, 'client-portal-dashboard-ipad')
    await page.setViewportSize(vp); await page.waitForTimeout(400)
  }
  t.ok('the sidebar counts the open tickets', (await page.getByTestId('portal-tickets-count').innerText()).trim() === '2')
  /* S16: the company dashboard's ring, white cuts between the slices (Stephan: "use this type of pie chart"). */
  t.check('the open accounts are drawn on the cut ring, a slice per position', await page.getByTestId('portal-open-ring').locator('circle[data-slice]').count(), 2)
  /* And Raptor's three arrangements, the same switcher (Stephan: "the three panes, everything underneath each
     other, the two panes"). It opens on the split pane: the chart and the liaison side by side. */
  const panes = page.getByTestId('dashboard-panes')
  const box = async (id) => (await page.locator(`[data-pane="${id}"]`).boundingBox())
  t.ok('it opens on the split pane, the liaison beside the chart', await panes.getAttribute('data-layout') === 'wide'
    && (await box('liaison')).x > (await box('handovers')).x + 200)
  await page.getByRole('button', { name: 'One column' }).click()
  t.ok('one column puts everything under each other', await panes.getAttribute('data-layout') === 'stacked'
    && Math.abs((await box('liaison')).x - (await box('handovers')).x) < 2 && (await box('liaison')).y > (await box('open')).y)
  await t.shot(page, 'client-portal-dashboard-stacked')
  await page.getByRole('button', { name: 'Three columns' }).click()
  t.ok('three columns sets what to do and the liaison side by side', await panes.getAttribute('data-layout') === 'columns'
    && Math.abs((await box('liaison')).y - (await box('actions')).y) < 2 && (await box('liaison')).x > (await box('actions')).x)
  await t.shot(page, 'client-portal-dashboard-columns')
  await page.getByRole('button', { name: 'Wide' }).click()
  await page.getByTestId('portal-top-search').fill('Fourie')
  await page.getByTestId('portal-top-search').press('Enter')
  await page.getByTestId('portal-search').waitFor({ timeout: 5000 })
  t.ok('a search from the top bar opens Accounts with the words in', await page.getByTestId('portal-nav-accounts').getAttribute('aria-current') === 'page'
    && await page.getByTestId('portal-search').inputValue() === 'Fourie')
  await page.getByTestId('portal-nav-dashboard').click()
  await page.getByTestId('portal-dashboard').waitFor({ timeout: 5000 })
  /* S16, Stephan's list: the dashboard is where the client acts -- each button its own form, the account picked
     inside it. Update a debtor's details: the picker, then the topic already chosen. */
  await page.getByTestId('portal-action-details').click()
  await page.getByTestId('portal-ask-picker').waitFor({ timeout: 5000 })
  t.ok('a dashboard button opens its own form, asking which account', /Update a debtor's details/.test(await page.getByTestId('portal-ask').innerText()))
  await page.getByTestId('portal-ask-search').fill('Fourie')
  await page.getByTestId('portal-ask-pick').first().waitFor({ timeout: 5000 })
  await page.waitForTimeout(400)
  t.check('...searching the client\'s own book', await page.getByTestId('portal-ask-pick').count(), 1)
  await page.getByTestId('portal-ask-pick').first().click()
  t.ok('...then carries on about that account, the topic already chosen', /About Annelie Fourie/.test(await page.getByTestId('portal-ask').innerText())
    && await page.getByRole('button', { name: 'New details for the debtor' }).getAttribute('aria-pressed') === 'true')
  await page.getByTestId('portal-ask-text').fill('New cell number 082 555 0199.')
  await page.getByTestId('portal-ask-send').click()
  await page.getByTestId('portal-asked').waitFor({ timeout: 5000 })
  const raised = calls.filter((c) => c.action === 'ask').pop()
  t.ok('...and the question goes to that account with that topic', raised?.body?.caseNumber === 'RAP-125327' && raised?.body?.topic === 'New details for the debtor')
  await page.getByTestId('portal-action-handover').click()
  t.ok('a button on the dashboard takes the client where they act', await page.getByTestId('portal-nav-handover').getAttribute('aria-current') === 'page')
  await page.getByTestId('portal-nav-dashboard').click()
  await page.getByTestId('portal-dashboard').waitFor({ timeout: 5000 })

  await page.getByTestId('portal-nav-reports').click()
  await page.getByTestId('portal-progress-report').waitFor({ timeout: 5000 })
  t.ok('Reports opens with the monthly progress report, as PDF or Excel', /Monthly progress report/.test(await page.getByTestId('portal-progress-report').innerText())
    && await page.getByTestId('portal-progress-files').locator('[data-format-choice]').allInnerTexts().then((x) => x.join('|') === 'PDF|Excel'))
  await page.getByTestId('portal-reports').waitFor({ timeout: 5000 })
  t.check('Reports lists what was sent', await page.getByTestId('portal-report').count(), 1)
  t.ok('...by period, with the PDF and the spreadsheet', /Remittance advice, 11 Sept 2026 – 10 Oct 2026/.test(await page.getByTestId('portal-report').innerText().then((x) => x.replace(/\u00a0/g, ' ')))
    && await page.getByTestId('portal-report-files').count() === 1)
  /* CHOOSE THE FORMAT, THEN OPEN OR DOWNLOAD (Stephan, 30 Oct): one choice, and one Open and one Download, never
     the four look-alike buttons of two labelled pairs. PDF is chosen first -- it is what was emailed. */
  const files = page.getByTestId('portal-report-files')
  t.ok('a report offers PDF or Excel, PDF chosen', (await files.getAttribute('data-format')) === 'pdf'
    && await files.locator('[data-format-choice="pdf"]').getAttribute('aria-checked') === 'true')
  t.ok('...with exactly one Open and one Download', await files.locator('[data-action="open"]').count() === 1 && await files.locator('[data-action="download"]').count() === 1)
  await files.locator('[data-format-choice="xlsx"]').click()
  t.ok('choosing Excel points the buttons at the spreadsheet', (await files.getAttribute('data-format')) === 'xlsx'
    && /\.xlsx$/.test(await files.locator('[data-action="open"]').getAttribute('title')))
  await t.shot(page, 'client-portal-reports')
  const popup = page.waitForEvent('popup', { timeout: 5000 }).catch(() => null)
  await files.locator('[data-action="open"]').click()
  await (await popup)?.close()
  await page.waitForTimeout(300)
  t.ok('a file is asked for by the report id and kind, never a path', calls.some((c) => c.action === 'report-file' && c.body.id === 'r1' && c.body.file === 'xlsx' && !('path' in c.body)))

  await page.getByTestId('portal-nav-accounts').click()
  await page.getByTestId('portal-book').waitFor({ timeout: 5000 })
  const verify = calls.filter((c) => c.action === 'verify').pop()
  t.ok('the code is sent with the address it was asked for', verify?.body?.email === 'jan@alianna.co.za' && verify?.body?.code === '123 456')
  t.ok('the book is asked for with the session, and names no client', calls.some((c) => c.action === 'book' && c.token === TOKEN && !('companyId' in c.body) && !('client' in c.body)))
  t.ok('the client is named at the top', /Alianna Pharmacy/i.test(await page.locator('header').innerText()))

  const head = (await page.locator('[data-testid="portal-book"] thead').innerText()).replace(/\s+/g, ' ').toLowerCase()
  for (const col of ['Debtor', 'Your reference', 'Our reference', 'Capital handed over', 'Paid this month', 'Paid to date', 'Capital outstanding', 'Where it stands']) {
    t.ok(`the column "${col}" is there`, head.includes(col.toLowerCase()))
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
  /* A WIDE TABLE SCROLLS INSIDE ITS CARD, never the page: the band and the sidebar stay put on an iPad. */
  /* Measured as what a person can actually do -- push the page sideways -- because Chromium's scrollWidth on
     <html> counts content already clipped inside the card. */
  const sideways = await page.evaluate(() => { window.scrollTo(400, 0); const x = window.scrollX; window.scrollTo(0, 0); return x })
  const card = await page.evaluate(() => { const w = document.querySelector('[data-testid="portal-book"]')?.parentElement; return w ? getComputedStyle(w).overflowX : 'none' })
  t.ok(`the page does not scroll sideways (scrolled ${sideways}px; the table's card scrolls: ${card})`, sideways === 0 && card === 'auto')
  await t.shot(page, 'client-portal-book')

  /* ---- Phase 2a (S15): ask about a debtor, ask for a call, see and answer tickets. */
  await page.getByTestId('portal-ask-open').first().click()
  await page.getByTestId('portal-ask').waitFor({ timeout: 5000 })
  t.ok('Ask names the debtor and our reference', /Annelie Fourie/.test(await page.getByTestId('portal-ask').innerText()) && /RAP-125327/.test(await page.getByTestId('portal-ask').innerText()))
  await page.getByTestId('portal-ask-text').fill('Has she made an arrangement?')
  t.ok('a question cannot go without saying what it is about', await page.getByTestId('portal-ask-send').isDisabled())
  await page.getByTestId('portal-ask-topics').getByRole('button', { name: 'An update on this account' }).click()
  await page.getByTestId('portal-ask-send').click()
  await page.getByTestId('portal-asked').waitFor({ timeout: 5000 })
  const asked = calls.filter((c) => c.action === 'ask').pop()
  t.ok('the question goes by OUR reference, with the session and the topic', asked?.body?.caseNumber === 'RAP-125327' && asked?.token === TOKEN && /arrangement/.test(asked?.body?.question) && asked?.body?.topic === 'An update on this account')
  t.ok('...and the client is told the ticket number', /T-77/.test(await page.getByTestId('portal-asked').innerText()))

  /* A payment made to the client: recorded, waiting for approval, said so before and after. */
  await page.getByTestId('portal-paid-open').first().click()
  await page.getByTestId('portal-ask').waitFor({ timeout: 5000 })
  t.ok('Paid to you opens on the payment, and says it counts once approved', /counts once Bredell Ferreira has approved it/.test(await page.getByTestId('portal-ask').innerText()))
  await page.getByTestId('portal-pay-amount').fill('1 500.00')
  t.ok('...and cannot go without a reference', await page.getByTestId('portal-ask-send').isDisabled())
  await page.getByTestId('portal-pay-reference').fill('RCPT-9')
  await page.getByTestId('portal-ask-send').click()
  await page.getByTestId('portal-asked').waitFor({ timeout: 5000 })
  const paid = calls.filter((c) => c.action === 'payment-report').pop()
  t.ok('the payment goes by our reference with amount, day and their reference', paid?.body?.caseNumber === 'RAP-125327' && paid?.body?.amount === '1 500.00' && /^\d{4}-\d{2}-\d{2}$/.test(paid?.body?.paidOn) && paid?.body?.reference === 'RCPT-9')
  t.ok('...and the client is told it waits for approval', /counts once we have approved it/.test(await page.getByTestId('portal-asked').innerText()))

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

  await page.getByTestId('portal-nav-tickets').click()
  await page.getByTestId('portal-raise-ticket').waitFor({ timeout: 5000 })
  await page.getByTestId('portal-raise-ticket').click()
  t.ok('the Tickets page raises a ticket too, asking which account', await page.getByTestId('portal-ask-picker').count() === 1
    && /Raise a ticket/.test(await page.getByTestId('portal-ask').innerText()))
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.getByTestId('portal-tickets').waitFor({ timeout: 5000 })
  /* VIEWS (Stephan, 30 Oct): open by default, the client's move first and in gold; closed behind a button. */
  t.check('the list opens on the open tickets only', await page.getByTestId('portal-ticket').count(), 2)
  const firstTicket = await page.getByTestId('portal-ticket').first().innerText()
  t.ok('the one waiting on the client comes first, though it is older, and says so in their words',
    /Waiting on you/.test(firstTicket) && /The debtor disputes the account/.test(firstTicket) && /With the firm/.test(await page.getByTestId('portal-ticket').nth(1).innerText()))
  t.ok('...drawn in gold, with a line saying it needs their answer', /C69F54/i.test(await page.getByTestId('portal-ticket').first().getAttribute('class'))
    && /1 ticket needs your answer/.test(await page.getByTestId('portal-tickets-yours-note').innerText()))
  t.ok('the views count their tickets', /Waiting on you\s*1/.test(await page.getByTestId('portal-ticket-view-yours').innerText())
    && /With the firm\s*1/.test(await page.getByTestId('portal-ticket-view-ours').innerText()) && /Closed \(1\)/.test(await page.getByTestId('portal-ticket-view-closed').innerText()))
  await t.shot(page, 'client-portal-tickets-open')
  await page.getByTestId('portal-ticket-view-ours').click()
  t.ok('With the firm shows only what the firm is doing', await page.getByTestId('portal-ticket').count() === 1
    && (await page.getByTestId('portal-ticket').first().getAttribute('data-turn')) === 'ours')
  await page.getByTestId('portal-ticket-view-open').click()
  await page.getByTestId('portal-ticket').first().locator('button').first().click()
  await page.getByTestId('portal-thread').waitFor({ timeout: 5000 })
  t.ok('the thread shows what the firm wrote, and who wrote it', /statement for March/.test(await page.getByTestId('portal-thread').innerText()) && /Liesl Liaison/.test(await page.getByTestId('portal-thread').innerText()))
  await page.getByTestId('portal-reply').fill('Attached is the proof.')
  await page.getByTestId('portal-reply-send').click()
  await page.waitForTimeout(500)
  const reply = calls.filter((c) => c.action === 'ticket-reply').pop()
  t.ok('a reply goes on the right ticket', reply?.body?.ticketNo === 41 && reply?.body?.message === 'Attached is the proof.')
  await page.getByTestId('portal-ticket-view-closed').click()
  t.ok('the Closed button shows the closed ones, and only them', await page.getByTestId('portal-ticket').count() === 1
    && /Closed/.test(await page.getByTestId('portal-ticket').first().innerText()))
  await page.getByTestId('portal-ticket').first().locator('button').first().click()
  await page.waitForTimeout(500)
  t.check('a closed ticket offers no reply box', await page.getByTestId('portal-ticket').first().getByTestId('portal-reply').count(), 0)
  await t.shot(page, 'client-portal-tickets')

  await page.reload()
  await page.getByTestId('portal-dashboard').waitFor({ timeout: 10000 })
  t.ok('a reload stays signed in', true)
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.getByTestId('portal-sign-in').waitFor({ timeout: 5000 })
  t.ok('signing out asks the server to end the session', calls.some((c) => c.action === 'sign-out' && c.token === TOKEN))
  t.ok('the password was saved with the session the code opened', calls.some((c) => c.action === 'set-password' && c.token === TOKEN && c.body?.password === 'tafelberg sunrise'))
  /* And the next visit is the password, no email. */
  const codesBefore = calls.filter((c) => c.action === 'request-code').length
  await page.getByTestId('portal-email').fill('jan@alianna.co.za')
  await page.getByTestId('portal-password').fill('tafelberg sunrise')
  await page.getByTestId('portal-remember').check()
  await page.getByTestId('portal-sign-in-button').click()
  await page.getByTestId('portal-splash').waitFor({ timeout: 5000 })
  t.ok('a second opening in the same tab is the short one', await page.locator('[data-splash="short"]').count() === 1)
  await page.getByTestId('portal-dashboard').waitFor({ timeout: 5000 })
  await page.getByTestId('portal-splash').waitFor({ state: 'detached', timeout: 5000 })
  t.ok('Keep me signed in is asked for, and the browser keeps the session', calls.filter((c) => c.action === 'sign-in').pop()?.body?.remember === true
    && await page.evaluate(() => Object.keys(localStorage).some((k) => /portal/i.test(k))))
  t.ok('the next visit signs in with the password, and no code is emailed', calls.filter((c) => c.action === 'request-code').length === codesBefore)
} catch (e) {
  t.ok(`the run finished without throwing (${String(e).slice(0, 200)})`, false)
} finally {
  await browser.close()
  await stopServer(server)
}
const good = t.finish('A client signs in to the portal with a code the first time and a password after, and sees one line per debtor, with no staff login and nothing but their own book.')
process.exit(good ? 0 : 1)

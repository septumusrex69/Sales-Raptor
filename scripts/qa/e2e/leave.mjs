/**
 * LEAVE AND THE SIMPLEPAY EXPORT, IN A REAL BROWSER (23 Oct 2026).
 *
 * check-leave holds the arithmetic and the database. What only a browser shows:
 *   1. A TEAM LEADER (no ticks) has a People item that opens on Leave, sees their own team and nobody
 *      else's -- "Team leaders can also see the leave of their teams" -- no pay item, no recording
 *      form, and somebody else's address says it is not theirs.
 *   2. AN ADMINISTRATOR WITHOUT people.pay records leave: the days are worked out before saving, in
 *      working days with a public holiday out and a half day, and what is sent is that figure; a
 *      stretch over leave already recorded is refused before it is sent.
 *   3. A PAY HOLDER exports the Month summary for SimplePay: the summary's own basic and commission,
 *      the employee number, and the leave inside the SALARY month only; the statement carries the
 *      same leave as an information line.
 *
 * Pinned to Mon 2 Nov 2026. Thandi started 15 Jan 2026: nine completed months, 11.25 days accrued;
 * 2.5 taken in June, 5 booked for 23-27 Nov -> 3.75 left.
 *
 * Run: RAPTOR_E2E_PORT=5409 node scripts/qa/e2e/leave.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('leave')
const NOW = '2026-11-02T10:00:00+02:00'
const LEADER = { ...PROFILE, name: 'Lerato Leader', team_id: 't1', grants: [] }
const MATE_ID = '55555555-5555-4555-8555-555555555555'
const OTHER_ID = '66666666-6666-4666-8666-666666666666'
const MATE = { ...PROFILE, id: MATE_ID, name: 'Thandi', email: 'thandi@raptor.test', role: 'Pre-legal Agent', team_id: 't1', start_date: '2026-01-15' }
const OTHER = { ...PROFILE, id: OTHER_ID, name: 'Sipho Elsewhere', email: 'sipho@raptor.test', role: 'Pre-legal Agent', team_id: 't2', start_date: '2025-02-01' }
const ADMIN = { ...PROFILE, name: 'Barry', role: 'Administrator', team_id: null, grants: [] }
const OWNER = { ...ADMIN, name: 'Stephan', grants: ['people.pay'] }

const leaveRow = (o) => ({
  id: o.id, user_id: o.user, kind: o.kind ?? 'annual', entry: 'taken', starts_on: o.from, ends_on: o.to ?? o.from,
  start_half: o.startHalf ?? false, end_half: false, days: o.days, note: null, created_by: ADMIN.id,
  created_at: '2026-05-20T08:00:00Z', cancelled_at: null, cancelled_by: null, cancel_reason: null,
})
const LEAVE = [
  leaveRow({ id: 'l1', user: MATE_ID, from: '2026-06-01', to: '2026-06-03', startHalf: true, days: 2.5 }),
  leaveRow({ id: 'l2', user: MATE_ID, from: '2026-11-23', to: '2026-11-27', days: 5 }),
  leaveRow({ id: 'l3', user: OTHER_ID, kind: 'sick', from: '2026-10-20', days: 1 }),
]

const posted = []
function handlers(me, { leaveFor = () => true } = {}) {
  return [
    [(u) => /\/rest\/v1\/profiles/.test(u), (u) => ({ body: /id=eq\./.test(u) ? [me] : [me, MATE, OTHER] })],
    [(u, req) => /\/rest\/v1\/leave_records/.test(u) && req.method() === 'POST', (u, req) => { posted.push(req.postDataJSON()); return { status: 201, body: [] } }],
    /* THE DATABASE DECIDES WHOSE LEAVE COMES BACK; the fixture plays leave_visible for each signed-in person. */
    [(u) => /\/rest\/v1\/leave_records/.test(u), () => ({ body: LEAVE.filter((r) => leaveFor(r.user_id)) })],
    [(u) => /\/rest\/v1\/employee_profiles/.test(u), () => ({ body: [{
      user_id: MATE_ID, job_title: 'Clerk', ended_on: null, pay_basis: null, basic_salary: 4000, notes: null,
      updated_by: null, updated_at: '2026-10-01T08:00:00Z', employee_number: 'E007',
    }] })],
    [(u) => /\/rpc\/clerk_commission_lines/.test(u), () => ({ body: [{
      payment_id: 'p1', account_id: 'a1', case_number: 'BF1', debtor: 'A Debtor', company_id: 'c1', client: 'Kestrel',
      received_on: '2026-10-15', approved_on: '2026-10-15', reversed_on: null, reversal_reason: null, amount: 10000, paid_to_client: false,
      holder_id: MATE_ID, holder_source: 'change', client_rate: 0.3, client_rate_source: 'receipt',
      account_override: null, account_override_set: false, account_override_reason: null,
      client_override: null, client_override_set: false, client_override_reason: null, payover_run_id: null,
    }] })],
    [(u) => /\/rest\/v1\//.test(u), () => ({ body: [] })],
    [(u) => /\/rpc\//.test(u), () => ({ body: [] })],
  ]
}

async function open(browser, me, path, opts) {
  const { context, page } = await signedInPage(browser, { ...me, start_date: me.start_date ?? null }, handlers(me, opts), [], { now: NOW })
  /* The export goes out through a blob URL; keep the last blob so its text can be read back. */
  await page.addInitScript(() => {
    const orig = URL.createObjectURL.bind(URL)
    URL.createObjectURL = (b) => { window.__lastBlob = b; return orig(b) }
  })
  await page.goto(`http://127.0.0.1:${PORT}${path}`, { waitUntil: 'domcontentloaded' })
  return { context, page }
}

const server = await startServer()
const browser = await chromium.launch()
try {
  /* ---------------- 1. a team leader ---------------- */
  {
    const team = (id) => id === MATE_ID || id === LEADER.id
    const { context, page } = await open(browser, LEADER, '/people', { leaveFor: team })
    await page.waitForURL((u) => u.pathname === '/people/leave', { timeout: 20000 })
    t.ok('a team leader has a People item', await page.locator('aside nav a[href="/people"]').isVisible())
    t.ok('...which opens on Leave', new URL(page.url()).pathname === '/people/leave')
    await page.getByTestId('leave-list').waitFor({ timeout: 20000 })
    const names = await page.getByTestId('leave-row').allInnerTexts()
    t.ok('...their team member is listed', names.some((n) => n.includes('Thandi')))
    t.ok('...somebody in another team is not', !names.some((n) => n.includes('Sipho')))
    t.check('Thandi: 11.25 accrued - 2.5 taken - 5 booked = 3.75 left',
      (await page.getByTestId('leave-row').filter({ hasText: 'Thandi' }).getByTestId('annual-left').innerText()).trim(), '3.75')
    t.check('...no pay item on the rail', await page.locator('a[href="/people/month"]').count(), 0)
    t.check('...and no recording form', await page.getByTestId('record-leave').count(), 0)
    await page.getByRole('link', { name: 'Thandi' }).click()
    await page.getByTestId('leave-balances').waitFor({ timeout: 20000 })
    t.check('a person\'s page shows each kind: annual left', (await page.getByTestId('left-annual').innerText()).trim(), '3.75')
    t.check('...sick: past six months, 30 in the cycle', (await page.getByTestId('left-sick').innerText()).trim(), '30')
    t.check('...family: 3', (await page.getByTestId('left-family').innerText()).trim(), '3')
    await page.goto(`http://127.0.0.1:${PORT}/people/leave/${OTHER_ID}`, { waitUntil: 'domcontentloaded' })
    await page.getByText('not yours to see').waitFor({ timeout: 20000 })
    t.ok('another team\'s person: "not yours to see"', await page.getByText('not yours to see').isVisible())
    await context.close()
  }

  /* ---------------- 2. an Administrator records leave ---------------- */
  {
    const { context, page } = await open(browser, ADMIN, '/people/leave')
    await page.getByTestId('record-leave').waitFor({ timeout: 20000 })
    t.ok('an Administrator without people.pay sees everybody', (await page.getByTestId('leave-row').allInnerTexts()).some((n) => n.includes('Sipho')))
    await page.getByTestId('leave-who').selectOption(MATE_ID)
    await page.getByTestId('leave-from').fill('2026-12-14')
    await page.getByTestId('leave-to').fill('2026-12-18')
    await page.getByTestId('leave-start-half').check()
    t.check('Mon 14 - Fri 18 Dec from midday Monday, the 16th a public holiday: 3.5 working days',
      (await page.getByTestId('leave-days').innerText()).trim(), '3.5 working days')
    await page.getByRole('button', { name: 'Record' }).click()
    await page.getByText('Recorded.').waitFor({ timeout: 20000 })
    t.check('...and that is what is sent', JSON.stringify(posted.map((p) => [p.user_id, p.kind, p.starts_on, p.ends_on, p.start_half, p.days])),
      JSON.stringify([[MATE_ID, 'annual', '2026-12-14', '2026-12-18', true, 3.5]]))
    await page.getByTestId('leave-who').selectOption(MATE_ID)
    await page.getByTestId('leave-from').fill('2026-11-25')
    await page.getByTestId('leave-problem').waitFor({ timeout: 20000 })
    t.ok('a day already on leave is refused before it is sent', /already leave recorded from 23 Nov 2026 to 27 Nov 2026/.test(await page.getByTestId('leave-problem').innerText()))
    t.ok('...the Record button is dead', await page.getByRole('button', { name: 'Record' }).isDisabled())
    await t.shot(page, 'leave-record')
    await context.close()
  }

  /* ---------------- 3. the pay holder: SimplePay, and the statement's leave line ---------------- */
  {
    const { context, page } = await open(browser, OWNER, '/people/month')
    await page.getByTestId('month-summary').waitFor({ timeout: 20000 })
    await page.getByTestId('export-simplepay').click()
    await page.waitForFunction(() => !!window.__lastBlob, null, { timeout: 20000 })
    const csv = await page.evaluate(() => window.__lastBlob.text())
    const rows = csv.split('\r\n')
    t.ok('the export has the heading row', rows[0].startsWith('Employee number,Employee,Email,Basic salary,Commission,Annual leave (days)'))
    const thandi = rows.find((r) => r.includes('Thandi')) ?? ''
    /* Basic: the summary's (a full month, started before 26 Oct); commission 3% of R10 000; annual leave
       23-25 Nov only -- 26 and 27 Nov are in December's salary month. */
    t.check('Thandi\'s row: number, basic, commission, and only the leave inside the salary month',
      thandi, 'E007,Thandi,thandi@raptor.test,4000.00,300.00,3,0,0,0,0,0,0,0')
    t.ok('...and the summary shows the same leave', /Annual leave 3 days/.test(await page.getByTestId('month-summary').innerText()))
    await page.goto(`http://127.0.0.1:${PORT}/people/${MATE_ID}`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('statement-leave').waitFor({ timeout: 20000 })
    t.ok('the statement carries the leave as information', /Annual leave 3 days\. For information; it does not change the figures above\./
      .test((await page.getByTestId('statement-leave').innerText()).replace(/\s+/g, ' ')))
    t.check('...and the payable is untouched by it', (await page.getByTestId('payable-total').innerText()).replace(/\s+/g, ' ').trim(), 'R 4 300.00')
    await context.close()
  }
} finally {
  await browser.close()
  await stopServer(server)
}
const good = t.finish(
  `Leave (23 Oct): a team leader sees their team's leave and balances and nobody else's, with no pay
and no recording; an Administrator records leave in working days with half days and holidays out, and
an overlap is refused; the SimplePay export carries the summary's basic and commission, the employee
number and the leave inside the salary month, and the statement shows that leave as information only.`)
process.exit(good ? 0 : 1)

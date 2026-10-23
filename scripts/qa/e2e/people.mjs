/**
 * PEOPLE AND PAY, IN A REAL BROWSER (22 Oct 2026; the firm's answers, 23 Oct).
 *
 * check-clerk-commission holds the arithmetic and the database. What only a browser sees:
 *   1. An Administrator WITHOUT people.pay -- who has everything else -- has no People item, and the
 *      address alone does not open it. The firm named who sees pay: "not even all Administrators".
 *   2. ...but the Add User box asks THEM for the start date too: "A user start date can also be asked
 *      for any administrator" (it is not pay data). And so it does for a people.pay holder.
 *   3. With the tick, a clerk's statement shows its pay day (the 25th), a pro-rata basic for a starter,
 *      and its three sections in the firm's order -- Payments, PTCs paid out, PTCs waiting -- with a
 *      payable total that leaves the waiting PTC out. PTCs are released by the PAYOVER RUN.
 *
 * The fixture, pinned to 2 Nov 2026 (the November period, 11 Oct - 10 Nov, paid 25 Nov; the salary
 * month 26 Oct - 25 Nov, 23 working days):
 *   the clerk started Wed 28 Oct                                   -> basic 4 000 x 21/23 = R3 652.17
 *   a R10 000 payment into trust on 15 Oct on a 30% client        -> R300 (rule, 3%)
 *   a R5 000 PTC on 1 Oct, its run (cycle to 10 Oct) approved 27 Oct
 *     showing nothing outstanding                                  -> R150 released on 25 Nov
 *   a R2 000 PTC on 5 Oct on a 20% client whose run left R600 short -> R40 waiting, not payable
 *                                                                   -> payable R4 102.17
 *
 * Run: RAPTOR_E2E_PORT=5405 node scripts/qa/e2e/people.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('people')
const NOW = '2026-11-02T10:00:00+02:00'
const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator', team_id: null, grants: [] }
const OWNER = { ...ADMIN, grants: ['people.pay'] }
const CLERK_ID = '44444444-4444-4444-8444-444444444444'
const CLERK = { ...PROFILE, id: CLERK_ID, name: 'Thandi', email: 'thandi@raptor.test', role: 'Pre-legal Agent', start_date: '2026-10-28' }

const line = (o) => ({
  payment_id: o.id, account_id: `acc-${o.id}`, case_number: `BF${o.id}`, debtor: 'A Debtor', company_id: o.company,
  client: o.client, received_on: o.on, approved_on: o.on, reversed_on: null, reversal_reason: null, amount: o.amount, paid_to_client: o.ptc,
  holder_id: CLERK_ID, holder_source: 'change', client_rate: o.rate, client_rate_source: 'receipt',
  account_override: null, account_override_set: false, account_override_reason: null,
  client_override: null, client_override_set: false, client_override_reason: null,
  payover_run_id: o.run ?? null,
})
const LINES = [
  line({ id: '1', on: '2026-10-15', amount: 10000, ptc: false, rate: 0.3, company: 'c1', client: 'Kestrel Insurance' }),
  line({ id: '2', on: '2026-10-01', amount: 5000, ptc: true, rate: 0.3, company: 'c1', client: 'Kestrel Insurance', run: 'r1' }),
  line({ id: '3', on: '2026-10-05', amount: 2000, ptc: true, rate: 0.2, company: 'c2', client: 'Rinda Roo', run: 'r2' }),
]
const RUNS = [
  { run_id: 'r1', company_id: 'c1', period_start: '2026-09-11', period_end: '2026-10-10', status: 'approved', invoice_number: 'KES-0007',
    net_payover: 2500, carried_in: 0, approved_on: '2026-10-27', settled_on: null },
  { run_id: 'r2', company_id: 'c2', period_start: '2026-09-11', period_end: '2026-10-10', status: 'approved', invoice_number: 'RRO-0003',
    net_payover: -600, carried_in: 0, approved_on: '2026-10-11', settled_on: null },
]

const asked = []
function handlers(me) {
  return [
    [(u) => /\/rest\/v1\/profiles/.test(u), (u) => ({ body: /id=eq\./.test(u) ? [me] : [me, CLERK] })],
    [(u) => /\/rest\/v1\/employee_profiles/.test(u), () => ({ body: [{
      user_id: CLERK_ID, job_title: 'Clerk', ended_on: null, pay_basis: null, basic_salary: 4000,
      notes: null, updated_by: null, updated_at: '2026-10-01T08:00:00Z',
    }] })],
    [(u) => /\/rpc\/clerk_commission_lines/.test(u), (u, req) => { asked.push(req.postDataJSON()); return { body: LINES } }],
    [(u) => /\/rpc\/clerk_commission_runs/.test(u), () => ({ body: RUNS })],
    [(u) => /\/rest\/v1\//.test(u), () => ({ body: [] })],
    [(u) => /\/rpc\//.test(u), () => ({ body: [] })],
  ]
}

async function open(browser, me, path) {
  const { context, page } = await signedInPage(browser, me, handlers(me), [], { now: NOW })
  await page.goto(`http://127.0.0.1:${PORT}${path}`, { waitUntil: 'domcontentloaded' })
  return { context, page }
}
const text = async (page, id) => (await page.getByTestId(id).innerText()).replace(/\s+/g, ' ').trim()

/** The Add User box: is the start date asked? */
async function inviteAsksStartDate(browser, me) {
  const { context, page } = await open(browser, me, '/settings?tab=Users')
  await page.getByRole('button', { name: 'Add User' }).first().click({ timeout: 20000 })
  await page.getByRole('button', { name: 'Send Invite' }).waitFor({ timeout: 20000 })
  const shown = await page.getByTestId('invite-start-date').isVisible().catch(() => false)
  /* A record of somebody who has LEFT has no start date to ask: it is a record, not a person starting. */
  await page.getByText('This person has already left the firm').click()
  const hiddenForLeaver = (await page.getByTestId('invite-start-date').count()) === 0
  await context.close()
  return { shown, hiddenForLeaver }
}

const server = await startServer()
const browser = await chromium.launch()
try {
  /* ---------------- 1. an Administrator without the tick ---------------- */
  {
    const { context, page } = await open(browser, ADMIN, '/people')
    await page.waitForURL((u) => u.pathname === '/', { timeout: 20000 })
    t.ok('the address alone does not open People for an Administrator without the tick', new URL(page.url()).pathname === '/')
    await page.locator('aside nav a[href="/business"]').waitFor({ timeout: 20000 })
    t.check('...and the menu has no People item', await page.locator('aside nav a[href="/people"]').count(), 0)
    await context.close()
  }

  /* ---------------- 2. the start date at the door, for every Administrator ---------------- */
  {
    const admin = await inviteAsksStartDate(browser, ADMIN)
    t.ok('Add User asks an Administrator WITHOUT people.pay for the start date', admin.shown)
    t.ok('...but not for a record of somebody who has left', admin.hiddenForLeaver)
    const owner = await inviteAsksStartDate(browser, OWNER)
    t.ok('...and asks a people.pay holder too', owner.shown)
  }

  /* ---------------- 3. with the tick ---------------- */
  {
    const { context, page } = await open(browser, OWNER, `/people/${CLERK_ID}`)
    await page.locator('aside nav a[href="/people"]').waitFor({ timeout: 20000 })
    t.ok('with the tick the menu has People', await page.locator('aside nav a[href="/people"]').isVisible())
    await page.getByTestId('pay-statement').waitFor({ timeout: 20000 })
    t.check('the period is the firm’s November (11 Oct – 10 Nov)', await text(page, 'pay-period-label'), 'November 2026')
    t.check('...paid on the 25th', await text(page, 'payday'), '25 Nov 2026')
    t.ok('the statement is asked for that period and this clerk',
      asked.some((a) => a.p_from === '2026-10-11' && a.p_to === '2026-11-10' && a.p_user === CLERK_ID))
    t.check('the start date is read off the user, not the pay record', await page.getByTestId('start-date').innerText().then((s) => s.split('\n')[0].trim()), '28 Oct 2026')

    const sections = ['section-payments', 'section-ptc-paid', 'section-ptc-pending']
    for (const s of sections) t.ok(`${s} is drawn`, await page.getByTestId(s).isVisible())
    const ys = []
    for (const s of sections) ys.push((await page.getByTestId(s).boundingBox())?.y ?? -1)
    t.ok('...in the firm’s order: payments, PTCs paid out, PTCs waiting', ys[0] >= 0 && ys[0] < ys[1] && ys[1] < ys[2])

    t.check('a starter on 28 Oct is paid the basic pro rata: R4 000 x 21/23', await text(page, 'basic-paid'), 'R 3 652.17')
    t.ok('...and the statement says how', /Pro rata: 21 of 23 working days \(28 Oct 2026 – 25 Nov 2026\)/.test(await text(page, 'basic-prorata')))
    t.check('commission on payments is R300 (3% of R10 000)', await text(page, 'payments-total'), 'R 300.00')
    t.check('the PTC whose payover run showed nothing outstanding is paid out: R150', await text(page, 'released-total'), 'R 150.00')
    t.ok('...naming the run that released it', /payover KES-0007 \(cycle to 10 Oct 2026\) showed nothing outstanding/.test(await text(page, 'ptc-released-by')))
    t.check('the PTC whose run left the client short is waiting: R40', await text(page, 'pending-total'), 'R 40.00')
    t.check('payable is the pro-rata basic + payments + paid-out PTCs, without the waiting R40', await text(page, 'payable-total'), 'R 4 102.17')
    t.ok('the waiting client says what its run left outstanding and since which run',
      /left R 600\.00 outstanding; owing since payover RRO-0003 \(cycle to 10 Oct 2026\)/.test(await text(page, 'ptc-owed')))
    const payable = (await page.getByTestId('payable-total').boundingBox())?.y ?? -1
    t.ok('...and the waiting section is drawn below the total, outside it', payable > 0 && payable < ys[2])
    await t.shot(page, 'people-statement')
    await context.close()
  }
} finally {
  await browser.close()
  await stopServer(server)
}
const good = t.finish(
  `People (22-23 Oct): an Administrator without people.pay has no People item, yet Add User asks every
Administrator for the start date; with the tick, a clerk's statement shows the 25th as pay day, a
pro-rata basic for a starter, and Payments, PTCs paid out (released by the payover run) and PTCs
waiting in that order, the payable total leaving the waiting PTC out.`)
process.exit(good ? 0 : 1)

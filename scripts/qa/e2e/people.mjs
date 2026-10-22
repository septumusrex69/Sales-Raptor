/**
 * PEOPLE AND PAY, IN A REAL BROWSER (22 Oct 2026).
 *
 * check-clerk-commission holds the arithmetic and the database. What only a browser sees:
 *   1. An Administrator WITHOUT people.pay -- who has everything else -- has no People item, and the
 *      address alone does not open it. The firm named who sees pay: "not even all Administrators".
 *   2. With the tick the item is there, and a clerk's statement draws its three sections in the firm's
 *      order -- Payments, PTCs paid out, PTCs waiting -- with a payable total that leaves the waiting
 *      PTC out.
 *
 * The fixture, pinned to 22 Oct 2026 (the November period, 11 Oct - 10 Nov):
 *   a R10 000 payment into trust on 15 Oct on a 30% client       -> R300 (rule, 3%)
 *   a R5 000 PTC on 1 Oct, its client clear again from 20 Oct     -> R150 released this period
 *   a R2 000 PTC on 16 Oct on a 20% client still owing R600       -> R40 waiting, not payable
 *   basic R4 000                                                  -> payable R4 450
 *
 * Run: RAPTOR_E2E_PORT=5404 node scripts/qa/e2e/people.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('people')
const NOW = '2026-10-22T10:00:00+02:00'
const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator', team_id: null, grants: [] }
const OWNER = { ...ADMIN, grants: ['people.pay'] }
const CLERK_ID = '44444444-4444-4444-8444-444444444444'
const CLERK = { ...PROFILE, id: CLERK_ID, name: 'Thandi', email: 'thandi@raptor.test', role: 'Pre-legal Agent' }

const line = (o) => ({
  payment_id: o.id, account_id: `acc-${o.id}`, case_number: `BF${o.id}`, debtor: 'A Debtor', company_id: o.company,
  client: o.client, received_on: o.on, approved_on: o.on, reversed_on: null, amount: o.amount, paid_to_client: o.ptc,
  holder_id: CLERK_ID, holder_source: 'change', client_rate: o.rate, client_rate_source: 'receipt',
  account_override: null, account_override_set: false, account_override_reason: null,
  client_override: null, client_override_set: false, client_override_reason: null,
})
const LINES = [
  line({ id: '1', on: '2026-10-15', amount: 10000, ptc: false, rate: 0.3, company: 'c1', client: 'Kestrel Insurance' }),
  line({ id: '2', on: '2026-10-01', amount: 5000, ptc: true, rate: 0.3, company: 'c1', client: 'Kestrel Insurance' }),
  line({ id: '3', on: '2026-10-16', amount: 2000, ptc: true, rate: 0.2, company: 'c2', client: 'Rinda Roo' }),
]
const LEDGERS = [
  { company_id: 'c1', entry_on: '2026-10-01', amount: -1500 },
  { company_id: 'c1', entry_on: '2026-10-20', amount: 1500 },
  { company_id: 'c2', entry_on: '2026-10-16', amount: -600 },
]

const asked = []
function handlers(me) {
  return [
    [(u) => /\/rest\/v1\/profiles/.test(u), (u) => ({ body: /id=eq\./.test(u) ? [me] : [me, CLERK] })],
    [(u) => /\/rest\/v1\/employee_profiles/.test(u), () => ({ body: [{
      user_id: CLERK_ID, job_title: 'Clerk', started_on: '2026-03-01', pay_basis: null, basic_salary: 4000,
      notes: null, updated_by: null, updated_at: '2026-10-01T08:00:00Z',
    }] })],
    [(u) => /\/rpc\/clerk_commission_lines/.test(u), (u, req) => { asked.push(req.postDataJSON()); return { body: LINES } }],
    [(u) => /\/rpc\/clerk_commission_ledgers/.test(u), () => ({ body: LEDGERS })],
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

  /* ---------------- 2. with it ---------------- */
  {
    const { context, page } = await open(browser, OWNER, `/people/${CLERK_ID}`)
    await page.locator('aside nav a[href="/people"]').waitFor({ timeout: 20000 })
    t.ok('with the tick the menu has People', await page.locator('aside nav a[href="/people"]').isVisible())
    await page.getByTestId('pay-statement').waitFor({ timeout: 20000 })
    t.check('the period is the firm’s November (11 Oct – 10 Nov)', await text(page, 'pay-period-label'), 'November 2026')
    t.ok('the statement is asked for that period and this clerk',
      asked.some((a) => a.p_from === '2026-10-11' && a.p_to === '2026-11-10' && a.p_user === CLERK_ID))

    const sections = ['section-payments', 'section-ptc-paid', 'section-ptc-pending']
    for (const s of sections) t.ok(`${s} is drawn`, await page.getByTestId(s).isVisible())
    const ys = []
    for (const s of sections) ys.push((await page.getByTestId(s).boundingBox())?.y ?? -1)
    t.ok('...in the firm’s order: payments, PTCs paid out, PTCs waiting', ys[0] >= 0 && ys[0] < ys[1] && ys[1] < ys[2])

    t.check('commission on payments is R300 (3% of R10 000)', await text(page, 'payments-total'), 'R 300.00')
    t.check('the PTC whose client is clear is paid out: R150', await text(page, 'released-total'), 'R 150.00')
    t.check('the PTC whose client still owes is waiting: R40', await text(page, 'pending-total'), 'R 40.00')
    t.check('payable is basic + payments + paid-out PTCs, without the waiting R40', await text(page, 'payable-total'), 'R 4 450.00')
    t.ok('the waiting client says what it owes and since when', /Owes the firm R 600\.00 since 16 Oct 2026/.test(await text(page, 'ptc-owed')))
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
  `People (22 Oct): an Administrator without people.pay has no People item and the address sends them
home; with it, a clerk's statement draws Payments, PTCs paid out and PTCs waiting in that order, and
the payable total is basic + payments + released PTCs, leaving the waiting PTC out.`)
process.exit(good ? 0 : 1)

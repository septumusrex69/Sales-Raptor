/**
 * THE SETTLEMENT PANEL, IN A REAL BROWSER (task #69).
 *
 * check-settlement holds the rules and the database's source. What it cannot see is the half only a
 * browser does: that the panel is DRAWN on the account, in the side column under the promise, and
 * that each button sends the function it claims to with what the person typed. A panel that ships,
 * is in the bundle, and is invisible is the failure this layer exists for (CLAUDE.md).
 *
 *   1. no offer, a pre-legal agent  -> may put one up; propose_settlement gets the amount and the
 *      balance it is measured from; no approve button, because the figure is the client's
 *   2. a proposal, the liaison      -> "The client approved it" sends approve_settlement with the
 *      expiry and how the client said yes; nothing is quotable until then
 *   3. a proposal, the agent        -> sees it, cannot approve it, cannot withdraw somebody else's
 *   4. approved and paid in full    -> "Paid -- close as settled" sends close_as_settled; a part
 *      payment draws no such button
 *
 * ASSERTED ON WHAT WAS SENT, as books.mjs is: a fixture answers every request, so what can be proved
 * is that the press called the right function with the right arguments.
 *
 * Run: node scripts/qa/e2e/settlement.mjs
 */
import { OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { LIAISON, UNGRADED } from './fixtures.mjs'

const t = makeRunner('settlement')
const AGENT = UNGRADED

const ACCOUNT = {
  id: 'a-settle', company_id: 'c1', account_number: 'KIS0012', case_number: 'RAP-200012',
  debtor_surname: 'Mokoena', debtor_first_name: 'Thabo', status: 'Active: Activated', book: 'active',
  capital_handed_over: 48250, capital_outstanding: 48250, commission_drift: false,
}

const offer = (state, extra = {}) => ({
  id: 'set-1', account_id: ACCOUNT.id, amount: 18000, balance_at_offer: 48250,
  balance_as_at: '2026-10-07', saving: 30250, status: state === 'lapsed' ? 'approved' : state, state,
  expires_on: state === 'proposed' ? null : '2099-10-31',
  proposed_by: LIAISON.id, proposed_at: '2026-10-07T08:00:00Z', proposal_note: 'Offered on the call',
  approved_by: state === 'proposed' ? null : LIAISON.id,
  approved_at: state === 'proposed' ? null : '2026-10-07T09:00:00Z',
  approval_evidence: state === 'proposed' ? null : 'Email from the client, 7 Oct',
  closed_by: null, closed_at: null, closed_reason: null, paid_toward: 0, ...extra,
})

let current = null   // what account_settlement answers
let sent = []        // rpc name + body, for every settlement call

function handlers(me) {
  return [
    /* The signed-in profile is fetched by id and must come back alone; the list of people (for
       "put up by") is everybody. */
    [(u) => /\/rest\/v1\/profiles/.test(u), (u) => ({
      body: /id=eq\./.test(u) ? [me] : (me.id === LIAISON.id ? [me] : [me, LIAISON]),
    })],
    [(u) => /\/rest\/v1\/firm_settings/.test(u), () => ({ body: [{ firm_name: 'Bredell Ferreira', vat_rate: 0.15 }] })],
    [(u) => /\/rest\/v1\/debtor_accounts/.test(u), () => ({ body: [ACCOUNT] })],
    [(u) => /\/rpc\/account_settlement\b/.test(u), () => ({ body: current ? [current] : [] })],
    [(u) => /\/rpc\/(propose_settlement|approve_settlement|close_settlement_offer|close_as_settled)/.test(u),
      (url, req) => {
        sent.push({ fn: /\/rpc\/(\w+)/.exec(url)[1], body: req.postDataJSON() })
        return { body: 'set-1' }
      }],
    [(u) => /\/rest\/v1\//.test(u), () => ({ body: [] })],
    [(u) => /\/rpc\//.test(u), () => ({ body: [] })],
  ]
}

async function open(browser, me) {
  sent = []
  const { context, page } = await signedInPage(browser, me, handlers(me), [])
  await page.goto(`http://127.0.0.1:${PORT}/accounts/${ACCOUNT.id}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Settlement' }).first().waitFor({ timeout: 20000 })
  return { context, page }
}

const server = await startServer()
const browser = await chromium.launch()
try {
  /* ---------------- 1. no offer, a pre-legal agent ---------------- */
  {
    current = null
    const { context, page } = await open(browser, AGENT)
    /* IN THE SIDE COLUMN, UNDER THE PROMISE. Measured, not assumed. */
    const promise = await page.getByRole('heading', { name: 'Promise to pay' }).first().boundingBox()
    const settle = await page.getByRole('heading', { name: 'Settlement' }).first().boundingBox()
    t.ok('the settlement panel is drawn on the account', !!settle && settle.height > 0)
    t.ok('...under the promise to pay', !!promise && !!settle && settle.y > promise.y)
    await t.shot(page, 'settlement-none')

    await page.getByRole('button', { name: 'Put an offer up for approval' }).click()
    const amount = page.getByLabel(/What the debtor offers/)
    /* A FIGURE AT THE BALANCE IS A PAYMENT IN FULL, and the box says so rather than sending it. */
    await amount.fill('99999999')
    t.ok('a figure over the balance is refused in the box',
      await page.getByRole('button', { name: 'Put it up' }).isDisabled())
    await amount.fill('18000')
    await page.getByLabel(/Note for the liaison/).fill('Pension payout next week')
    await page.getByRole('button', { name: 'Put it up' }).click()
    await page.waitForTimeout(300)
    const p = sent.find((x) => x.fn === 'propose_settlement')
    t.ok('putting it up calls propose_settlement', !!p)
    t.check('...for this account', p?.body?.p_account, ACCOUNT.id)
    t.check('...with the amount typed', p?.body?.p_amount, 18000)
    t.ok('...and the balance it is measured from, which is more', (p?.body?.p_balance ?? 0) > 18000)
    t.check('...and the note', p?.body?.p_note, 'Pension payout next week')
    await context.close()
  }

  /* ---------------- 2. a proposal, the liaison ---------------- */
  {
    current = offer('proposed')
    const { context, page } = await open(browser, LIAISON)
    t.ok('a proposal says it waits for the client', await page.getByText('Waiting for the client').first().isVisible())
    t.ok('...and that it is not to be quoted', await page.getByText(/Not to be quoted until the client approves it/).first().isVisible())
    await page.getByRole('button', { name: 'The client approved it' }).click()
    const go = page.getByRole('button', { name: 'Record approval' })
    t.ok('approval is refused without an expiry or how the client said yes', await go.isDisabled())
    await page.getByLabel(/Must be paid by/).fill('2099-10-31')
    await page.getByLabel(/How the client approved it/).fill('Email from the client, 7 Oct')
    await go.click()
    await page.waitForTimeout(300)
    const a = sent.find((x) => x.fn === 'approve_settlement')
    t.ok('recording it calls approve_settlement', !!a)
    t.check('...for this offer', a?.body?.p_id, 'set-1')
    t.check('...with the expiry', a?.body?.p_expires_on, '2099-10-31')
    t.check('...and the evidence', a?.body?.p_evidence, 'Email from the client, 7 Oct')
    t.check('...and the figure', a?.body?.p_amount, 18000)
    await t.shot(page, 'settlement-proposed-liaison')
    await context.close()
  }

  /* ---------------- 3. a proposal, the agent ---------------- */
  {
    current = offer('proposed')
    const { context, page } = await open(browser, AGENT)
    t.ok('the agent sees the offer', await page.getByText('Waiting for the client').first().isVisible())
    t.check('...but is offered no approval -- the figure is the client\'s',
      await page.getByRole('button', { name: 'The client approved it' }).count(), 0)
    t.check('...and cannot withdraw somebody else\'s', await page.getByRole('button', { name: 'Withdraw' }).count(), 0)
    await context.close()
  }

  /* ---------------- 4. approved: part paid, then paid in full ---------------- */
  {
    current = offer('approved', { paid_toward: 17999 })
    const { context, page } = await open(browser, LIAISON)
    t.ok('an approved offer says so', await page.getByText('Approved by the client').first().isVisible())
    t.check('a part payment draws no close button',
      await page.getByRole('button', { name: /close as settled/ }).count(), 0)
    await context.close()
  }
  {
    current = offer('approved', { paid_toward: 18000 })
    const { context, page } = await open(browser, LIAISON)
    await page.getByRole('button', { name: /Paid — close as settled/ }).click()
    await page.getByRole('button', { name: 'Close as settled', exact: true }).click()
    await page.waitForTimeout(300)
    const c = sent.find((x) => x.fn === 'close_as_settled')
    t.ok('paid in full, the person closes it: close_as_settled is called', !!c)
    t.check('...for this offer', c?.body?.p_id, 'set-1')
    await t.shot(page, 'settlement-paid')
    await context.close()
  }
} catch (e) {
  t.ok(`the run finished without throwing (${String(e).split('\n')[0].slice(0, 160)})`, false)
  try {
    const pages = browser.contexts().flatMap((c) => c.pages())
    if (pages[0]) await t.shot(pages[0], 'settlement-where-it-stopped')
  } catch { /* nothing more to learn */ }
} finally {
  await browser.close()
  stopServer(server)
}

const good = t.finish(`The settlement panel is on the account under the promise; an offer goes up, the client's
approval is recorded with an expiry and evidence, and a paid one is closed by a person. Screenshots in ${OUT}.`)
process.exit(good ? 0 : 1)

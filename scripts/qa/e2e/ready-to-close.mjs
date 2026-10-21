/**
 * READY TO CLOSE, AND A SETTLED ACCOUNT THAT READS SETTLED, IN A REAL BROWSER (12 Oct).
 *
 * The firm, on HTH/4004: settled for R5 000, still open, the page saying R7 980 to settle today.
 *
 * WHAT THIS HOLDS:
 *   1. Ready to close lists what accounts_ready_to_close returns, in the firm's words.
 *   2. Closing a settled one sends close_as_settled for its settlement; a paid-up one sends
 *      settle_account as paid up.
 *   3. A settled account's first tile says Settled, nil, and what the client waived -- not a
 *      figure to settle.
 *
 * Run: node scripts/qa/e2e/ready-to-close.mjs
 */
import { OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { COMPANY, PROFILE, accountsPage } from './fixtures.mjs'

const t = makeRunner('ready-to-close')
const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator' }

const READY = [
  { account_id: 'acc-4004', account_number: 'HTH/4004', case_number: 'RAP-124313', debtor: 'Dawie Joubert',
    company_id: COMPANY.id, client: 'Highveld Tool Hire CC', kind: 'settled', settlement_id: 'set-4004',
    settlement_amount: 5000, paid_toward: 5000, capital_outstanding: 7255.24, last_paid_on: '2026-08-05' },
  /* A CANDIDATE, decided in the browser on the whole balance: R1 000 handed over, R1 000 paid, so
     the receipt fee (R115) is all that is left -- more than R50, still being collected. */
  { account_id: 'acc-4003', account_number: 'HTH/4003', case_number: 'RAP-124312', debtor: 'Lerato Dlamini',
    company_id: COMPANY.id, client: 'Highveld Tool Hire CC', kind: 'residue', settlement_id: null,
    settlement_amount: null, paid_toward: null, capital_outstanding: 0, last_paid_on: '2026-06-30' },
  /* R1 000 handed over and R1 000 + R70 paid: about R45 left (a few cents of interest on top) -- a small balance. */
  { account_id: 'acc-4005', account_number: 'HTH/4005', case_number: 'RAP-124314', debtor: 'Pieter Nel',
    company_id: COMPANY.id, client: 'Highveld Tool Hire CC', kind: 'residue', settlement_id: null,
    settlement_amount: null, paid_toward: null, capital_outstanding: 0, last_paid_on: '2026-07-30' },
]
const acct = (id, n) => ({ ...accountsPage(1)[0], id, account_number: n, status: 'Active', capital_handed_over: 1000,
  capital_outstanding: 0, handover_date: '2026-03-18', ended_as: null, ended_on: null, interest_rate: 0 })
const pay = (id, account_id, amount, on) => ({ id, account_id, received_at: `${on}T08:00:00Z`, amount, paid_to_client: false,
  approved_at: `${on}T09:00:00Z`, reversed_at: null, rejected_at: null, is_demo: false })
/* Receipt fees are written by the engine as item 9 rows; the fixture carries them as rows too. */
const fee = (account_id, payment_id, excl, on) => ({ id: `f-${payment_id}`, account_id, incurred_at: `${on}T09:00:00Z`,
  description: 'Receipt of instalment', amount_excl_vat: excl, vat_amount: Math.round(excl * 15) / 100, billed: true,
  annexure_item: '9', payment_id, cancelled_at: null })

const calls = []
const record = (u, req) => { calls.push({ fn: /\/rpc\/(\w+)/.exec(u)[1], ...(req.postDataJSON() ?? {}) }); return { body: null } }

async function go(page, path) {
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}${path}`, { timeout: 2000 }); return }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
}

const server = await startServer()
const browser = await chromium.launch()
try {
  /* ----------------------------------------------------------------------------- the list */
  {
    const handlers = [
      [(u) => u.includes('/rest/v1/profiles'), () => ({ body: [ADMIN] })],
      [(u) => u.includes('/rest/v1/companies'), () => ({ body: [COMPANY] })],
      [(u) => /\/rpc\/accounts_ready_to_close\b/.test(u), () => ({ body: READY })],
      [(u) => /\/rest\/v1\/debtor_accounts\?/.test(u), () => ({ body: [acct('acc-4003', 'HTH/4003'), acct('acc-4005', 'HTH/4005')] })],
      [(u) => /\/rest\/v1\/account_payments\?/.test(u), () => ({ body: [
        pay('p3', 'acc-4003', 1000, '2026-06-30'), pay('p5a', 'acc-4005', 1000, '2026-06-30'), pay('p5b', 'acc-4005', 70, '2026-07-30')] })],
      [(u) => /\/rest\/v1\/account_fees\?/.test(u), () => ({ body: [
        fee('acc-4003', 'p3', 100, '2026-06-30'), fee('acc-4005', 'p5a', 100, '2026-06-30'), fee('acc-4005', 'p5b', 0, '2026-07-30')] })],
      [(u) => /\/rpc\/(close_as_settled|settle_account)\b/.test(u), record],
    ]
    const { context, page } = await signedInPage(browser, ADMIN, handlers, [])
    await go(page, '/accounts/ready-to-close')
    await page.getByTestId('ready-row').first().waitFor({ timeout: 20000 })
      .catch(async (e) => { await page.screenshot({ path: `${OUT}/ready-to-close-fail.png`, fullPage: true }); throw e })
    t.check('the settled one and the small balance are listed; R115 of fees left is not', await page.getByTestId('ready-row').count(), 2)
    const first = (await page.getByTestId('ready-row').first().innerText()).replace(/\s/g, ' ')
    t.ok('the settled one says so, with what was paid', /HTH\/4004.*Settled · R ?5 ?000\.00 paid/.test(first))
    const second = (await page.getByTestId('ready-row').nth(1).innerText()).replace(/\s/g, ' ')
    t.ok('the small balance closes as settled, the figure said', /HTH\/4005.*Settled · R ?45\.\d\d small balance waived/.test(second))
    t.ok('nil capital with fees still owing is not offered', !/HTH\/4003/.test(await page.getByTestId('ready-to-close').innerText()))
    await page.screenshot({ path: `${OUT}/ready-to-close.png`, fullPage: true })

    await page.getByTestId('ready-close-one').first().click()
    await page.getByTestId('close-ready-box').waitFor({ timeout: 5000 })
    t.ok('the box says the rest is waived by the client', /waived by the client/.test(await page.getByTestId('close-ready-box').innerText()))
    await page.getByTestId('close-ready-go').click()
    await page.waitForTimeout(500)
    t.ok('closing the settled one sends close_as_settled for its settlement',
      calls.some((c) => c.fn === 'close_as_settled' && c.p_id === 'set-4004'))

    await page.getByTestId('ready-close-one').nth(1).click()
    await page.getByTestId('close-ready-box').waitFor({ timeout: 5000 })
    t.ok('the small balance box says it is waived', /small balance is waived/.test(await page.getByTestId('close-ready-box').innerText()))
    await page.getByTestId('close-ready-go').click()
    await page.waitForTimeout(500)
    t.ok('...and closes through settle_account as SETTLED, with the figure in the reason',
      calls.some((c) => c.fn === 'settle_account' && c.p_account === 'acc-4005' && c.p_as === 'settled' && /R45\.\d\d/.test(c.p_reason)))
    await context.close()
  }

  /* ------------------------------------------------------------------ a settled account's tile */
  {
    const ACCOUNT = { ...accountsPage(1)[0], account_number: 'HTH/4004', case_number: 'RAP-124313', status: 'Active',
      capital_handed_over: 12000, capital_outstanding: 7255.24, handover_date: '2026-03-18',
      ended_as: 'settled', ended_on: '2026-08-10', interest_rate: 0 }
    const handlers = [
      [(u) => u.includes('/rest/v1/profiles'), () => ({ body: [ADMIN] })],
      [(u) => u.includes('/rest/v1/companies'), () => ({ body: [COMPANY] })],
      [(u) => u.includes('/rest/v1/debtor_accounts'), () => ({ body: [ACCOUNT] })],
      [(u) => /\/rest\/v1\/account_payments\?/.test(u), () => ({ body: [
        { id: 'p1', account_id: ACCOUNT.id, received_at: '2026-07-07T22:00:00Z', amount: 2000, paid_to_client: false,
          approved_at: '2026-07-10T08:00:00Z', reversed_at: null, rejected_at: null, is_demo: false },
        { id: 'p2', account_id: ACCOUNT.id, received_at: '2026-08-04T22:00:00Z', amount: 5000, paid_to_client: false,
          approved_at: '2026-08-10T08:00:00Z', reversed_at: null, rejected_at: null, is_demo: false },
      ] })],
    ]
    const { context, page } = await signedInPage(browser, ADMIN, handlers, [])
    await go(page, `/accounts/${ACCOUNT.id}`)
    const tile = page.getByText('Settled', { exact: true }).first()
    await tile.waitFor({ timeout: 20000 })
      .catch(async (e) => { await page.screenshot({ path: `${OUT}/ready-to-close-tile-fail.png`, fullPage: true }); throw e })
    const body = (await page.locator('body').innerText()).replace(/\s/g, ' ')
    t.ok('a settled account does not quote a figure to settle', !/To settle today/i.test(body))
    t.ok('...it says what the client waived', /waived by the client/.test(body))
    t.ok('...and the pill says settled', /Settled · 10 Aug/.test(body))
    await page.screenshot({ path: `${OUT}/ready-to-close-settled-account.png`, fullPage: true })
    await context.close()
  }
} finally {
  await browser.close()
  await stopServer(server)
}
const good = t.finish(
  `Ready to close (12 Oct): the list shows a settlement paid in full and a small balance under R50 on the
whole balance (fees left behind a nil capital are not offered), closes the first through close_as_settled
and the second as settled, and a settled account's
own page says Settled with what the client waived instead of a figure to settle.`)
process.exit(good ? 0 : 1)

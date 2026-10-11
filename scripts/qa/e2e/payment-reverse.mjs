/**
 * FINDING A PAYMENT AND REVERSING IT, FROM EVERY PLACE IT IS FOUND (prompt 11), IN A REAL BROWSER.
 *
 * THE FIRM, 11 Oct, during the staging-clock simulation: a wrongly allocated R3 500.00 on KLR/1005,
 * 15 Jun, and no way to find it -- History had no search, the account number they knew was off the
 * right edge, Reverse was four steps deep and in neither of the two places they looked first.
 *
 * WHAT THIS HOLDS:
 *   1. History's search finds it by the client's account number, by the amount however it is typed,
 *      and by the client's own reference; clearing it puts the folders back.
 *   2. The Account column shows KLR/1005 with our RAP- reference under it.
 *   3. Reverse is on the row, opens the one box, and reverse_payment is called for that payment --
 *      with the "already paid over" note because its run has gone out.
 *   4. The opened payment unfolds under its own row, in a panel no wider than what can be seen.
 *   5. The account's Transactions tab and the payover run's line open the same box and make the
 *      same call.
 *
 * Run: node scripts/qa/e2e/payment-reverse.mjs
 */
import { OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { COMPANY, PROFILE, accountsPage } from './fixtures.mjs'

const t = makeRunner('payment-reverse')
const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator' }

const ACCOUNT = { ...accountsPage(1)[0], account_number: 'KLR/1005', case_number: 'RAP-124296', status: 'Active: Activated' }
const PAY_ID = 'pay-klr-1005'

/* The posted payment as payments_posted returns it -- only the columns the screen reads matter. */
const posted = (over) => ({
  payment_id: PAY_ID, allocation_id: 'alloc-k', account_id: ACCOUNT.id,
  case_number: 'RAP-124296', account_number: 'KLR/1005', debtor: 'Thandi Mokoena', client: 'Karoo Linen Rentals',
  received_on: '2026-06-15', approved_on: '2026-06-16', approved_by_name: 'Stephan',
  amount: 3500, paid_to_client: false, method: 'EFT', reference: 'KLR1005',
  bank_description: 'FNB APP PAYMENT FROM KLR1005', source: 'bank_import',
  status: 'allocated', engine_version: 'v1-5050', computed_at: '2026-06-16T08:00:00Z',
  run_invoice: 'PO-KLR-2606', run_status: 'sent', run_paid_on: null, reversed_on: null, reversal_reason: null,
  receipt_fee_excl: 350, receipt_fee_vat: 52.5, to_interest: 0, to_receipt_fees: 0, to_fees: 0, to_costs: 1750,
  to_capital: 1750, excess: 0, commission: 350, commission_vat: 52.5, to_client: 1347.5, due_to_bf: 0,
  capital_before: 10000, capital_after: 8250,
  ...over,
})
const POSTED = [
  posted({}),
  posted({ payment_id: 'pay-s', allocation_id: 'alloc-s', account_id: 'acct-s', case_number: 'RAP-124301',
    account_number: 'SBB/2001', debtor: 'Pieter Visser', client: 'Seabreeze Body Corporate', amount: 1200,
    received_on: '2026-06-20', reference: 'SBB2001', bank_description: 'ACB CREDIT SBB2001' }),
  posted({ payment_id: 'pay-h', allocation_id: 'alloc-h', account_id: 'acct-h', case_number: 'RAP-124310',
    account_number: 'HTH/4001', debtor: 'Ndlovu Plant Hire', client: 'Highveld Tool Hire', amount: 350,
    received_on: '2026-05-20', reference: 'HTH4001', bank_description: 'ACB CREDIT HTH4001' }),
]

const calls = []
const record = (u, req) => { calls.push({ fn: /\/rpc\/(\w+)/.exec(u)[1], ...(req.postDataJSON() ?? {}) }); return { body: 'copy-1' } }

/* What the Reverse box reads about the payment, by id, whichever screen opened it. */
const targetHandlers = [
  [(u) => /\/rest\/v1\/account_payments\?(.*&)?id=eq\./.test(u), () => ({ body: {
    id: PAY_ID, account_id: ACCOUNT.id, amount: 3500, received_at: '2026-06-15T00:00:00+02:00', paid_to_client: false,
    bank_line_id: 'line-1', paid_over_in_swordfish: false, approved_at: '2026-06-16T08:00:00Z', reversed_at: null } })],
  [(u) => /\/rest\/v1\/account_payments\?.*account_id=eq\./.test(u), () => ({ body: [{
    id: PAY_ID, received_at: '2026-06-15T00:00:00+02:00', amount: 3500, paid_to_client: false, reference: 'KLR1005',
    approved_at: '2026-06-16T08:00:00Z', reversed_at: null, reversal_reason: null, paid_over_in_swordfish: false,
    rejected_at: null, is_demo: false }] })],
  [(u) => /\/rest\/v1\/payment_allocations\?/.test(u), () => ({ body: [{ payover_run_id: 'run-k' }] })],
  [(u) => /\/rest\/v1\/bank_statement_lines\?/.test(u), () => ({ body: [] })],
  [(u) => /\/rpc\/(reverse_payment|reverse_payment_to_unplaced|reverse_payment_switching_side)\b/.test(u), record],
]

async function reverseFromBox(page, why) {
  const box = page.getByTestId('reverse-modal')
  await box.waitFor({ timeout: 10000 })
  const invoiced = await page.getByTestId('reverse-invoiced').innerText().catch(() => '')
  await page.getByLabel('Why').fill(why)
  await page.getByRole('button', { name: 'Reverse it' }).click()
  await page.waitForTimeout(500)
  return invoiced
}

const server = await startServer()
const browser = await chromium.launch()
try {
  /* ------------------------------------------------------------------ History: search and reverse */
  {
    const handlers = [
      [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
      [(u) => /\/rest\/v1\/debtor_accounts\?.*client_reference/.test(u), () => ({ body: [{ id: ACCOUNT.id, client_reference: 'KLR-CUST-1005' }] })],
      [(u) => /\/rest\/v1\/payover_runs\?(.*&)?id=eq\./.test(u), () => ({ body: { invoice_number: 'PO-KLR-2606', status: 'sent' } })],
      ...targetHandlers,
      [(u) => /\/rpc\/payments_posted/.test(u), () => ({ body: POSTED })],
      [(u) => /\/rest\/v1\//.test(u), () => ({ body: [] })],
      [(u) => /\/rpc\//.test(u), () => ({ body: [] })],
    ]
    const { context, page } = await signedInPage(browser, ADMIN, handlers, [])
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto(`http://127.0.0.1:${PORT}/trust/payments?tab=history`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('history-client').first().waitFor({ timeout: 15000 })
    const rows = page.getByTestId('history-payment')
    t.check('three clients, folders closed', JSON.stringify([await page.getByTestId('history-client').count(), await rows.count()]), '[3,0]')

    const search = page.getByTestId('history-search')
    await search.fill('KLR/1005')
    t.check('"KLR/1005" finds the one payment, across every month and client', await rows.count(), 1)
    const acct = await rows.first().getByTestId('history-account').innerText()
    /* "not checked" follows on the old-engine fixture; the order of the two numbers is the point. */
    t.ok('...showing the client’s account number with our reference under it',
      acct.indexOf('KLR/1005') === 0 && acct.indexOf('RAP-124296') > acct.indexOf('KLR/1005'))
    for (const q of ['3500', 'R3 500.00', 'klr / 1005', 'KLR-CUST-1005', 'Mokoena']) {
      await search.fill(q)
      t.check(`"${q}" finds it`, await rows.count(), 1)
    }
    await search.fill('350')
    t.ok('"350" is the R350 payment, not every amount containing 350',
      (await rows.count()) === 1 && /HTH\/4001/.test(await rows.first().innerText()))
    await page.getByRole('button', { name: 'Clear the search' }).click()
    t.check('clearing it puts the folders back', JSON.stringify([await page.getByTestId('history-client').count(), await rows.count()]), '[3,0]')

    /* OPENED UNDER ITS OWN ROW, held to the visible width. */
    await search.fill('KLR/1005')
    await rows.first().click()
    await page.locator('[data-check-panel]').waitFor({ timeout: 5000 })
    t.check('the opened payment unfolds directly under its row',
      await page.locator('tr[data-testid="history-payment"] + tr [data-check-panel]').count(), 1)
    const fit = await page.evaluate(() => {
      const panel = document.querySelector('[data-check-panel]')
      const scroller = panel?.closest('.overflow-x-auto')
      if (!panel || !scroller) return null
      return Math.round(panel.getBoundingClientRect().width) <= scroller.clientWidth + 1
    })
    t.ok('...in a panel no wider than the visible table', fit === true)
    await page.screenshot({ path: `${OUT}/payment-reverse-history.png`, fullPage: true })
    await rows.first().click()
    t.check('tapping it again closes it', await page.locator('[data-check-panel]').count(), 0)

    await rows.first().getByTestId('history-reverse').click()
    const note = await reverseFromBox(page, 'Allocated to the wrong debtor')
    t.ok('Reverse on the row opens the box, which says the run has gone out', /PO-KLR-2606/.test(note) && /next payover/.test(note))
    t.check('...and reverses that payment', JSON.stringify(calls.filter((c) => c.fn === 'reverse_payment').map((c) => [c.p_payment, c.p_reason])),
      JSON.stringify([[PAY_ID, 'Allocated to the wrong debtor']]))
    await context.close()
  }

  /* ------------------------------------------------------------------ the account's own payments */
  {
    const handlers = [
      [(u) => u.includes('/rest/v1/profiles'), () => ({ body: [ADMIN] })],
      [(u) => u.includes('/rest/v1/companies'), () => ({ body: [COMPANY] })],
      [(u) => u.includes('/rest/v1/debtor_accounts'), () => ({ body: [ACCOUNT] })],
      [(u) => /\/rest\/v1\/payover_runs\?(.*&)?id=eq\./.test(u), () => ({ body: { invoice_number: 'PO-KLR-2606', status: 'sent' } })],
      ...targetHandlers,
    ]
    const { context, page } = await signedInPage(browser, ADMIN, handlers, [])
    for (let i = 0; i < 60; i += 1) {
      try { await page.goto(`http://localhost:${PORT}/accounts/${ACCOUNT.id}`, { timeout: 2000 }); break }
      catch { await new Promise((r) => setTimeout(r, 500)) }
    }
    await page.getByRole('button', { name: /^Transactions/ }).first().click({ timeout: 20000 })
      .catch(async (e) => { await page.screenshot({ path: `${OUT}/payment-reverse-account-fail.png`, fullPage: true }); throw e })
    await page.getByTestId('account-payments').waitFor({ timeout: 10000 })
    t.ok('the account lists its payments on Transactions', /R\s*3 ?500\.00|3 500\.00/.test(await page.getByTestId('account-payment').first().innerText()))
    await page.getByTestId('account-payment-reverse').first().click()
    await reverseFromBox(page, 'Not this debtor’s payment')
    t.ok('...and Reverse there makes the same call', calls.some((c) => c.fn === 'reverse_payment' && c.p_reason === 'Not this debtor’s payment' && c.p_payment === PAY_ID))
    await page.screenshot({ path: `${OUT}/payment-reverse-account.png`, fullPage: true })
    await context.close()
  }

  /* ------------------------------------------------------------------ the payover run's line */
  {
    const RUN = {
      id: 'run-k', invoice_number: 'PO-KLR-2606', status: 'sent', period_start: '2026-05-11', period_end: '2026-06-10',
      trust_capital: 1750, trust_commission: 350, due_to_client: 1400, ptc_received: 0, ptc_fees_taken: 0,
      ptc_capital: 0, ptc_commission: 0, due_to_bf: 0, commission_vat: 52.5, carried_in: 0, charges_set_off: 0,
      excess_released: 0, net_payover: 1347.5, approved_at: '2026-07-11T08:00:00Z', sent_at: '2026-07-11T09:00:00Z',
      paid_at: null, eft_reference: null, company_id: 'c-klr',
      companies: { name: 'Karoo Linen Rentals', code: 'KLR', commission_rate: 0.2, vat_number: null, email: 'accounts@example.com' },
    }
    const LINE = { line_id: 'l-1', allocation_id: 'alloc-k', payment_id: PAY_ID, account_id: ACCOUNT.id, case_number: 'RAP-124296',
      client_reference: 'KLR-CUST-1005', debtor: 'Thandi Mokoena', line_kind: 'trust', paid_to_client: false,
      received_at: '2026-06-15', payment_amount: 3500, to_capital: 1750, commission: 350, commission_vat: 52.5, capital_after: 8250 }
    const handlers = [
      [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
      [(u) => /\/rest\/v1\/payover_runs\?/.test(u), () => ({ body: RUN })],
      [(u) => /\/rest\/v1\/firm_settings\?/.test(u), () => ({ body: { firm_name: 'Bredell Ferreira', payover_lag_months: 1, payouts_statement_only: false } })],
      [(u) => /\/rpc\/payover_run_payments/.test(u), () => ({ body: [LINE] })],
      ...targetHandlers,
      [(u) => /\/rest\/v1\//.test(u), () => ({ body: [] })],
      [(u) => /\/rpc\//.test(u), () => ({ body: [] })],
    ]
    const { context, page } = await signedInPage(browser, ADMIN, handlers, [])
    await page.goto(`http://127.0.0.1:${PORT}/trust/runs/run-k`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('run-line-reverse').first().click({ timeout: 15000 })
    const note = await reverseFromBox(page, 'Wrong debtor, found on the run')
    t.ok('the run’s line opens the same box, saying the run is not changed', /is not changed/.test(note))
    t.ok('...and makes the same call', calls.some((c) => c.fn === 'reverse_payment' && c.p_reason === 'Wrong debtor, found on the run' && c.p_payment === PAY_ID))
    t.check('...and nothing writes to the run itself', calls.filter((c) => /payover_run/.test(c.fn)).length, 0)
    await context.close()
  }
} finally {
  await browser.close()
  stopServer(server)
}

const good = t.finish(
  `Finding a payment and reversing it (prompt 11): History's search finds KLR/1005's R3 500.00 by the
account number, the amount, the client's reference and the debtor; the row shows the client's number
with ours under it; the opened payment unfolds under its own row within the visible width; and Reverse
from History, from the account and from the payover run opens the same box and makes the same call.`)
process.exit(good ? 0 : 1)

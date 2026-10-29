/**
 * WITHDRAWING AN ACCOUNT THAT HAS PAYMENTS ON IT, IN A REAL BROWSER (prompt 11).
 *
 * The firm, 12 Oct: "when an account should be withdrawn and has already a payment on it ... it
 * should ask what to do with the payment. Be refunded to the debtor or keep it on the account ...
 * but by default, keep it on the account. Like majority of accounts that are withdrawn with
 * payments on it."
 *
 * WHAT THIS HOLDS:
 *   1. Withdrawing an account with one paid-over receipt shows that receipt and the run it went on.
 *   2. "Keep them on the account" is chosen before anybody touches anything, and closing then calls
 *      withdraw_account -- nothing about the money moves.
 *   3. "Refund them to the debtor" shows the effect BEFORE the press: the refund, and what the
 *      client owes back on its next payover because the run has already paid it over.
 *   4. Closing then calls withdraw_account_refunding with that receipt and who the refund is paid to.
 *
 * Asserted on what was sent: every request is answered from a fixture.
 *
 * Run: node scripts/qa/e2e/withdraw-payments.mjs
 */
import { OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { COMPANY, PROFILE, accountsPage } from './fixtures.mjs'

const t = makeRunner('withdraw-payments')
const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator' }
const ACCOUNT = { ...accountsPage(1)[0], account_number: 'KLR/1006', case_number: 'RAP-124297', status: 'Active: Activated',
  capital_outstanding: 5300, ended_as: null }
const PAY_ID = 'pay-klr-1006'

const calls = []
const record = (u, req) => { calls.push({ fn: /\/rpc\/(\w+)/.exec(u)[1], ...(req.postDataJSON() ?? {}) }); return { body: 'charge-1' } }

const handlers = [
  [(u) => u.includes('/rest/v1/profiles'), () => ({ body: [ADMIN] })],
  [(u) => u.includes('/rest/v1/companies'), () => ({ body: [COMPANY] })],
  [(u) => u.includes('/rest/v1/debtor_accounts'), () => ({ body: [ACCOUNT] })],
  /* The receipt on file: approved, standing, a trust receipt, carried by a run that has been paid. */
  [(u) => /\/rest\/v1\/account_payments\?.*account_id=eq\./.test(u), () => ({ body: [{
    id: PAY_ID, received_at: '2026-07-02T22:00:00Z', amount: 1100, paid_to_client: false, paid_over_in_swordfish: false,
    approved_at: '2026-07-04T08:00:00Z', reversed_at: null, rejected_at: null, is_demo: false,
    reference: 'KLR1006', reversal_reason: null }] })],
  [(u) => /\/rest\/v1\/payment_allocations\?/.test(u), () => ({ body: [{ payment_id: PAY_ID, to_client: 847.5, payover_run_id: 'run-k' }] })],
  [(u) => /\/rest\/v1\/payover_runs\?/.test(u), () => ({ body: [{ id: 'run-k', invoice_number: 'PO-KLR-2607', status: 'paid' }] })],
  [(u) => /\/rpc\/withdrawal_basis\b/.test(u), () => ({ body: [{ fees: 119.03, interest: 459.88, commission: 0, vat_rate: 0.15, capital: 5300, commission_rate: 0.1 }] })],
  [(u) => /\/rpc\/(withdraw_account|withdraw_account_refunding)\b/.test(u), record],
]

async function openWithdraw(page) {
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/accounts/${ACCOUNT.id}`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  await page.getByRole('button', { name: 'Close account' }).first().click({ timeout: 20000 })
    .catch(async (e) => { await page.screenshot({ path: `${OUT}/withdraw-payments-fail.png`, fullPage: true }); throw e })
  await page.getByRole('button', { name: /^Withdrawn/ }).click()
  await page.getByTestId('withdraw-payments').waitFor({ timeout: 10000 })
}

const server = await startServer()
const browser = await chromium.launch()
try {
  /* ------------------------------------------------------------------------- keep, the default */
  {
    calls.length = 0
    const { context, page } = await signedInPage(browser, ADMIN, handlers, [])
    await openWithdraw(page)
    const box = (await page.getByTestId('withdraw-payments').innerText()).replace(/\s/g, ' ')
    t.ok('the box lists the payment already on the account', /1 ?100\.00/.test(box))
    t.ok('...on its Johannesburg day, 3 Jul', /03 Jul|3 Jul/.test(box))
    t.ok('...and says it was paid over on its run', /Paid over on PO-KLR-2607/.test(box))
    t.ok('"Keep them on the account" is chosen by default', await page.getByTestId('withdraw-keep').isChecked())
    t.check('...and no refund effect is shown', await page.getByTestId('withdraw-effect').count(), 0)
    await page.getByLabel('Why').fill('They arrange with debtor')
    await page.getByRole('button', { name: /^Close as withdrawn/ }).click()
    await page.waitForTimeout(500)
    t.ok('closing calls withdraw_account', calls.some((c) => c.fn === 'withdraw_account' && c.p_account === ACCOUNT.id))
    t.check('...and nothing is refunded', calls.filter((c) => c.fn === 'withdraw_account_refunding').length, 0)
    await context.close()
  }

  /* --------------------------------------------------------------------------- refund instead */
  {
    calls.length = 0
    const { context, page } = await signedInPage(browser, ADMIN, handlers, [])
    await openWithdraw(page)
    await page.getByTestId('withdraw-refund').check()
    const effect = (await page.getByTestId('withdraw-effect').innerText()).replace(/\s/g, ' ')
    t.ok('refunding shows the effect before the press', /1 ?100\.00 refunded to the debtor/.test(effect))
    t.ok('...and what the client owes back on its next payover', /owes back R\s?847\.50 on its next payover/.test(effect))
    await page.getByLabel('Why').fill('Wrongful handover')
    await page.screenshot({ path: `${OUT}/withdraw-payments-refund.png`, fullPage: true })
    await page.getByRole('button', { name: /^Close as withdrawn/ }).click()
    await page.waitForTimeout(500)
    const r = calls.find((c) => c.fn === 'withdraw_account_refunding')
    t.ok('closing calls withdraw_account_refunding', !!r)
    t.check('...with that receipt', JSON.stringify(r?.p_refund), JSON.stringify([PAY_ID]))
    t.ok('...paid to the debtor by name', typeof r?.p_payable_to === 'string' && r.p_payable_to.length > 0)
    t.check('...and not the plain withdrawal as well', calls.filter((c) => c.fn === 'withdraw_account').length, 0)
    await context.close()
  }
} finally {
  await browser.close()
  await stopServer(server)
}
const good = t.finish(
  `Withdrawing an account with a payment on it (prompt 11): the box lists the receipt and its run, keeps it
by default and then withdraws with no money moved; choosing refund shows the refund and what the client
owes back before the press, and sends withdraw_account_refunding with that receipt.`)
process.exit(good ? 0 : 1)

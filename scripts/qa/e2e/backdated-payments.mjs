/**
 * TRUST -> BACKDATED PAYMENTS (Raptor H19 / S20; the Claude Doc "Payments found late").
 *
 * The stubs answer with what the database proposed for the doc's worked example (staging probe, 8 Nov): the 1 March
 * payment found late, the 1 April payment already paid over. The screen must:
 *  1. be on the Trust rail and list the payment with its three dates and how many later payments were split first;
 *  2. open the figures: the April payment as paid over, as it should have been, and the CORRECTION line (+R66.95
 *     capital, +R51.55 to the client), and say the client receives R51.55 and the firm keeps R51.55 less;
 *  3. post it only for an Administrator with payment.approve -- Approve calls approve_restatement with the id; with
 *     payment.approve revoked there is no Approve (and no Work it out).
 *
 * Seen failing with the correction row taken out of Figures, and with the mayApprove gate removed.
 *
 * Run: node scripts/qa/e2e/backdated-payments.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('backdated-payments')
const ADMIN = { ...PROFILE, name: 'Camille', role: 'Administrator' }
const ROW = {
  payment_id: 'pay-mar', account_id: 'acc-swx', case_number: 'RAP-200001', debtor: 'Worked Example', client: 'Worked Example Ltd',
  received_on: '2026-03-01', captured_on: '2026-11-08', approved_on: null, amount: 1000, paid_to_client: false,
  captured_by: 'Camille', later_allocated: 1, later_invoiced: 1,
}
const split = (o) => ({ to_interest: 0, to_costs: 0, to_capital: 0, commission: 0, commission_vat: 0, to_client: 0, due_to_bf: 0, excess_credit: 0, ...o })
const FIGURES = {
  lines: [
    { payment_id: 'pay-mar', day: '2026-03-01', amount: 1000, ptc: false, backdated: true, was_split: false, run: null, changed: true,
      old: {}, new: split({ to_interest: 412.46, to_costs: 87.54, to_capital: 500, commission: 100, commission_vat: 15, to_client: 385 }),
      delta: split({ to_interest: 412.46, to_costs: 87.54, to_capital: 500, commission: 100, commission_vat: 15, to_client: 385 }) },
    { payment_id: 'pay-apr', day: '2026-04-01', amount: 1000, ptc: false, backdated: false, was_split: true, run: 'PO-SWX-2604', changed: true,
      old: split({ to_interest: 500, to_capital: 500, commission: 100, commission_vat: 15, to_client: 385 }),
      new: split({ to_interest: 192.84, to_costs: 240.21, to_capital: 566.95, commission: 113.39, commission_vat: 17.01, to_client: 436.55 }),
      delta: split({ to_interest: -307.16, to_costs: 240.21, to_capital: 66.95, commission: 13.39, commission_vat: 2.01, to_client: 51.55 }) },
  ],
  interest_correction: -17.59, recoverable_correction: -17.59, interest_before: 622.89, interest_after: 605.3,
  capital_before: 9500, capital_after: 8933.05, capital_correction: -566.95, client_correction: 51.55, firm_correction: -51.55, client_engine: 51.55, blocked: null,
}
const RESTATEMENT = {
  id: 'rs-1', payment_id: 'pay-mar', account_id: 'acc-swx', status: 'proposed', blocked_reason: null, figures: FIGURES,
  interest_correction: -17.59, capital_correction: -566.95, client_correction: 51.55, firm_correction: -51.55,
  proposed_at: '2026-11-08T09:00:00Z', proposed_by_name: 'Camille', posted_at: null, posted_by_name: null, cancelled_at: null, cancel_reason: null,
}
const calls = []
const handlers = (who) => [
  [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [who] })],
  [(u) => /\/rpc\/backdated_payments\b/.test(u), () => ({ body: [ROW] })],
  [(u) => /\/rpc\/backdated_payment_restatements\b/.test(u), () => ({ body: [RESTATEMENT] })],
  [(u) => /\/rpc\/(approve_restatement|propose_restatement|cancel_restatement)\b/.test(u), (u, req) => {
    calls.push({ fn: /\/rpc\/(\w+)/.exec(u)[1], ...(req.postDataJSON() ?? {}) }); return { body: null }
  }],
  [(u) => /\/rest\/v1\//.test(u), () => ({ body: [] })],
  [(u) => /\/rpc\//.test(u), () => ({ body: [] })],
]

const server = await startServer()
let browser
try {
  browser = await chromium.launch()
  {
    const { context, page } = await signedInPage(browser, ADMIN, handlers(ADMIN), [])
    for (let i = 0; i < 60; i += 1) {
      try { await page.goto(`http://localhost:${PORT}/trust/backdated`, { timeout: 2000 }); break }
      catch { await new Promise((r) => setTimeout(r, 500)) }
    }
    await page.getByTestId('backdated-row').first().waitFor({ timeout: 20000 })
    /* S21: in Payments in now, for approval; the rail item is gone ("Not a separate tab"). */
    t.check('the Trust rail no longer has a Backdated tab', await page.locator('nav a[href="/trust/backdated"]').count(), 0)
    const row = (await page.getByTestId('backdated-row').first().innerText()).replace(/\s+/g, ' ')
    t.ok(`the row says paid 1 Mar, waiting, and one later payment paid over (${row.slice(0, 140)})`,
      /01 Mar 2026|1 Mar 2026/.test(row) && /Waiting/.test(row) && /1 payment/.test(row) && /1 paid over/.test(row))
    t.ok('...and that the correction waits for approval, +R51.55 to the client', /Waiting for approval/.test(row) && /51\.55/.test(row))
    await page.getByTestId('backdated-open').first().click()
    const corr = (await page.getByTestId('backdated-correction-line').innerText()).replace(/\s+/g, ' ')
    t.ok(`the April payment's correction line: -307.16 interest, +240.21 fees, +66.95 capital, +15.40 commission, +51.55 to the client (${corr})`,
      /-R\s?307\.16/.test(corr) && /\+R\s?240\.21/.test(corr) && /\+R\s?66\.95/.test(corr) && /\+R\s?15\.40/.test(corr) && /\+R\s?51\.55/.test(corr))
    const sum = (await page.getByTestId('backdated-summary').innerText()).replace(/\s+/g, ' ')
    t.ok('...and says who gains and who gives back', /receives R\s?51\.55/.test(sum) && /keeps R\s?51\.55 less/.test(sum) && /622\.89/.test(sum) && /605\.30/.test(sum))
    /* S20 review: exactly what approving posts, the engine's own figure for the client, and who reverses it later. */
    const posts = (await page.getByTestId('backdated-what-posts').innerText()).replace(/\s+/g, ' ')
    t.ok(`what approving posts: a R0.00 correction receipt for April, +51.55 to the client, the engine agreeing (${posts.slice(0, 200)})`,
      /correction receipt of R0\.00/.test(posts) && /to the client \+R\s?51\.55/.test(posts) && /engine's figure for the client: \+R\s?51\.55, the same/.test(posts))
    t.ok('...and that the payment found late is finance\'s to reverse once posted', /reversed only by finance, by hand/.test(posts))
    await page.getByTestId('backdated-approve').click()
    await page.waitForTimeout(500)
    t.ok('Approve and post asks the database to post THIS correction', calls.some((c) => c.fn === 'approve_restatement' && c.p_id === 'rs-1'))
    await context.close()
  }
  {
    const NO = { ...ADMIN, revokes: ['payment.approve'] }
    const { context, page } = await signedInPage(browser, NO, handlers(NO), [])
    await page.goto(`http://localhost:${PORT}/trust/backdated`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('backdated-row').first().waitFor({ timeout: 20000 })
    t.check('without payment.approve there is no Approve', await page.getByTestId('backdated-approve').count(), 0)
    t.check('...nor Cancel', await page.getByTestId('backdated-cancel').count(), 0)
    await context.close()
  }
} catch (e) {
  t.ok(`the run finished without throwing (${e instanceof Error ? e.message.split('\n')[0] : String(e)})`, false)
} finally {
  await browser?.close()
  stopServer(server)
}
process.exit(t.finish() ? 0 : 1)

/**
 * PAYMENTS IN, REDESIGNED, IN A REAL BROWSER -- at an iPad's width, because that is where the firm
 * reads it.
 *
 * check-payments-queue holds the arithmetic and the source. What only a browser can say:
 *
 *   - the four tiles are drawn, and the old list of every payment is not;
 *   - the PTC row shows the figure the ledger books (R3 271.50) and not the engine's raw one
 *     (R2 946.64), with the client's R4 728.50 named as already held;
 *   - the debtor STAYS PUT when the figures scroll sideways, and its cell is opaque -- a sticky
 *     cell with a translucent background is two payments printed over each other;
 *   - a row is a line, not a card;
 *   - tapping the debtor opens the breakdown, and it closes to the cent;
 *   - "Approve all" asks first, sends every id in the queue, and a partial failure is reported;
 *   - and Reverse, which left with the list, is on Check.
 *
 * The three payments are the firm's own worked examples: Nandi Zulu's R8 000 into trust and again
 * as a PTC, and Lowveld's R2 000 that paid the capital off.
 *
 * Run: node scripts/qa/e2e/payments-in.mjs
 */
import { OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('payments-in')
const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator', team_id: null }

const ROW = (o) => ({
  method: 'EFT', details: null, source: 'bank_import', bank_line_id: null, bank_description: null,
  came_back_from: null, came_back_reason: null, came_back_on: null,
  interest_open: 0, interest_open_from: null, interest_cant: 0, interest_retained: 0,
  rf_cant: 0, rf_retained: 0, fees_cant: 0, fees_retained: 0, has_rate: true, vat_rate: 0.15,
  ...o,
})
const NANDI = ROW({
  payment_id: 'nandi', account_id: 'acct-n', case_number: 'RAP-200001', account_number: 'SF0001',
  debtor: 'Nandi Zulu', client: 'Summit Fitness', received_on: '2026-10-05', amount: 8000,
  paid_to_client: false, reference: 'SF0001',
  receipt_fee: 610, receipt_fee_vat: 91.5,
  to_interest: 50.66, to_costs: 730.25, to_receipt_fees: 701.5, to_fees: 28.75,
  to_capital: 7219.09, excess: 0, commission: 2165.73, commission_vat: 324.86,
  to_client: 4728.5, due_to_bf: 0, capital_before: 78500, capital_after: 71280.91,
  interest_to_date: 50.66, interest_after: 0, interest_total: 50.66,
  rf_total: 701.5, fees_total: 28.75, costs_before: 28.75, costs_after: 0, commission_rate: 0.3,
})
/* THE SAME PAYMENT, PAID TO THE CLIENT. due_to_bf is the engine's, without the VAT. */
const NANDI_PTC = { ...NANDI, payment_id: 'nandi-ptc', account_id: 'acct-np', case_number: 'RAP-200002',
  paid_to_client: true, to_client: 0, due_to_bf: 2946.64 }
const LOWVELD = ROW({
  payment_id: 'lowveld', account_id: 'acct-l', case_number: 'RAP-200003', account_number: 'LV0001',
  debtor: 'Thabo Mokoena', client: 'Lowveld', received_on: '2026-10-05', amount: 2000,
  paid_to_client: false, reference: 'LV0001',
  receipt_fee: 200, receipt_fee_vat: 30,
  to_interest: 0.83, to_costs: 258.75, to_receipt_fees: 230, to_fees: 28.75,
  to_capital: 1250, excess: 490.42, commission: 250, commission_vat: 37.5,
  to_client: 962.5, due_to_bf: 0, capital_before: 1250, capital_after: 0,
  interest_to_date: 0.83, interest_after: 0, interest_total: 0.83,
  rf_total: 230, fees_total: 28.75, costs_before: 28.75, costs_after: 0, commission_rate: 0.2,
})

/* FIGURES THAT DO NOT ADD UP: capital R1 250 less R1 250 taken is not R100 left. */
const BROKEN = { ...LOWVELD, payment_id: 'broken', account_id: 'acct-b', case_number: 'RAP-200009',
  debtor: 'Sipho Broken', capital_after: 100 }
let queue = [NANDI, NANDI_PTC, LOWVELD]

const POSTED = {
  payment_id: 'pay-7', allocation_id: 'alloc-7', account_id: 'acct-7',
  case_number: 'RAP-123856', account_number: 'RRC00007', debtor: 'Lebo Swakamisa', client: 'Rinda Roo Company',
  received_on: '2026-10-05', approved_on: '2026-10-05', approved_by_name: 'Stephan',
  amount: 2500, paid_to_client: false, method: 'EFT', reference: 'RRC00007',
  bank_description: 'FNB APP PAYMENT FROM  RRC00007', source: 'bank_import',
  status: 'allocated', engine_version: 'v2-5050-split', computed_at: '2026-10-05T08:10:00Z',
  run_invoice: 'BF-2026-10-001', run_status: 'paid', run_paid_on: '2026-10-07',
  reversed_on: null, reversal_reason: null,
  receipt_fee_excl: 250, receipt_fee_vat: 37.5,
  to_interest: 15.32, to_receipt_fees: 287.5, to_fees: 554.89, to_costs: 842.39,
  to_capital: 1230.5, excess: 411.79,
  commission: 369.15, commission_vat: 55.37, to_client: 805.98, due_to_bf: 0,
  commission_rate: 0.3, vat_rate: 0.15,
  interest_total: 15.32, interest_cant: 0, interest_retained: 0, interest_before: 15.32, interest_after: 0,
  rf_total: 287.5, rf_cant: 0, rf_retained: 0, fees_total: 554.89, fees_cant: 0, fees_retained: 0,
  costs_before: 554.89, costs_after: 0, capital_before: 1230.5, capital_after: 0,
  fees_raised: 842.39, interest_posted: 15.32, payments_banked: 2500,
}

const sent = []
const handlers = [
  [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
  [(u) => /\/rest\/v1\/firm_settings/.test(u), () => ({ body: [{ firm_name: 'Bredell Ferreira', vat_rate: 0.15 }] })],
  [(u) => /\/rest\/v1\/debtor_accounts/.test(u), () => ({ body: [] })],
  [(u) => /\/rpc\/payments_awaiting_approval/.test(u), () => ({ body: queue })],
  [(u) => /\/rpc\/payments_in_month/.test(u),
    () => ({ body: [{ trust_count: 12, trust_amount: 34500, ptc_count: 2, ptc_amount: 1800 }] })],
  [(u) => /\/rpc\/approve_payments/.test(u), (_u, req) => {
    sent.push({ approve: req.postDataJSON() })
    return { body: [{ approved: 2, skipped: 1, problems: ['RAP-200003: the account is locked'] }] }
  }],
  [(u) => /\/rpc\/payments_posted/.test(u), () => ({ body: [POSTED] })],
  [(u) => /\/rpc\/reverse_payment/.test(u), (_u, req) => { sent.push({ reverse: req.postDataJSON() }); return { body: 'copy-1' } }],
  [(u) => /\/rest\/v1\//.test(u), () => ({ body: [] })],
  [(u) => /\/rpc\//.test(u), () => ({ body: [] })],
]
const money = (s) => s.replace(/[\s ]/g, '')

const server = await startServer()
const browser = await chromium.launch()
try {
  const { context, page } = await signedInPage(browser, ADMIN, handlers, [])
  /* AN IPAD IN LANDSCAPE. */
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto(`http://127.0.0.1:${PORT}/trust/payments`, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('queue-heading').waitFor({ timeout: 20000 })
  const rows = page.getByTestId('queue-row')

  /* ---- the page ---- */
  t.check('the three payments are in the queue', await rows.count(), 3)
  const tiles = await page.getByTestId('payments-overview').innerText()
  t.ok('the four figures: waiting, processed into trust, paid to clients, needs an account',
    /Waiting for approval/.test(tiles) && /Processed into trust/.test(tiles)
    && /Paid to clients · PTC/.test(tiles) && /Needs an account/.test(tiles))
  t.ok('...pending is the queue’s total', money(tiles).includes('R18000.00'))
  t.ok('...and processed is the month the database summed', money(tiles).includes('R34500.00') && /12 payments this month/.test(tiles))
  t.check('the old list of every payment is gone', await page.getByRole('option', { name: 'Every client' }).count(), 0)
  const record = await page.getByRole('button', { name: 'Record payment' }).boundingBox()
  const importer = await page.getByRole('button', { name: 'Import bank statement' }).boundingBox()
  t.ok('Record payment and Import bank statement sit on one line',
    !!record && !!importer && Math.abs(record.y - importer.y) < 4 && importer.x > record.x)
  t.ok('the queue is headed with its count', /Approval queue/.test(await page.getByTestId('queue-heading').innerText())
    && await page.getByText('3 pending').isVisible())

  /* ---- the PTC figure ---- */
  const ptc = page.locator('[data-payment="nandi-ptc"]')
  const ptcText = money(await ptc.innerText())
  t.ok('the PTC row shows R3 271.50 due to BF', ptcText.includes('R3271.50'))
  t.check('...and never the engine’s R2 946.64', ptcText.includes('R2946.64'), false)
  t.ok('...and names the R4 728.50 the client already holds', ptcText.includes('R4728.50heldbyclient'))
  const direct = money(await page.locator('[data-payment="nandi"]').innerText())
  t.ok('Nandi into trust: to client R4 728.50 and BF keeps R3 271.50',
    direct.includes('R4728.50') && direct.includes('R3271.50'))
  const low = money(await page.locator('[data-payment="lowveld"]').innerText())
  t.ok('Lowveld: R962.50, R547.08 and a R490.42 credit', low.includes('R962.50') && low.includes('R547.08') && low.includes('R490.42'))
  t.ok('...badged capital paid off, never settled', /Capital paid off/.test(await page.locator('[data-payment="lowveld"]').innerText())
    && !/\bSettled\b/.test(await page.locator('[data-payment="lowveld"]').innerText()))

  /* ---- the batch ---- */
  const summary = await page.getByTestId('batch-summary').innerText()
  t.ok('the batch is labelled a projection', /Projected on approval/i.test(summary))
  t.ok('...BF share across both routes, with the PTC due inside it', money(summary).includes('R7090.08') && money(summary).includes('IncludesR3271.50'))
  t.check('...and all three reconciliations hold',
    await page.getByTestId('batch-checks').locator('.text-negative-700').count(), 0)
  await page.getByRole('button', { name: 'By client' }).click()
  t.check('...and it breaks down by client', await page.getByTestId('batch-by-client').locator('tbody tr').count(), 2)

  /* ---- the table: a line a payment, the debtor pinned and opaque ---- */
  const h = (await rows.first().boundingBox())?.height ?? 0
  t.ok(`a row is a line, not a card (${Math.round(h)}px)`, h >= 40 && h <= 64)
  const scroller = page.getByTestId('queue-scroll')
  t.ok('the figures scroll sideways at iPad width',
    await scroller.evaluate((el) => el.scrollWidth > el.clientWidth + 100))
  const name = rows.first().locator('td').nth(1)
  const before = (await name.boundingBox())?.x
  await scroller.evaluate((el) => { el.scrollLeft = el.scrollWidth })
  await page.waitForTimeout(150)
  const after = (await name.boundingBox())?.x
  t.ok('the debtor stays put when the figures scroll', before !== undefined && Math.abs(before - after) < 1)
  const bg = await name.evaluate((el) => getComputedStyle(el).backgroundColor)
  const alpha = /rgba\([^)]*,\s*([\d.]+)\)/.exec(bg)?.[1]
  t.ok(`...on an opaque background (${bg})`, bg !== 'transparent' && (alpha === undefined || Number(alpha) === 1))
  await t.shot(page, 'payments-in-scrolled')
  await scroller.evaluate((el) => { el.scrollLeft = 0 })

  /* ---- the breakdown ---- */
  await page.locator('[data-payment="nandi"]').getByRole('button', { name: /Nandi Zulu/ }).click()
  const drawer = page.getByTestId('payment-breakdown')
  await drawer.waitFor({ timeout: 5000 })
  t.ok('tapping the debtor opens the breakdown', await drawer.isVisible())
  t.ok('...which closes to the cent', /the whole payment, to the cent/.test(await page.getByTestId('breakdown-reconciliation').innerText()))
  t.ok('...and says the items 1-7 cap is not reported rather than claiming it was met',
    /does not\s+report per payment what the items 1–7 cap held back/.test(await drawer.innerText()))
  await t.shot(page, 'payments-in-breakdown')
  await page.keyboard.press('Escape')
  t.check('...and Escape closes it', await drawer.count(), 0)

  /* ---- approving ---- */
  await rows.first().locator('input[type=checkbox]').check()
  t.ok('a tick shows what Approve selected would do',
    money(await page.getByRole('button', { name: /^Approve selected/ }).innerText()).includes('1·R8000.00'))
  await rows.first().locator('input[type=checkbox]').uncheck()
  await page.getByRole('button', { name: /^Approve all 3/ }).click()
  t.check('Approve all asks first, and sends nothing yet', sent.length, 0)
  await page.getByText('not only the ones on this page').waitFor({ timeout: 5000 })
  await page.getByRole('dialog').getByRole('button', { name: /^Approve all 3$/ }).click()
    .catch(async () => { await page.getByRole('button', { name: /^Approve all 3$/ }).click() })
  await page.getByTestId('queue-error').waitFor({ timeout: 5000 })
  t.check('...then every id in the queue goes in one call',
    JSON.stringify(sent.find((s) => s.approve)?.approve), JSON.stringify({ p_payments: ['nandi', 'nandi-ptc', 'lowveld'] }))
  t.ok('...and the one that failed is named', /2 approved, 1 could not be: RAP-200003/.test(await page.getByTestId('queue-error').innerText()))
  t.check('...once', sent.filter((s) => s.approve).length, 1)
  await t.shot(page, 'payments-in')

  /* ---- THE CHECK COMES BEFORE THE APPROVAL (the firm, 8 Oct) ---- */
  queue = [NANDI, BROKEN]
  sent.length = 0
  await page.reload({ waitUntil: 'domcontentloaded' })
  await rows.first().waitFor({ timeout: 15000 })
  t.ok('a payment that breaks a formula is held out of Approve all', await page.getByRole('button', { name: /^Approve all 1 / }).isVisible().catch(() => false))
  await page.getByRole('button', { name: /^Approve all 1 / }).click()
  t.ok('...and the confirmation says so', /One payment that does not obey the formulas is left out/.test(await page.getByTestId('held-note').innerText().catch(() => '')))
  await page.getByRole('dialog').getByRole('button', { name: /^Approve all 1$/ }).click()
    .catch(async () => { await page.getByRole('button', { name: /^Approve all 1$/ }).click() })
  await page.waitForTimeout(500)
  t.check('...so the batch sends only the payment that adds up',
    JSON.stringify(sent.find((x) => x.approve)?.approve), JSON.stringify({ p_payments: ['nandi'] }))
  sent.length = 0
  await page.getByText('Sipho Broken').first().click()
  const gate = page.getByTestId('approve-checked')
  await gate.waitFor({ timeout: 5000 }).catch(() => {})
  const one = gate.getByRole('button', { name: 'Approve this payment' })
  t.ok('it is approved on its own, from its breakdown, only once ticked as checked', await one.isDisabled().catch(() => false))
  await gate.getByRole('checkbox').check()
  await one.click()
  await page.waitForTimeout(500)
  t.check('...and then goes through alone', JSON.stringify(sent.find((x) => x.approve)?.approve), JSON.stringify({ p_payments: ['broken'] }))

  /* ---- reverse, on Check ---- */
  await page.goto(`http://127.0.0.1:${PORT}/trust/check`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('table', { timeout: 15000 })
  await page.getByTitle('Open this receipt end to end').first().click()
  const reverse = page.getByRole('button', { name: /^Reverse$/ })
  t.ok('Check offers Reverse on the opened receipt', (await reverse.count()) > 0 && await reverse.isVisible())
  if (await reverse.count()) {
    await reverse.click()
    t.ok('...which says the run it was paid on is not touched', await page.getByText(/already been paid over/).isVisible())
    await page.getByPlaceholder(/Cheque returned/).fill('Cheque returned')
    await page.getByRole('button', { name: /^Reverse it$/ }).click()
    await page.waitForTimeout(400)
    t.check('...and reverses through the function, with the reason',
      JSON.stringify(sent.find((s) => s.reverse)?.reverse), JSON.stringify({ p_payment: 'pay-7', p_reason: 'Cheque returned' }))
  }
  await context.close()
} catch (e) {
  t.ok(`the run finished without throwing (${String(e).split('\n')[0].slice(0, 160)})`, false)
  try {
    const pages = browser.contexts().flatMap((c) => c.pages())
    if (pages[0]) await t.shot(pages[0], 'payments-in-where-it-stopped')
  } catch { /* nothing more to learn */ }
} finally {
  await browser.close()
  stopServer(server)
}

const good = t.finish(`Payments in processes current payments only: tiles, a queue a line per payment with the debtor
pinned and opaque, the PTC due drawn as the ledger books it, a breakdown that closes to the cent, an
Approve all that asks first and names what failed -- and Reverse on Check. Screenshots in ${OUT}.`)
process.exit(good ? 0 : 1)

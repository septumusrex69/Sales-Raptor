/**
 * PAYMENTS IN, THE LINES THE BANK'S OWN WORDS EXPLAIN (S7, the firm, 13 Oct).
 *
 * At CREDIT INTEREST under "Needs an account" and three payments out each reading "No run of this
 * amount", with the Payments out card drawn flush against the one above it: "something on this tab
 * looks weird" and "By default credit interest is interest". This holds that interest is booked as
 * interest in one press, bank charges as charges, a returned debit order opens the account to reverse
 * it on, the cards stand apart, and the latest statement counts lines rather than calling payments
 * out "receipts".
 *
 * Run: node scripts/qa/e2e/payments-in-tidy.mjs
 */
import { OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('payments-in-tidy')
const plain = (x) => x.split(String.fromCharCode(0xa0)).join(' ')
const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator', team_id: null }
const RECEIPTS = [
  { id: 'r-int', txn_date: '2026-08-31', amount: 38.4, description: 'CREDIT INTEREST', reference: null, bank_account: '627', imported_at: '2026-10-13T06:50:39Z', had_reference: false },
  { id: 'r-pn', txn_date: '2026-08-22', amount: 750, description: 'CAPITEC P NAIDOO', reference: null, bank_account: '627', imported_at: '2026-10-13T06:50:39Z', had_reference: false },
]
const OUTS = [
  { id: 'd-fee', txn_date: '2026-09-10', amount: -69, description: '##SERVICE FEE', candidate_run: null, candidate_invoice: null, candidate_client: null },
  { id: 'd-chg', txn_date: '2026-08-31', amount: -57.5, description: '##BANK CHARGE', candidate_run: null, candidate_invoice: null, candidate_client: null },
  { id: 'd-ret', txn_date: '2026-08-20', amount: -1000, description: 'RETURNED DEBIT SBB/2003 ZULU INSUFFICIENT FUNDS', candidate_run: null, candidate_invoice: null, candidate_client: null },
]
const HISTORY = [{ bank_account: '627', bank_account_label: 'Trust', first_txn: '2026-06-01', last_txn: '2026-09-10', lines: 66,
  allocated: 61, unallocated: 5, debits: 20, received: 100000, paid_out: 70000, last_import: '2026-10-13T06:50:39Z' }]
const calls = []
let receipts = RECEIPTS
const handlers = [
  [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
  [(u) => /\/rpc\/unallocated_receipts/.test(u), () => ({ body: receipts })],
  [(u) => /\/rpc\/unreconciled_payouts/.test(u), () => ({ body: OUTS })],
  [(u) => /\/rpc\/bank_import_history/.test(u), () => ({ body: HISTORY })],
  [(u) => /\/rpc\/bounced_receipt_candidates/.test(u), () => ({ body: [
    { payment_id: 'p-sbb', account_id: 'a1', account_number: 'SBB/2003', case_number: 'RAP-124300', debtor: 'T Zulu', received_on: '2026-08-15', amount: 1000, reference: 'SBB/2003', named: true },
    { payment_id: 'p-mpg', account_id: 'a2', account_number: 'MPG/3002', case_number: 'RAP-1', debtor: null, received_on: '2026-07-22', amount: 1000, reference: null, named: false },
  ] })],
  [(u) => /\/rpc\/return_bounced_receipt/.test(u), (_u, req) => { calls.push({ returned: req.postDataJSON() }); return { body: null } }],
  [(u) => /\/rpc\/allocate_bank_line/.test(u), (_u, req) => {
    const b = req.postDataJSON(); calls.push(b)
    if (b.p_line === 'r-int') receipts = RECEIPTS.filter((r) => r.id !== 'r-int')
    return { body: null }
  }],
  [(u) => /\/rest\/v1\//.test(u), () => ({ body: [] })],
  [(u) => /\/rpc\//.test(u), () => ({ body: [] })],
]

const server = await startServer()
const browser = await chromium.launch()
try {
  const { context, page } = await signedInPage(browser, ADMIN, handlers, [])
  await page.goto(`http://127.0.0.1:${PORT}/trust/payments`, { waitUntil: 'domcontentloaded' })
  const interest = page.getByTestId('book-interest')
  await interest.waitFor({ timeout: 20000 })
  t.check('interest is offered as interest, and only on the interest line', await interest.count(), 1)
  t.ok('...while a debtor\'s receipt still offers Place it', await page.getByRole('row', { name: /CAPITEC P NAIDOO/ }).getByRole('button', { name: 'Place it' }).isVisible())
  t.check('both bank charges offer Book as a bank charge', await page.getByTestId('book-charge').count(), 2)
  const ret = page.getByTestId('returned-debit')
  await page.getByTestId('bounced-suggestion').waitFor({ timeout: 10000 })
  t.ok('the returned debit suggests the receipt it took back, by the account it names',
    /Looks like the 15 Aug R 1 000\.00 from SBB\/2003 \(T Zulu\) bounced/.test(plain(await ret.innerText())))
  t.check('...and has not paired it on its own', calls.filter((c) => c.returned).length, 0)
  t.check('nothing says "No run of this amount" any more', await page.getByText('No run of this amount').count(), 0)
  /* The cards stand apart: the bottom of one is above the top of the next. */
  const gap = await page.evaluate(() => {
    const hs = [...document.querySelectorAll('h3')]
    const a = hs.find((h) => h.textContent?.trim() === 'Needs an account')?.closest('.card')
    const b = hs.find((h) => h.textContent?.trim() === 'Payments out to allocate')?.closest('.card')
    return a && b ? Math.round(b.getBoundingClientRect().top - a.getBoundingClientRect().bottom) : -999
  })
  t.ok(`the Payments out card stands apart from the one above it (gap ${gap}px)`, gap >= 8)
  t.ok('the latest statement counts lines, not receipts', /5 lines still to place or allocate/.test(await page.getByTestId('latest-statement').innerText()))
  /* Every action inside its card -- the first cut spilled the buttons past the right edge. */
  const spill = await page.evaluate(() => {
    const card = [...document.querySelectorAll('h3')].find((h) => h.textContent?.trim() === 'Payments out to allocate')?.closest('.card')
    if (!card) return -999
    const right = card.getBoundingClientRect().right
    return Math.max(...[...card.querySelectorAll('button, a')].map((b) => Math.round(b.getBoundingClientRect().right - right)))
  })
  t.ok(`every action sits inside the card (overhang ${spill}px)`, spill <= 0)
  await t.shot(page, 'payments-in-tidy')

  await interest.click()
  await page.waitForTimeout(600)
  t.check('Book as bank interest allocates that line as interest', JSON.stringify(calls.filter((c) => c.p_kind)[0] ?? null),
    JSON.stringify({ p_line: 'r-int', p_kind: 'bank_interest', p_reason: null, p_target: null }))
  t.check('...and it leaves Needs an account', await page.getByTestId('book-interest').count(), 0)
  await page.getByTestId('confirm-returned').click()
  await page.waitForTimeout(600)
  t.check('Confirm returns that receipt against that debit, in one call', JSON.stringify(calls.find((c) => c.returned)?.returned ?? null),
    JSON.stringify({ p_line: 'd-ret', p_payment: 'p-sbb' }))
  await page.getByTestId('book-charge').first().click()
  await page.waitForTimeout(600)
  t.check('Book as a bank charge allocates as a charge', JSON.stringify(calls.filter((c) => c.p_kind)[1] ?? null),
    JSON.stringify({ p_line: 'd-fee', p_kind: 'bank_charge', p_reason: null, p_target: null }))
  await context.close()
} catch (e) {
  try { const pg = browser.contexts().flatMap((c) => c.pages())[0]; if (pg) await t.shot(pg, 'payments-in-tidy-where-it-stopped') } catch { /* */ }
  t.ok(`the run finished without throwing (${e instanceof Error ? e.message.split('\n')[0] : e})`, false)
} finally {
  await browser.close()
  stopServer(server)
}
const good = t.finish(`Interest, bank charges and returned debits each offer what they are.
Screenshots in ${OUT}.`)
process.exit(good ? 0 : 1)

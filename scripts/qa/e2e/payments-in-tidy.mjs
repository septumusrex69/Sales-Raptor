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
  /* S21: a debtor who swapped two digits of the case number on the notice -- DRC0081 for DRC0018. Invented names. */
  { id: 'r-js', txn_date: '2026-08-25', amount: 400, description: 'CAPITEC J SMITH DRC0081', reference: null, bank_account: '627', imported_at: '2026-10-13T06:50:39Z', had_reference: false },
]
/* What near_reference_accounts answers for DRC0081: the debtor named on the line (a larger slip) and his neighbour. */
const NEAR = [
  { token: 'DRC0081', account_id: 'acc-18', case_number: 'DRC0018', account_number: null, debtor: 'John Smith', client: 'Dr C Test', matched_on: 'case number', how: 'two characters swapped', rank: 1 },
  { token: 'DRC0081', account_id: 'acc-80', case_number: 'DRC0080', account_number: null, debtor: 'Lerato Dube', client: 'Dr C Test', matched_on: 'case number', how: 'one digit different', rank: 2 },
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
  [(u) => /\/rpc\/near_reference_accounts/.test(u), (_u, req) => { calls.push({ near: req.postDataJSON() }); return { body: NEAR } }],
  [(u) => /\/rpc\/place_bank_line/.test(u), (_u, req) => { calls.push({ placed: req.postDataJSON() }); receipts = receipts.filter((r) => r.id !== 'r-js'); return { body: 'pay-1' } }],
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
  /*
   * S21 · Raptor H19: suspense moved to To sort, a tile that opens (Stephan: "putting the suspense there by the payments
   * in is not good"). The money OUT that sat under it on Payments in -- bank charges, a returned debit -- is on To sort
   * already, under Statement lines to allocate, which offers both (BankLinesToAllocate: the allocation kinds and
   * "Returned / unpaid receipt"); so it is not drawn a second time beside suspense.
   */
  await page.goto(`http://127.0.0.1:${PORT}/trust/exceptions#suspense`, { waitUntil: 'domcontentloaded' })
  const interest = page.getByTestId('book-interest')
  await interest.waitFor({ timeout: 20000 })
  t.check('interest is offered as interest, and only on the interest line', await interest.count(), 1)
  t.ok('...while a debtor\'s receipt still offers Place it', await page.getByRole('row', { name: /CAPITEC P NAIDOO/ }).getByRole('button', { name: 'Place it' }).isVisible())
  t.check('money out is not listed twice beside suspense', await page.getByRole('heading', { name: 'Payments out to allocate' }).count(), 0)
  t.check('nothing says "No run of this amount" any more', await page.getByText('No run of this amount').count(), 0)
  await t.shot(page, 'to-sort-suspense')

  /* ---- S21: THE ACCOUNT IT PROBABLY MEANT (Stephan: "proceed with the suspense near match. Give options still a search
     option") ---- */
  const jsRow = page.getByRole('row', { name: /CAPITEC J SMITH DRC0081/ })
  await jsRow.getByTestId('near-match').first().waitFor({ timeout: 10000 }).catch(() => {})
  t.ok('the receipt\'s reference words are asked about', calls.some((c) => c.near && (c.near.p_tokens ?? []).includes('DRC0081')))
  const near = await jsRow.getByTestId('near-match').allInnerTexts()
  t.check(`it offers the accounts it probably meant (${near.length})`, near.length, 2)
  t.ok('...the debtor named on the bank line first, though his is the bigger slip', /DRC0018[\s\S]*John Smith[\s\S]*two characters swapped[\s\S]*name on the bank line matches/.test(near[0] ?? ''))
  t.ok('...the neighbour after him, flagged to check', /DRC0080[\s\S]*does not match, so check it/.test(near[1] ?? ''))
  t.ok('...and Place it, the search, is still there', await jsRow.getByRole('button', { name: 'Place it', exact: true }).isVisible())
  await jsRow.getByTestId('near-pick').first().click()
  t.check('choosing one does not place it yet', calls.filter((c) => c.placed).length, 0)
  t.ok('...it asks first', /Place R 400\.00 on DRC0018\?/.test(plain(await jsRow.innerText())))
  await t.shot(page, 'suspense-near-match')
  await jsRow.getByTestId('near-confirm').click()
  await page.waitForTimeout(600)
  t.check('Yes places it on that account, once', JSON.stringify(calls.filter((c) => c.placed).map((c) => c.placed)), JSON.stringify([{ p_line: 'r-js', p_account: 'acc-18' }]))

  await interest.click()
  await page.waitForTimeout(600)
  t.check('Book as bank interest allocates that line as interest', JSON.stringify(calls.filter((c) => c.p_kind)[0] ?? null),
    JSON.stringify({ p_line: 'r-int', p_kind: 'bank_interest', p_reason: null, p_target: null }))
  t.check('...and it leaves suspense', await page.getByTestId('book-interest').count(), 0)
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

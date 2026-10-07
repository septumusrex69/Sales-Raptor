/**
 * TRUST -> EXCEPTIONS: EVERY STATEMENT LINE NOT YET ALLOCATED, IN A REAL BROWSER (prompt 12).
 *
 * check-bank-line-allocation holds the SQL and the suggestion rules. What only a browser sees: that
 * the list is DRAWN on Exceptions, that the test statement's two "##BANK CHARGE" lines open on
 * "Bank charges" already chosen, that Allocate sends exactly that, that "Other" will not go without
 * a reason, and that a debtor's payment is pointed at Payments in rather than allocated here.
 *
 * The lines are the firm's own test statement (test-statement-2026-09-11-to-10-07.csv): two debits
 * of R57.50 described "##BANK CHARGE" -- R115 out -- and two unplaced receipts.
 *
 * Run: node scripts/qa/e2e/bank-line-allocation.mjs
 */
import { OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('bank-line-allocation')
const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator', team_id: null }

const LINE = (id, txn_date, amount, description) => ({
  id, txn_date, amount, description, direction: amount < 0 ? 'debit' : 'credit', reference: null,
  bank_account: '9999999999', bank_account_label: 'Trust Account - TEST', status: 'unallocated',
})
const LINES = [
  LINE('d1', '2026-09-30', -57.5, '##BANK CHARGE'),
  LINE('d2', '2026-10-07', -57.5, '##BANK CHARGE'),
  LINE('c1', '2026-10-07', 300, 'CAPITEC T NGUBANE'),
  LINE('c2', '2026-10-07', 450, 'CAPITEC  SMT199999'),
]

let sent = []
const handlers = [
  [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
  [(u) => /\/rest\/v1\/firm_settings/.test(u), () => ({ body: [{ firm_name: 'Bredell Ferreira', business_account_number: '62700193882' }] })],
  [(u) => /\/rpc\/bank_lines_to_allocate/.test(u), () => ({ body: LINES.filter((l) => !sent.some((s) => s.p_line === l.id)) })],
  [(u) => /\/rpc\/bank_allocation_candidates/.test(u), () => ({ body: [] })],
  [(u) => /\/rpc\/allocate_bank_line/.test(u), (u, req) => { sent.push(req.postDataJSON()); return { body: 'entry' } }],
  [(u) => /\/rest\/v1\//.test(u), () => ({ body: [] })],
  [(u) => /\/rpc\//.test(u), () => ({ body: [] })],
]

const server = await startServer()
const browser = await chromium.launch()
try {
  const { context, page } = await signedInPage(browser, ADMIN, handlers, [])
  await page.goto(`http://127.0.0.1:${PORT}/trust/exceptions`, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('lines-to-allocate-heading').waitFor({ timeout: 20000 })
  const rows = page.getByTestId('line-to-allocate')
  await rows.first().waitFor({ timeout: 20000 })
  t.check('Exceptions lists every unallocated line', await rows.count(), 4)
  t.ok('...and says what is out and in, and that the ledger will not balance until they are done',
    /R[\s,]*115[\s,.]00 out[\s\S]*does not balance/.test(await page.getByText(/lines? —/).first().innerText()))

  /* THE BANK'S OWN WORDS, ALREADY CHOSEN -- and nothing sent until somebody presses. */
  const first = rows.nth(0)
  t.check('a "##BANK CHARGE" line opens on Bank charges', await first.getByLabel('What this line was').inputValue(), 'bank_charge')
  t.ok('...says why', await first.getByText(/Suggested: The bank calls it a charge or a fee\./).isVisible())
  t.check('...and nothing is allocated just by looking', sent.length, 0)
  await t.shot(page, 'bank-lines-to-allocate')

  await first.getByRole('button', { name: 'Allocate' }).click()
  await page.waitForTimeout(400)
  /* AS JSON: this runner compares with Object.is, false for any two objects (HANDOFF section 6). */
  t.check('Allocate sends the line as a bank charge', JSON.stringify(sent[0]),
    JSON.stringify({ p_line: 'd1', p_kind: 'bank_charge', p_reason: null, p_target: null }))
  t.check('...and it leaves the list', await rows.count(), 3)

  /* A DEBTOR'S PAYMENT IS PLACED, NOT ALLOCATED. */
  const receipt = page.getByTestId('line-to-allocate').filter({ hasText: 'CAPITEC T NGUBANE' })
  t.check('a receipt opens on nothing chosen', await receipt.getByLabel('What this line was').inputValue(), '')
  t.ok('...and points at Payments in to place it', await receipt.getByRole('link', { name: /Place it under Payments in/ }).isVisible())
  t.check('...and cannot be called a bank charge', await receipt.locator('option[value="bank_charge"]').count(), 0)

  /* "OTHER" NEEDS A REASON. */
  await receipt.getByLabel('What this line was').selectOption('other')
  t.ok('"Other" will not go without a reason', await receipt.getByRole('button', { name: 'Allocate' }).isDisabled())
  await receipt.getByLabel('Reason').fill('Deposit by the firm in error')
  t.ok('...and will with one', await receipt.getByRole('button', { name: 'Allocate' }).isEnabled())
  await context.close()
} catch (e) {
  t.ok(`the run finished without throwing (${String(e).split('\n')[0].slice(0, 160)})`, false)
  try {
    const pages = browser.contexts().flatMap((c) => c.pages())
    if (pages[0]) await t.shot(pages[0], 'bank-line-allocation-where-it-stopped')
  } catch { /* nothing more to learn */ }
} finally {
  await browser.close()
  stopServer(server)
}

const good = t.finish(`Exceptions lists every statement line not yet allocated, suggests bank charges from the
bank's own words, sends exactly what was confirmed, and sends a debtor's receipt to Payments in. Screenshots in ${OUT}.`)
process.exit(good ? 0 : 1)

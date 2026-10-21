/**
 * TRUST -> PAYMENTS TO MAKE, IN A REAL BROWSER.
 *
 * The firm, 8 Oct: "there should be a place for payments that we have to make", each paid "with a
 * client unique reference" or, for a refund, "the debtor's reference number". check-payments-out
 * holds the SQL and the reference rule; this holds that the page is reachable from the rail, lists
 * both kinds with their references and due dates, totals them, and says when there is nothing.
 *
 * Run: node scripts/qa/e2e/payments-out.mjs
 */
import { OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('payments-out')
const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator', team_id: null }
/* THE BANK FILE (S7): one payable payover, one with no banking details, a refund with none (pending,
   the firm's own example), a payover not yet due, and the firm's recorded transfer. */
const bankOf = (holder) => ({ holder, bank: 'FNB', branch: '250655', account_no: '62000000001' })
const DUE = [
  { kind: 'payover', id: 'run-smt', payee: 'Summit Fitness (Pty) Ltd', amount: 8426.07, reference: 'BF PO-SMT-2610',
    status: 'approved', due_on: '2026-11-11', ...bankOf('Summit Fitness'), company_id: 'c1', account_id: null, case_number: 'PO-SMT-2610' },
  { kind: 'payover', id: 'run-bpm', payee: 'Baobab Property Managers (Pty) Ltd', amount: 9699.53, reference: 'BF PO-BPM-2610',
    status: 'sent', due_on: '2026-11-11', holder: null, bank: null, branch: null, account_no: null, company_id: 'c2', account_id: null, case_number: 'PO-BPM-2610' },
  { kind: 'refund', id: 'ref-1', payee: 'Sizwe Dlamini', amount: 490.42, reference: 'BF RAP-124059',
    status: 'due', due_on: null, holder: null, bank: null, branch: null, account_no: null, company_id: 'c3', account_id: 'acc-1', case_number: 'RAP-124059' },
  { kind: 'payover', id: 'run-klr', payee: 'Karoo Linen Rentals (Pty) Ltd', amount: 4511.22, reference: 'BF PO-KLR-2611',
    status: 'scheduled', due_on: '2026-12-11', ...bankOf('Karoo Linen'), company_id: 'c5', account_id: null, case_number: 'PO-KLR-2611' },
  { kind: 'drawing', id: 'draw-2', payee: 'Bredell Ferreira (business account)', amount: 5000, reference: 'BF FEES-2610',
    status: 'recorded', due_on: '2026-10-12', ...bankOf('Bredell Ferreira (Pty) Ltd'), company_id: null, account_id: null, case_number: null },
]
let answer = DUE
const PAID = [
  { kind: 'payover', id: 'run-lvm', payee: 'Lowveld Motors (Pty) Ltd', amount: 12879.45, reference: 'BF PO-LVM-2610',
    paid_at: '2026-10-08T10:00:00Z', paid_reference: 'BF PO-LVM-2610', confirmed: false, statement_date: null,
    company_id: 'c4', account_id: null, case_number: 'PO-LVM-2610' },
  { kind: 'business_transfer', id: 'draw-1', payee: 'Bredell Ferreira (business account)', amount: 5000,
    reference: 'BF FEES-2609', paid_at: '2026-09-15T10:00:00Z', paid_reference: 'BF FEES-2609', confirmed: true,
    statement_date: '2026-09-16', company_id: null, account_id: null, case_number: null },
]
const POSITION = { trust_cash: 0, creditors: 0, debtors: 0, net_owed: 0, difference: 0, owed_to_clients: 0,
  owed_to_debtors: 0, owed_to_firm: 24055.36, unidentified: 0, owed_by_clients: 0 }
let sent = []
let statementOnly = false
const handlers = [
  [(u) => /\/rest\/v1\/firm_settings\?.*payouts_statement_only/.test(u), () => ({ body: { payouts_statement_only: statementOnly } })],
  [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
  [(u) => /\/rpc\/payments_out_list/.test(u), () => ({ body: answer })],
  [(u) => /\/rpc\/payments_out_paid/.test(u), () => ({ body: PAID })],
  [(u) => /\/rpc\/trust_position/.test(u), () => ({ body: [POSITION] })],
  /* THE FIRM DRAWS ONCE ITS CLIENTS ARE PAID (10 Oct): R3 000 of its share waits on a payover. */
  [(u) => /\/rpc\/firm_trust_split/.test(u), () => ({ body: [{ held: 27055.36, drawable: 24055.36, waiting: 3000 }] })],
  [(u) => /\/rpc\/(mark_payover_run_paid|mark_refund_paid|draw_from_trust|set_payment_banking)/.test(u),
    (u, req) => { sent.push({ fn: /\/rpc\/(\w+)/.exec(u)[1], ...req.postDataJSON() }); return { body: null } }],
  [(u) => /\/rest\/v1\//.test(u), () => ({ body: [] })],
  [(u) => /\/rpc\//.test(u), () => ({ body: [] })],
]

const server = await startServer()
const browser = await chromium.launch()
try {
  const { context, page } = await signedInPage(browser, ADMIN, handlers, [])
  await page.goto(`http://127.0.0.1:${PORT}/trust`, { waitUntil: 'domcontentloaded' })
  const link = page.getByRole('link', { name: 'Payments out' }).first()
  await link.waitFor({ timeout: 20000 })
  t.ok('Payments out is in the Trust menu', await link.isVisible())
  await link.click()
  await page.waitForURL(/\/trust\/payments-out/, { timeout: 10000 })
  const rows = page.getByTestId('payment-to-make')
  await rows.first().waitFor({ timeout: 15000 })
  t.check('every payment waiting to leave trust is listed, the firm\'s transfer included', await rows.count(), 5)
  t.check('the top bar names this screen, not Payments in', await page.getByRole('banner').getByText('Payments out', { exact: true }).count().catch(() => 0) > 0
    || (await page.locator('header').first().innerText().catch(() => '')).includes('Payments out'), true)
  const body = await page.locator('main').innerText().catch(async () => page.locator('body').innerText())
  for (const ref of ['BF PO-SMT-2610', 'BF PO-BPM-2610', 'BF RAP-124059', 'BF FEES-2610']) t.ok(`...with its reference ${ref}`, body.includes(ref))
  /* WHAT CAN BE PAID IS TICKED; WHAT CANNOT IS PENDING AND SAYS WHY (the firm, 13 Oct). */
  const row = (name) => rows.filter({ hasText: name })
  t.ok('a payable payover is ticked', await row('Summit Fitness').getByRole('checkbox').isChecked())
  t.ok('...and so is the firm\'s recorded transfer', await row('business account').getByRole('checkbox').isChecked())
  t.ok('a refund with no banking details is pending, and cannot be ticked',
    /Pending · no banking details/.test(await row('Sizwe Dlamini').innerText())
    && await row('Sizwe Dlamini').getByRole('checkbox').isDisabled())
  t.ok('...as is a client with none', await row('Baobab').getByRole('checkbox').isDisabled() && /Add banking details/.test(await row('Baobab').innerText()))
  t.ok('a payover before its day is pending as not yet due, with nothing to add', /Pending · not yet due/.test(await row('Karoo').innerText())
    && (await row('Karoo').getByTestId('add-banking').count()) === 0)
  const total = async () => (await page.getByTestId('file-total').innerText()).split(String.fromCharCode(0xa0)).join(' ')
  t.check('the file total is what is ticked', await total(), 'R 13 426.07')
  await row('business account').getByRole('checkbox').uncheck()
  t.check('...and leaving one out takes it off', await total(), 'R 8 426.07')
  await t.shot(page, 'payments-out')

  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.getByTestId('download-bank-file').click()])
  const csv = await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8')
  t.check('the bank file carries only what is ticked and payable, on its BF reference', JSON.stringify(csv.trim().split(/\r?\n/)),
    JSON.stringify(['Beneficiary name,Bank,Branch code,Account number,Amount,Own reference,Beneficiary reference',
      'Summit Fitness,FNB,250655,62000000001,8426.07,BF PO-SMT-2610,BF PO-SMT-2610']))

  /* ---- BANKING DETAILS WHERE THEY ARE MISSING ---- */
  await row('Sizwe Dlamini').getByTestId('add-banking').click()
  await page.getByLabel('Bank', { exact: true }).fill('Capitec')
  await page.getByLabel('Branch code').fill('470010')
  await page.getByLabel('Account number').fill('1234567890')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.waitForTimeout(500)
  const bk = sent.find((x) => x.fn === 'set_payment_banking')
  t.check('a refund\'s banking is saved on the refund', JSON.stringify(bk ? [bk.p_kind, bk.p_id, bk.p_holder, bk.p_bank, bk.p_branch, bk.p_account] : null),
    JSON.stringify(['refund', 'ref-1', 'Sizwe Dlamini', 'Capitec', '470010', '1234567890']))

  /* ---- MARK PAID FROM HERE STILL WORKS (the firm, 8 Oct: completed "from two places") ---- */
  await row('Summit Fitness').getByRole('button', { name: 'Mark paid' }).click()
  await page.getByLabel(/Reference it was paid with/).waitFor({ timeout: 10000 })
  t.check('the box starts from the payment\'s own reference', await page.getByLabel(/Reference it was paid with/).inputValue(), 'BF PO-SMT-2610')
  await page.getByRole('button', { name: 'Mark paid' }).last().click()
  await page.waitForTimeout(500)
  const mp = sent.find((x) => x.fn === 'mark_payover_run_paid')
  t.check('a run is marked paid with the run\'s own call', JSON.stringify({ fn: mp?.fn, id: mp?.p_run, ref: mp?.p_reference }),
    JSON.stringify({ fn: 'mark_payover_run_paid', id: 'run-smt', ref: 'BF PO-SMT-2610' }))

  /* ---- THE FIRM'S OWN TRANSFER ---- */
  const firm = page.getByTestId('firm-to-draw')
  t.ok('what the firm may draw is shown with its reference', /24[\s,.]?055[.,]36/.test(await firm.innerText()) && /BF FEES-\d{4}/.test(await firm.innerText()))
  t.ok('...and what still waits on its clients is said beside it, not offered', /3[\s,.]?000[.,]00/.test(await page.getByTestId('firm-waiting').innerText())
    && !/27[\s,.]?055/.test(await firm.innerText()))
  await firm.getByRole('button', { name: 'Record a transfer' }).click()
  await page.getByRole('button', { name: 'Record transfer' }).waitFor({ timeout: 10000 })
  await page.getByRole('button', { name: 'Record transfer' }).click()
  await page.waitForTimeout(500)
  const dr = sent.find((x) => x.fn === 'draw_from_trust')
  t.check('a transfer records the whole drawable share by default, with the reference', JSON.stringify({ fn: dr?.fn, amount: dr?.p_amount, ok: /^BF FEES-\d{4}$/.test(dr?.p_reference ?? '') }),
    JSON.stringify({ fn: 'draw_from_trust', amount: 24055.36, ok: true }))

  /* ---- WHAT HAS GONE OUT ---- */
  await page.getByRole('button', { name: /^Paid/ }).click()
  const gone = page.getByTestId('paid-out')
  await gone.first().waitFor({ timeout: 10000 })
  t.check('Paid lists what has gone out', await gone.count(), 2)
  t.check('...and the Paid tab is the one marked chosen', await page.getByRole('button', { name: /^Paid/ }).getAttribute('aria-pressed'), 'true')
  t.check('...not To pay', await page.getByRole('button', { name: /^To pay/ }).getAttribute('aria-pressed'), 'false')
  t.ok('...a payment marked paid waits for the statement', /Waiting for the statement/.test(await gone.filter({ hasText: 'Lowveld' }).innerText()))
  t.ok('...and one the statement confirmed says so', /On the statement 16 Sep 2026/.test(await gone.filter({ hasText: 'business account' }).innerText()))
  await t.shot(page, 'payments-out-paid')

  /* ---- AT GO-LIVE: FROM THE STATEMENT ONLY (the firm, 8 Oct) ---- */
  statementOnly = true
  await page.reload({ waitUntil: 'domcontentloaded' })
  await rows.first().waitFor({ timeout: 15000 })
  await page.getByText('Paid from the statement').first().waitFor({ timeout: 10000 }).catch(() => {})
  t.check('with the switch on there is no Mark paid', await page.getByRole('button', { name: 'Mark paid' }).count(), 0)
  t.ok('...each payable row says it is paid from the statement', (await page.getByText('Paid from the statement').count()) === 2)
  t.ok('...and recording the firm\'s transfer still works', await page.getByRole('button', { name: 'Record a transfer' }).isVisible())
  statementOnly = false

  answer = []
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByText(/Nothing is waiting to be paid/).waitFor({ timeout: 15000 }).catch(() => {})
  t.ok('with nothing due it says so', await page.getByText(/Nothing is waiting to be paid/).isVisible())
  await context.close()
} catch (e) {
  t.ok(`the run finished without throwing (${String(e).split('\n')[0].slice(0, 160)})`, false)
  try {
    const pages = browser.contexts().flatMap((c) => c.pages())
    if (pages[0]) await t.shot(pages[0], 'payments-out-where-it-stopped')
  } catch { /* nothing more to learn */ }
} finally {
  await browser.close()
  stopServer(server)
}

const good = t.finish(`Payments to make lists every run and refund still to pay, with its reference, due date and the
total. Screenshots in ${OUT}.`)
process.exit(good ? 0 : 1)

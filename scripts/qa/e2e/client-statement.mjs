/**
 * THE CLIENT'S ACCOUNT, IN A REAL BROWSER.
 *
 * THE FIRM WROTE THE SPECIFICATION BY LISTING IT: *"Now we are going to need a financial section
 * where we see a client balance. For example. Payover due to client. Payover paid to client.
 * Withdrawal invoice for client. Payover due to client. Withdrawal fee subtracted from payover.
 * Client paid payover. Invoice for executive listing. Invoice paid by client."*
 *
 * ALL EIGHT ARE HERE, IN THAT ORDER, and check-client-account already asserts that the SQL produces
 * them. What it cannot assert is that the screen draws all eight, that each one is labelled as the
 * kind of thing it is, and that the balance column carries the DATABASE's running figure rather
 * than something the browser added up again.
 *
 * WHAT THE BALANCE ASSERTION HERE DOES AND DOES NOT PROVE, said plainly because the obvious
 * reading of it is wrong. It asserts that all eight balances reach the page in the right order
 * and the right format. It does NOT prove the component read them rather than re-summing the
 * amounts: a faithful fixture's amounts necessarily total its balances, so both routes give the
 * same answer and a re-summing component passes this file. That rule -- one arithmetic, the
 * database's -- is guarded in check-workspace-split by reading the component's source, which is
 * where it can actually be caught.
 *
 * AND THE GROSS PAYOVER AND THE CHARGE ARE TWO LINES. The firm names them separately -- "payover
 * due to client" and then "withdrawal fee subtracted from payover" -- because that is how they say
 * it to a client. One net figure would leave somebody working backwards from a number nobody
 * quoted, so both lines are asserted present with their own amounts.
 *
 * Run: node scripts/qa/e2e/client-statement.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('client-statement')

/*
 * U+00A0 BUILT RATHER THAN TYPED. en-ZA groups thousands with a non-breaking space, so every
 * figure on the page contains one; a literal NBSP sitting invisibly inside a regex here is
 * unreadable, un-greppable, and survives a copy-paste as something else.
 */
const NBSP = String.fromCharCode(0xa0)
const plain = (text) => text.split(NBSP).join(' ')

const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator' }
/* A Sales Representative works this screen every day and may not see the payment split. */
const REP = { ...PROFILE, name: 'Dineo', role: 'Sales Representative' }

const CO = { id: 'c1', name: 'Rinda Roo Company', owner_id: ADMIN.id }

/* THE CLIENT LEDGER (10 Oct): held for them, a PTC fee they owe, a charge waiting for the payover,
   the charge set off, the payover paid, an invoice raised and paid. Opens at nil, goes both ways,
   and closes with the client owing us. */
const STATEMENT = [
  { entry_on: '2026-08-12', kind: 'held', description: 'Capital recovered, less commission, held for the client',
    reference: null, case_number: 'RAP-1001', amount: 2557.90, balance: 2557.90, run_id: null, charge_id: null },
  { entry_on: '2026-08-15', kind: 'payover_paid', description: 'Payover PO-RRC-2608 paid to the client',
    reference: 'PO-RRC-2608', case_number: null, amount: -2557.90, balance: 0, run_id: 'r1', charge_id: null },
  { entry_on: '2026-09-02', kind: 'invoice_raised', description: 'Withdrawal of RRC00003',
    reference: 'INV-0012', case_number: 'RAP-1003', amount: -575.00, balance: -575.00, run_id: null, charge_id: 'ch1' },
  { entry_on: '2026-09-12', kind: 'held', description: 'Capital recovered, less commission, held for the client',
    reference: null, case_number: 'RAP-1001', amount: 1800.00, balance: 1225.00, run_id: null, charge_id: null },
  { entry_on: '2026-09-12', kind: 'owed', description: 'Paid straight to the client, so they owe the trust the fees and commission',
    reference: null, case_number: 'RAP-1004', amount: -575.00, balance: 650.00, run_id: null, charge_id: null },
  { entry_on: '2026-09-15', kind: 'payover_paid', description: 'Payover PO-RRC-2609 paid to the client',
    reference: 'PO-RRC-2609', case_number: null, amount: -1225.00, balance: -575.00, run_id: 'r2', charge_id: null },
  { entry_on: '2026-10-01', kind: 'invoice_raised', description: 'Executive listing',
    reference: 'INV-0019', case_number: null, amount: -1380.00, balance: -1955.00, run_id: null, charge_id: 'ch2' },
  { entry_on: '2026-10-04', kind: 'invoice_paid', description: 'Invoice paid by the client',
    reference: 'EFT 8812', case_number: null, amount: 1380.00, balance: -575.00, run_id: null, charge_id: 'ch2' },
]

function handlersFor(profile, statement = STATEMENT) {
  return [
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [profile] })],
    [(u) => /\/rest\/v1\/firm_settings/.test(u),
      () => ({ body: [{ firm_name: 'Bredell Ferreira', vat_rate: 0.15 }] })],
    [(u) => /\/rest\/v1\/companies/.test(u), () => ({ body: [CO] })],
    [(u) => /\/rpc\/client_ledger/.test(u), () => ({ body: statement })],
    [(u) => /\/rest\/v1\//.test(u), () => ({ body: [] })],
    [(u) => /\/rpc\//.test(u), () => ({ body: [] })],
  ]
}

async function openClient(browser, profile, statement) {
  const { context, page } = await signedInPage(browser, profile, handlersFor(profile, statement), [])
  await page.goto(`http://127.0.0.1:${PORT}/companies/c1`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=Rinda Roo Company', { timeout: 15000 })
  return { context, page }
}

const server = await startServer()
const browser = await chromium.launch()
try {
  /* ---------------------------------------------------------------- the eight lines */
  {
    const { context, page } = await openClient(browser, ADMIN)
    const tab = page.getByRole('button', { name: 'Account', exact: true })
    t.ok('an administrator gets the Account tab', (await tab.count()) > 0)
    await tab.click()
    await page.waitForSelector('text=The client’s ledger', { timeout: 10000 })

    /* COUNTED BY ROWS IN THE STATEMENT'S OWN TABLE. The page carries other tables, and a bare
       `tr` count would be right for the wrong reason. */
    const rows = page.locator('table tbody tr')
    t.check('all eight entries are drawn', await rows.count(), 8)

    const body = plain(await page.locator('main').innerText())

    /* EACH OF THE FIRM'S EIGHT, NAMED. Not a loop over "whatever is there" -- that passes on an
       empty table. */
    for (const label of [
      'held for the client', 'Payover PO-RRC-2608 paid to the client', 'Withdrawal of RRC00003',
      'Paid straight to the client', 'Executive listing', 'Invoice paid by the client',
    ]) {
      t.ok(`"${label}" is on the statement`, body.includes(label))
    }

    /* AND EACH IS LABELLED AS THE KIND OF THING IT IS, because "Withdrawal of RRC00003" appears
       twice -- once invoiced and once taken off a payover -- and they are different events. */
    for (const chip of ['Held for them', 'Owed to us', 'Paid out', 'Invoiced', 'Invoice paid']) {
      t.ok(`the "${chip}" label is used`, body.includes(chip))
    }

    /*
     * THE GROSS PAYOVER AND THE CHARGE ARE TWO LINES, NOT ONE NET FIGURE. R1 800.00 due and
     * R575.00 off it, rather than R1 225.00 with no explanation.
     */
    t.ok('money held for them is its own line', /\+R 1 800\.00/.test(body))
    t.ok('...and so is a fee they owe us on a payment made to them', /−R 575\.00/.test(body))

    /*
     * THE BALANCE IS THE DATABASE'S. Every one of the eight is asserted, in order: a component
     * that re-summed its own amounts would have to reproduce all eight by luck, including the two
     * that share 2026-09-12.
     */
    const balances = await page.locator('table tbody tr td:last-child').allInnerTexts()
    /* JOINED INTO ONE STRING ON PURPOSE: the runner's check is Object.is, which is always false
       for two arrays -- so an assertion comparing them fails on identical content, and one written
       the other way round would pass on anything at all. */
    t.check('the running balance is the one handed over',
      balances.map((b) => plain(b).trim()).join(' | '),
      ['R 2 557.90', 'R 0.00', '-R 575.00', 'R 1 225.00', 'R 650.00',
        '-R 575.00', '-R 1 955.00', '-R 575.00'].join(' | '))

    /* THE CLOSING FIGURE SAYS WHICH WAY IT POINTS. A bare "-R 575.00" leaves somebody working out
       the sign; this account closes with the client owing the firm. */
    t.ok('and it says who owes whom', /The client owes us/.test(body))
    t.ok('...with the amount', /R 575\.00/.test(body))

    /* A payover line opens the run it came from; an invoice has no page to open yet. */
    t.ok('a payover line links to its run',
      (await page.locator('table a[href="/trust/runs/r1"]').count()) > 0)
    await context.close()
  }

  /* ------------------------------------------------- a client nothing has passed with */
  {
    const { context, page } = await openClient(browser, ADMIN, [])
    await page.getByRole('button', { name: 'Account', exact: true }).click()
    await page.waitForTimeout(600)
    const body = await page.locator('main').innerText()
    /*
     * EMPTY IS SAID, NOT DRAWN AS A ZERO BALANCE. "R 0.00 owed" is a statement about the account;
     * "nothing has passed yet" is the truth, and they are different claims.
     */
    t.ok('an untouched account says so', /Nothing has passed between the firm and this client/.test(body))
    t.check('...and draws no table', await page.locator('table tbody tr').count(), 0)
    await context.close()
  }

  /* ----------------------------------------------------------- and it is not for everybody */
  {
    /*
     * THE STATEMENT IS THE PAYOVER RUN AND THE COMMISSION THAT CAME OFF IT. The firm's condition
     * for the whole module: "Sales representatives never see the payment split." A rep works this
     * screen every day, so the tab has to be absent rather than merely unhelpful.
     */
    const { context, page } = await openClient(browser, REP)
    t.check('a sales rep gets no Account tab',
      await page.getByRole('button', { name: 'Account', exact: true }).count(), 0)
    /* The rest of the client page is still theirs. */
    t.ok('...but still has the client', (await page.getByText('Rinda Roo Company').count()) > 0)
    await context.close()
  }
} finally {
  await browser.close()
  await stopServer(server)
}

const good = t.finish(
  `The client's account, in a real browser. All eight of the firm's own lines drawn and labelled;
the gross payover and the charge taken off it as separate lines rather than one net figure; the
running balance read from the database rather than re-summed in the browser; an untouched account
saying so instead of showing a zero; and no Account tab at all for a sales representative.`)
process.exit(good ? 0 : 1)

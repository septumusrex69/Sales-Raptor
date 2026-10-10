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

/* THE CLIENT LEDGER, ONE LINE A PAYOVER (10 Oct). Two paid payovers, each with the payments of its
   period behind it, each paid out on its own line; two invoices, one paid; and money collected after
   the last run, not on a payover yet. Opens at nil, goes both ways, closes with the client owing us. */
const RUNS = [
  { id: 'r1', invoice_number: 'PO-RRC-2608', period_start: '2026-07-11', period_end: '2026-08-10', status: 'paid' },
  { id: 'r2', invoice_number: 'PO-RRC-2609', period_start: '2026-08-11', period_end: '2026-09-10', status: 'paid' },
]
const STATEMENT = [
  { entry_on: '2026-08-05', kind: 'held', description: 'Capital recovered, less commission, held for the client',
    reference: null, case_number: 'RAP-1001', amount: 2557.90, balance: 2557.90, run_id: null, charge_id: null },
  { entry_on: '2026-08-15', kind: 'payover_paid', description: 'Payover PO-RRC-2608 paid to the client',
    reference: 'PO-RRC-2608', case_number: null, amount: -2557.90, balance: 0, run_id: 'r1', charge_id: null },
  { entry_on: '2026-09-02', kind: 'invoice_raised', description: 'Withdrawal of RRC00003',
    reference: 'INV-0012', case_number: 'RAP-1003', amount: -575.00, balance: -575.00, run_id: null, charge_id: 'ch1' },
  { entry_on: '2026-09-05', kind: 'held', description: 'Capital recovered, less commission, held for the client',
    reference: null, case_number: 'RAP-1001', amount: 1800.00, balance: 1225.00, run_id: null, charge_id: null },
  { entry_on: '2026-09-06', kind: 'owed', description: 'Paid straight to the client, so they owe the trust the fees and commission',
    reference: null, case_number: 'RAP-1004', amount: -575.00, balance: 650.00, run_id: null, charge_id: null },
  { entry_on: '2026-09-15', kind: 'payover_paid', description: 'Payover PO-RRC-2609 paid to the client',
    reference: 'PO-RRC-2609', case_number: null, amount: -1225.00, balance: -575.00, run_id: 'r2', charge_id: null },
  { entry_on: '2026-10-01', kind: 'invoice_raised', description: 'Executive listing',
    reference: 'INV-0019', case_number: null, amount: -1380.00, balance: -1955.00, run_id: null, charge_id: 'ch2' },
  { entry_on: '2026-10-04', kind: 'invoice_paid', description: 'Invoice paid by the client',
    reference: 'EFT 8812', case_number: null, amount: 1380.00, balance: -575.00, run_id: null, charge_id: 'ch2' },
  { entry_on: '2026-10-12', kind: 'held', description: 'Capital recovered, less commission, held for the client',
    reference: null, case_number: 'RAP-1005', amount: 300.00, balance: -275.00, run_id: null, charge_id: null },
]

function handlersFor(profile, statement = STATEMENT) {
  return [
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [profile] })],
    [(u) => /\/rest\/v1\/firm_settings/.test(u),
      () => ({ body: [{ firm_name: 'Bredell Ferreira', vat_rate: 0.15 }] })],
    [(u) => /\/rest\/v1\/companies/.test(u), () => ({ body: [CO] })],
    [(u) => /\/rpc\/client_ledger/.test(u), () => ({ body: statement })],
    [(u) => /\/rest\/v1\/payover_runs/.test(u), () => ({ body: RUNS })],
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

    /* COUNTED BY THE LEDGER'S OWN ROWS. Nine lines of money become eight rows: the two payments
       of September's period are ONE payover line, which is the whole of what the firm asked for. */
    const rows = page.locator('[data-testid="ledger-row"]')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="ledger-row"]').length === 8, null, { timeout: 10000 })
    t.check('nine lines of money are eight ledger rows', await rows.count(), 8)

    const body = plain(await page.locator('main').innerText())
    for (const label of [
      'Payover PO-RRC-2608 · 11 Jul 2026 – 10 Aug 2026', 'Payover PO-RRC-2608 paid to the client',
      'Invoice INV-0012: Withdrawal of RRC00003', 'Payover PO-RRC-2609 · 11 Aug 2026 – 10 Sep 2026',
      'Invoice INV-0019: Executive listing', 'paid by the client', 'Collections 11 Oct 2026 – 10 Nov 2026',
    ]) {
      t.ok(`"${label}" is on the ledger`, body.includes(label))
    }
    /* A PTC IS NOT A LINE OF ITS OWN any more: it is inside its payover until somebody opens it. */
    t.ok('a PTC is not drawn until its payover is opened', !body.includes('Paid straight to the client'))
    t.ok('money after the last run says it is not on a payover yet', /Not on a payover yet/.test(body))
    t.ok('the ledger has Debit and Credit columns', /Debit/.test(body) && /Credit/.test(body))

    /* The September payover nets R1 800 held and R575 owed: R1 225 credited, on one line. */
    const sep = rows.filter({ hasText: 'PO-RRC-2609 ·' })
    t.ok('September\'s payover is credited its net', /R 1 225\.00/.test(plain(await sep.innerText())))
    t.ok('...and says how many lines are behind it', /2 lines/.test(await sep.innerText()))

    /* Dr / Cr, never a bare minus: the firm misread "-R 14 162.50" once already. */
    const balances = await page.locator('[data-testid="ledger-row"] td:last-child').allInnerTexts()
    t.check('the running balance, in Dr and Cr',
      balances.map((b) => plain(b).replace(/\s+/g, ' ').trim()).join(' | '),
      ['R 2 557.90 Cr', 'R 0.00', 'R 575.00 Dr', 'R 650.00 Cr', 'R 575.00 Dr',
        'R 1 955.00 Dr', 'R 575.00 Dr', 'R 275.00 Dr'].join(' | '))
    t.ok('and it says who owes whom', /The client owes us/.test(body))
    t.ok('...with the database\'s closing figure', /R 275\.00/.test(body))

    /* OPENING A PAYOVER shows the payments behind it, each with its account. */
    await sep.click()
    await page.waitForSelector('[data-testid="ledger-detail"]', { timeout: 5000 })
    const detail = plain(await page.locator('[data-testid="ledger-detail"]').allInnerTexts().then((x) => x.join(' / ')))
    t.check('opening it shows its two payments', await page.locator('[data-testid="ledger-detail"]').count(), 2)
    t.ok('...the PTC among them, named for what it is', /Paid to them directly/.test(detail))
    t.ok('...with the account it came from', /RAP-1004/.test(detail))

    t.ok('a payover line links to its run',
      (await page.locator('table a[href="/trust/runs/r1"]').count()) > 0)

    /* The firm, 10 Oct: the Account tab to the right of Payovers. */
    const tabs = await page.locator('button').allInnerTexts()
    const pi = tabs.findIndex((x) => /^Payovers/.test(x.trim()))
    const ai = tabs.findIndex((x) => x.trim() === 'Account')
    t.ok('the Account tab sits right of Payovers', pi >= 0 && ai > pi)
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

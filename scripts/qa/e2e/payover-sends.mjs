/**
 * A SENT PAYOVER ADVICE, KEPT AS IT WENT, IN A REAL BROWSER.
 *
 * The firm, 8 Oct: "if something was sent, there should be ... a record of ... the data that was
 * sent", and "you can revise one and then send it again". check-payover-sends holds the table, the
 * bucket and the order of the steps; this holds that a run shows every copy that went, that a sent
 * or paid run offers Send again, and that a run sent before copies were kept says so plainly rather
 * than showing an empty list.
 *
 * Run: node scripts/qa/e2e/payover-sends.mjs
 */
import { OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('payover-sends')
const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator', team_id: null }
const RUN = {
  id: 'run-1', invoice_number: 'PO-BPM-2610', status: 'paid', period_start: '2026-08-11', period_end: '2026-09-10',
  trust_capital: 10000, trust_commission: 1500, due_to_client: 8500, ptc_received: 0, ptc_fees_taken: 0,
  ptc_capital: 0, ptc_commission: 0, due_to_bf: 0, commission_vat: 225, carried_in: 0, charges_set_off: 0,
  excess_released: 0, net_payover: 8275, approved_at: '2026-10-08T08:00:00Z', sent_at: '2026-10-08T09:00:00Z',
  paid_at: '2026-10-08T10:00:00Z', eft_reference: 'BF PO-BPM-2610', company_id: 'c2',
  companies: { name: 'Baobab Property Managers (Pty) Ltd', code: 'BPM', commission_rate: 0.15, vat_number: null, email: 'accounts@example.co.za' },
}
const SENDS = [
  { id: 's2', run_id: 'run-1', version: 2, sent_at: '2026-10-09T09:00:00Z', sent_to: 'finance@example.co.za',
    subject: 'Remittance advice', net_payover: 8275, pdf_path: 'c2/PO-BPM-2610/b.pdf', xlsx_path: 'c2/PO-BPM-2610/b.xlsx' },
  { id: 's1', run_id: 'run-1', version: 1, sent_at: '2026-10-08T09:00:00Z', sent_to: 'accounts@example.co.za',
    subject: 'Remittance advice', net_payover: 8275, pdf_path: 'c2/PO-BPM-2610/a.pdf', xlsx_path: 'c2/PO-BPM-2610/a.xlsx' },
]
let sends = SENDS
let runShown = RUN
/* Ready, in a cycle that has not closed (far off, so the test does not age). */
const OPEN_RUN = { ...RUN, id: 'run-open', status: 'ready', period_start: '2099-12-11', period_end: '2099-12-31',
  approved_at: null, sent_at: null, paid_at: null, eft_reference: null }
const q = (id, client, start, end, net, status) => ({ run_id: id, company_id: id, client, client_code: null,
  invoice_number: `PO-${id}`, period_start: start, period_end: end, payments: 1, trust_capital: net,
  ptc_set_off: 0, net_payover: net, exceptions: 0, status, next_step: 'mark_paid', approved_at: null,
  sent_at: null, paid_at: null, eft_reference: null })
const QUEUE = [
  q('A', 'Summit Fitness', '2026-08-11', '2026-09-10', 8426.07, 'sent'),
  q('B', 'Baobab Property', '2026-08-11', '2026-09-10', 9699.53, 'approved'),
  q('C', 'Lowveld Motors', '2026-07-11', '2026-08-10', 120, 'sent'),
  /* Ready in the cycle being paid now, and ready in the cycle still open (not approvable yet). */
  { ...q('E', 'Silverleaf Body Corporate', '2026-08-11', '2026-09-10', 500, 'ready'), next_step: 'approve' },
  { ...q('D', 'Karoo Fleet Hire', '2026-09-11', '2026-10-10', 3031.31, 'ready'), next_step: 'approve' },
]
const calls = []
/* Three stages: on the statement, paid by hand and not yet on it, and still owed. */
const CLIENT_RUNS = [
  { id: 'run-2', invoice_number: 'PO-BPM-2611', status: 'sent', period_start: '2026-09-11', period_end: '2026-10-10',
    net_payover: 1200, paid_at: null, eft_reference: null },
  { id: 'run-1', invoice_number: 'PO-BPM-2610', status: 'paid', period_start: '2026-08-11', period_end: '2026-09-10',
    net_payover: 8275, paid_at: '2026-10-08T10:00:00Z', eft_reference: 'BF PO-BPM-2610' },
  { id: 'run-0', invoice_number: 'PO-BPM-2609', status: 'paid', period_start: '2026-07-11', period_end: '2026-08-10',
    net_payover: 500, paid_at: '2026-09-15T10:00:00Z', eft_reference: 'BF PO-BPM-2609' },
]
const handlers = [
  [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
  /* The client's list asks by company; the run page asks for one. */
  [(u) => /\/rest\/v1\/payover_runs\?.*company_id=eq/.test(u), () => ({ body: CLIENT_RUNS })],
  [(u) => /\/rest\/v1\/payover_runs\?/.test(u), () => ({ body: runShown })],
  [(u) => /\/rest\/v1\/bank_statement_lines\?/.test(u), () => ({ body: [{ payover_run_id: 'run-0', txn_date: '2026-09-16' }] })],
  [(u) => /\/rest\/v1\/companies/.test(u), () => ({ body: [{ id: 'c2', name: 'Baobab Property Managers (Pty) Ltd', owner_id: ADMIN.id }] })],
  [(u) => /\/rest\/v1\/payover_run_sends\?/.test(u), () => ({ body: sends })],
  [(u) => /\/rest\/v1\/firm_settings\?/.test(u), () => ({ body: { firm_name: 'Bredell Ferreira', physical_address: null, phone: null, email: null, vat_number: null, payouts_statement_only: false } })],
  [(u) => /\/rpc\/payover_cycle_now/.test(u), () => ({ body: [{ period_start: '2026-09-11', period_end: '2026-10-10', days_left: 2, today: '2026-10-08' }] })],
  [(u) => /\/rpc\/payover_work_queue/.test(u), () => ({ body: QUEUE })],
  [(u) => /\/rpc\/(refresh_payover_runs|approve_payover_run_early|approve_payover_run)/.test(u),
    (u, req) => { calls.push({ fn: /\/rpc\/(\w+)/.exec(u)[1], ...(req.postDataJSON() ?? {}) }); return { body: 0 } }],
  [(u) => /\/rest\/v1\//.test(u), () => ({ body: [] })],
  [(u) => /\/rpc\//.test(u), () => ({ body: [] })],
]

const server = await startServer()
const browser = await chromium.launch()
try {
  const { context, page } = await signedInPage(browser, ADMIN, handlers, [])
  await page.goto(`http://127.0.0.1:${PORT}/trust/runs/run-1`, { waitUntil: 'domcontentloaded' })
  const list = page.getByTestId('sent-copies')
  await list.waitFor({ timeout: 20000 })
  t.check('every copy that went is listed', await list.locator('li').count(), 2)
  const text = await list.innerText()
  t.ok('...the revision named as such, newest first', /^Sent again \(2\)/.test(text.trim()))
  t.ok('...each with where it went', text.includes('finance@example.co.za') && text.includes('accounts@example.co.za'))
  t.check('...and each opens its own PDF and schedule', await list.getByRole('button', { name: 'Statement (PDF)' }).count(), 2)
  t.ok('a paid run offers Send again', await page.getByRole('button', { name: 'Send again' }).isVisible())
  t.check('...and not a first Email advice', await page.getByRole('button', { name: 'Email advice' }).count(), 0)
  await t.shot(page, 'payover-sends')

  await page.getByRole('button', { name: 'Send again' }).click()
  const title = page.getByText('Send the remittance advice again')
  await title.waitFor({ timeout: 10000 }).catch(() => {})
  t.ok('Send again says it goes beside what was sent', await title.isVisible()
    && (await page.getByText(/What was sent before is kept as it was/).count()) > 0)
  await page.getByRole('button', { name: 'Cancel' }).click()

  /* ---- THE QUEUE IN CYCLES (the firm, 8 Oct: "this month to process / previous month pending") ---- */
  await page.goto(`http://127.0.0.1:${PORT}/trust/payover`, { waitUntil: 'domcontentloaded' })
  const groups = page.getByTestId('cycle-group')
  await groups.first().waitFor({ timeout: 15000 })
  const heads = (await groups.allInnerTexts()).map((x) => x.split(String.fromCharCode(0xa0)).join(' '))
  t.check('one heading per cycle', heads.length, 3)
  t.ok('the open cycle first, building up', /^This cycle so far — still open[\s\S]*1 client/.test(heads[0] ?? ''))
  t.ok('...then this month, with its total', /^This month to process[\s\S]*3 clients[\s\S]*R 18 625\.60/.test(heads[1] ?? ''))
  t.ok('...then the older one still pending', /^Earlier, still pending[\s\S]*1 client/.test(heads[2] ?? ''))

  /* ---- THE RUNS BUILD THEMSELVES, AND ARE WORKED IN BULK (the firm, 8 Oct) ---- */
  t.ok('opening the queue brings every run up to date', calls.some((c) => c.fn === 'refresh_payover_runs'))
  t.check('...so there is no Build a run button', await page.getByRole('button', { name: /Build a run/ }).count(), 0)
  t.ok('a run whose cycle is still open says so instead of offering Approve',
    /Open until 10 Oct 2026/.test(await page.getByTestId('queue-run').filter({ hasText: 'Karoo Fleet Hire' }).innerText()))
  for (const name of ['Karoo Fleet Hire', 'Silverleaf Body Corporate', 'Baobab Property']) {
    await page.getByRole('checkbox', { name: `Select ${name}` }).check()
  }
  const bar = page.getByTestId('bulk-bar')
  const barText = await bar.innerText()
  t.ok('the bulk bar offers only what the picked runs are ready for',
    /3 selected/.test(barText) && /Approve 1/.test(barText) && /Email advice 1/.test(barText))
  await t.shot(page, 'payover-queue-cycles')
  await bar.getByRole('button', { name: 'Approve 1' }).click()
  await page.getByTestId('bulk-note').waitFor({ timeout: 10000 }).catch(() => {})
  t.check('...and approves the ready one whose cycle has closed, and nothing else',
    JSON.stringify(calls.filter((c) => c.fn === 'approve_payover_run').map((c) => c.p_run)), JSON.stringify(['E']))
  t.ok('...saying what it did', /1 approved/.test(await page.getByTestId('bulk-note').innerText().catch(() => '')))

  /* ---- APPROVING BEFORE THE CYCLE CLOSES, WITH A REASON (the firm, 8 Oct) ---- */
  runShown = OPEN_RUN
  sends = []
  await page.goto(`http://127.0.0.1:${PORT}/trust/runs/run-open`, { waitUntil: 'domcontentloaded' })
  const early = page.getByRole('button', { name: 'Approve early…' })
  await early.waitFor({ timeout: 15000 })
  t.check('a run whose cycle is open offers Approve early, not Approve', await page.getByRole('button', { name: 'Approve', exact: true }).count(), 0)
  await early.click()
  const now = page.getByRole('button', { name: 'Approve now' })
  await page.getByLabel('Why now?').fill('too short')
  t.ok('...which wants a real reason', await now.isDisabled())
  await page.getByLabel('Why now?').fill('Large PTC: the client owes us our share and needs the advice')
  await now.click()
  await page.waitForTimeout(500)
  const sentEarly = calls.find((c) => c.fn === 'approve_payover_run_early')
  t.check('...and approves through the early function, with the reason',
    JSON.stringify(sentEarly ? { p_run: sentEarly.p_run, p_reason: sentEarly.p_reason } : null),
    JSON.stringify({ p_run: 'run-open', p_reason: 'Large PTC: the client owes us our share and needs the advice' }))
  runShown = RUN
  sends = SENDS

  /* ---- THE CLIENT'S FOLDER: every run, where it has got to, and what was sent ---- */
  await page.goto(`http://127.0.0.1:${PORT}/companies/c2`, { waitUntil: 'domcontentloaded' })
  const tab = page.getByRole('button', { name: 'Payovers', exact: true })
  await tab.waitFor({ timeout: 15000 })
  await tab.click()
  const runsOn = page.getByTestId('client-payover')
  await runsOn.first().waitFor({ timeout: 15000 })
  t.check('the client lists every run', await runsOn.count(), 3)
  const folder = (await page.locator('main').innerText()).split(String.fromCharCode(0xa0)).join(' ')
  t.ok('a run paid by hand is waiting for the statement', /PO-BPM-2610[\s\S]*Paid, waiting for the statement/.test(folder))
  t.ok('...one on the statement says when', /Paid, on the statement 16 Sep 2026/.test(folder))
  t.ok('...a sent one is still owed', /Advice sent, not paid yet/.test(folder))
  t.ok('...with what it was paid with', folder.includes('reference BF PO-BPM-2610'))
  t.ok('the copies sent sit under their run', (await runsOn.filter({ hasText: 'PO-BPM-2610' }).getByRole('button', { name: 'Statement (PDF)' }).count()) === 2)
  t.ok('paid out and still to pay are added up', /Paid out R 8 775\.00/.test(folder) && /Still to pay R 1 200\.00/.test(folder))
  await t.shot(page, 'client-payovers')

  sends = []
  await page.goto(`http://127.0.0.1:${PORT}/trust/runs/run-1`, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  const none = page.getByTestId('no-sent-copy')
  await none.waitFor({ timeout: 15000 }).catch(() => {})
  t.ok('a run sent before copies were kept says there is no copy', await none.isVisible())
  await context.close()
} catch (e) {
  t.ok(`the run finished without throwing (${String(e).split('\n')[0].slice(0, 160)})`, false)
  try {
    const pages = browser.contexts().flatMap((c) => c.pages())
    if (pages[0]) await t.shot(pages[0], 'payover-sends-where-it-stopped')
  } catch { /* nothing more to learn */ }
} finally {
  await browser.close()
  stopServer(server)
}

const good = t.finish(`A sent run lists every copy that went, offers Send again, and says so when no copy was kept.
Screenshots in ${OUT}.`)
process.exit(good ? 0 : 1)

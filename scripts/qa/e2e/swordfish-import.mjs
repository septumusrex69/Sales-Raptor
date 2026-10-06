/**
 * The Swordfish import, driven in a real browser: the cut-off, and all-or-nothing (prompt 8).
 *
 * WHAT HAPPENED. Re-importing the test book on staging with "Swordfish has paid clients over up to
 * and including 10 Sep 2026", every receipt -- all dated before it -- was split by the database
 * anyway, and the import then died part-way and left 7 clients, 20 accounts, 90 payments and 2 202
 * fees behind.
 *
 * TWO LAYERS, AND THIS IS THE BROWSER'S. What the DATABASE does with a remitted receipt is proved
 * against staging by scripts/qa/live/swordfish-cutoff-probe.sql -- a stub cannot run triggers. What
 * this proves is the half only a browser sees: what the import actually SENDS at each cut-off, and
 * that a failure part-way takes the whole run back out and says so.
 *
 *   1. cut-off after every receipt  -> all five sent as remitted and approved; nothing for the queue
 *   2. cut-off before the last three -> exactly those three sent unapproved and not remitted
 *   3. every client, batch and account carries ONE id for the run
 *   4. the interest insert refused  -> discard_import_batch is called with that same id, and the
 *      screen says the run was taken back out rather than leaving half a book
 *
 * Run: node scripts/qa/e2e/swordfish-import.mjs
 */
import {
  OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer,
} from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('swordfish-import')
const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator' }

/* ---------- the exports: one account, five receipts, four interest periods ---------- */

const csv = (rows) => {
  const cols = Object.keys(rows[0])
  const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c] ?? '')).join(','))].join('\n')
}
const REF = 'TST1/0001'
const ACCOUNTS = csv([{
  'Client': 'Probe Trading (Pty) Ltd', 'Client Prefix': 'TST1', 'Swordfish Reference': REF,
  'Capital on Default': '10000', 'Surname': 'Mokoena', 'Load Date': '2025-02-03',
  'Current Interest Rate': '24',
}])
const RECEIPTS = ['2026-06-15', '2026-07-15', '2026-08-15', '2026-09-15', '2026-10-01']
const PAYMENTS = csv(RECEIPTS.map((d, i) => ({
  'Swordfish Reference': REF, 'Payment Date': d, 'Payment Amount': '400', 'Payment Type': 'EFT',
  'Payment Unique ID': `PU-${i + 1}`,
})))
/* A HEADER WITH NO ROWS is an export with nothing in it, which the import must accept. */
const ACTIONS = 'Swordfish Reference,Action Date,Action,Amount\n'
const INTEREST = csv(['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'].map((d) => ({
  'Swordfish Reference': REF, 'Date From': d,
  'Date To': d.replace(/-01$/, '-30'), 'Days': '30', 'Interest Added': '25',
})))

/* ---------- the database, as the import sees it ---------- */

let sent = {}          // table -> rows POSTed, for the run in progress
let discards = []      // p_batch of every discard_import_batch call
let refuseInterest = false

const handlers = [
  [(u) => u.includes('/auth/v1/user'), () => ({ body: { id: ADMIN.id, email: ADMIN.email } })],
  [(u) => u.includes('/rest/v1/profiles'), () => ({ body: [ADMIN] })],
  [(u) => u.includes('/rpc/discard_import_batch'), (u, req) => {
    discards.push(req.postDataJSON()?.p_batch ?? null)
    return { body: { accounts: 1, batches: 1, clients: 1 } }
  }],
  [(u, req) => req.method() === 'POST' && /\/rest\/v1\/(companies|handovers|debtor_accounts|account_payments|account_fees|account_interest_accruals|account_contacts|promises_to_pay|account_notes|diary_entries)\b/.test(u),
    (u, req) => {
      const table = /\/rest\/v1\/(\w+)/.exec(u)[1]
      /* THE FAILURE THAT STOPPED THE REAL IMPORT, on the same table and the same index. */
      if (table === 'account_interest_accruals' && refuseInterest) {
        return {
          status: 409,
          body: { code: '23505', message: 'duplicate key value violates unique constraint "account_interest_accruals_period_idx"' },
        }
      }
      const rows = req.postDataJSON()
      sent[table] = [...(sent[table] ?? []), ...(Array.isArray(rows) ? rows : [rows])]
      return { status: 201, body: [] }
    }],
  [(u) => /\/rest\/v1\//.test(u), () => ({ body: [] })],
  [(u) => /\/rpc\//.test(u), () => ({ body: [] })],
]

async function importWith(page, cutoff) {
  sent = {}; discards = []
  await page.goto(`http://127.0.0.1:${PORT}/settings?tab=Data%20Import`, { waitUntil: 'domcontentloaded' })
  await page.getByText('Client Account Summary').first().waitFor({ timeout: 20000 })
  const pick = async (label, name, text) => page.locator('label', { hasText: label }).first()
    .locator('input[type=file]').setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(text) })
  await pick('Client Account Summary', 'accounts.csv', ACCOUNTS)
  await pick('Payments', 'payments.csv', PAYMENTS)
  await pick('Actions performed per Client', 'actions.csv', ACTIONS)
  await pick('Interest per Period', 'interest.csv', INTEREST)
  await page.locator('label', { hasText: 'Swordfish has paid clients over up to and including' })
    .locator('input[type=date]').fill(cutoff)
  await page.getByRole('button', { name: 'Read the exports' }).click()
  const go = page.getByRole('button', { name: /^Import 1 accounts?$/ })
  await go.waitFor({ timeout: 20000 })
  await go.click()
  /* Wait for the run to END, either way, before reading what it sent. */
  await page.getByText(/Imported [\d  ]+ rows\.|taken back out|Nothing was written/).first()
    .waitFor({ timeout: 30000 })
}

const server = await startServer()
const browser = await chromium.launch()
try {
  const { context, page } = await signedInPage(browser, ADMIN, handlers, [])

  /* ---------- 1. cut-off after every receipt ---------- */
  await importWith(page, '2026-10-05')
  const all = sent.account_payments ?? []
  t.check('cut-off after every receipt: all five receipts are written', all.length, 5)
  t.check('...every one marked as already paid over in Swordfish',
    all.filter((p) => p.paid_over_in_swordfish === true).length, 5)
  t.check('...and approved, so none waits in the queue', all.filter((p) => !p.approved_at).length, 0)
  t.check('...and the Swordfish interest is written', (sent.account_interest_accruals ?? []).length, 4)
  t.ok('...and the import says it finished', await page.getByText(/Imported [\d  ]+ rows\./).first().isVisible())
  t.check('...with nothing taken back out', discards.length, 0)

  /* ---------- 3. one id for the whole run ---------- */
  const ids = new Set(['companies', 'handovers', 'debtor_accounts']
    .flatMap((tb) => (sent[tb] ?? []).map((r) => r.import_batch_id)))
  t.check('every client, batch and account carries one id for the run', ids.size, 1)
  t.ok('...and it is a real id, not a missing one', [...ids].every((v) => typeof v === 'string' && v.length === 36))
  t.ok('...on the client and on the account alike',
    (sent.companies ?? []).length > 0 && (sent.debtor_accounts ?? []).length > 0)
  const firstRun = [...ids][0]

  /* ---------- 2. cut-off before the last three ---------- */
  await importWith(page, '2026-07-31')
  const pay = sent.account_payments ?? []
  const queued = pay.filter((p) => !p.approved_at)
  t.check('cut-off before the last three: exactly three wait for approval', queued.length, 3)
  /* AS JSON: this runner compares with Object.is, which is false for any two arrays (HANDOFF §6). */
  t.check('...and they are the last three',
    JSON.stringify(queued.map((p) => p.received_at?.slice(0, 10)).sort()),
    JSON.stringify(['2026-08-15', '2026-09-15', '2026-10-01']))
  t.check('...none of them marked as paid over in Swordfish',
    queued.filter((p) => p.paid_over_in_swordfish).length, 0)
  t.check('...while the first two are history',
    pay.filter((p) => p.paid_over_in_swordfish && p.approved_at).length, 2)
  const secondRun = (sent.debtor_accounts ?? [])[0]?.import_batch_id
  t.ok('a second run gets an id of its own', !!secondRun && secondRun !== firstRun)

  /* ---------- 4. a failure part-way takes the run back out ---------- */
  refuseInterest = true
  await importWith(page, '2026-10-05')
  const stamped = (sent.debtor_accounts ?? [])[0]?.import_batch_id
  t.ok('the run wrote accounts and payments before the interest was refused',
    (sent.debtor_accounts ?? []).length === 1 && (sent.account_payments ?? []).length === 5)
  t.check('...so it asked for the run to be taken back out, once', discards.length, 1)
  t.check('...naming exactly the id it had stamped', discards[0], stamped)
  t.ok('...and the screen says so, rather than leaving half a book',
    await page.getByText(/has been taken back out \(1 accounts, 1 clients\)/).first().isVisible())
  t.ok('...and names what failed', await page.getByText(/account_interest_accruals_period_idx|interest/i).first().isVisible())
  t.check('...and does not claim the import finished',
    await page.getByText(/Imported [\d  ]+ rows\./).count(), 0)
  await t.shot(page, 'swordfish-import-taken-back-out')
  refuseInterest = false

  await context.close()
} catch (e) {
  t.ok(`the run finished without throwing (${String(e).split('\n')[0].slice(0, 160)})`, false)
  try {
    const pages = browser.contexts().flatMap((c) => c.pages())
    if (pages[0]) await t.shot(pages[0], 'swordfish-import-where-it-stopped')
  } catch { /* nothing more to learn */ }
} finally {
  await browser.close()
  stopServer(server)
}


const good = t.finish(`The import sends remitted receipts as history and the rest for approval, stamps one
id on the whole run, and takes the run back out when it fails part-way. Screenshots in ${OUT}.`)
process.exit(good ? 0 : 1)

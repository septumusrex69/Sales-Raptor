/**
 * BALANCES BROUGHT FORWARD FROM SWORDFISH, IN A REAL BROWSER (HANDOFF §3a, go-live item 3).
 *
 * The screen reads Camille's Trust Debtors workbook in the browser -- the real xlsx.ts reader on a
 * real .xlsx -- picks the newest month as the left-most dated column and SAYS which month it is,
 * matches each row to a client, shows what is matched, unmatched and zero with the totals owed and
 * credited, refuses to bring anything forward while a row waits on a person, and then sends the
 * matched rows in one call: the file NAME as the source, the cut-over, the month, and for each row
 * the cell and the signed amount -- never a client's name.
 *
 * Every client and figure here is invented. The real workbook is client data and this repo is public.
 *
 * Run: node scripts/qa/e2e/brought-forward.mjs
 */
import { OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'
import { buildXlsx } from '../../../src/lib/xlsxWrite.ts'

const t = makeRunner('brought-forward')
const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator' }
const NBSP = String.fromCharCode(0xa0)
const flat = (s) => s.split(NBSP).join(' ').replace(/,/g, ' ')

const CLIENTS = [
  { id: 'c-acme', name: 'Acme Holdings', code: 'ACM' },
  { id: 'c-beta', name: 'Beta Traders', code: 'BTR' },
  { id: 'c-gma', name: 'Gamma Motors', code: 'GMA' },
  { id: 'c-del', name: 'Delta Known', code: 'DLK' },
  { id: 'c-ind', name: 'Indigo', code: 'IND' },
]
/* Indigo already has a balance brought forward: the screen marks it and does not send it. */
const EXISTING = [{ company_id: 'c-ind', amount: 20, source_file: 'Earlier.xlsx', raised_on: '2026-12-10' }]

const n = (v) => ({ n: v })
const SHEET = buildXlsx('Trust Debtors', [
  ['', 'Client', 'Name', 'NEW NOTES', '2026/10/01', '2026/08/01', 'Dec', 'Cam Nota'],
  ['', ' Acme Holdings ', '', '', n(1234.56), n(99), '', ''],   // owed, by name
  ['', 'BETA TRADERS', '', '', n(-250.4), '', '', ''],          // a credit, by name ignoring case
  ['', 'GMA', '', '', n(300), '', '', ''],                      // by code
  ['', 'Delta Unknown', '', '', n(75), '', '', ''],             // unmatched until picked
  ['', 'Foxtrot', '', '', n(0), n(5), '', ''],                  // nothing owed this month
  ['', 'Indigo', '', '', n(20), '', '', ''],                    // already brought forward
  ['', '', '', '', n(1379.16), '', '', ''],                     // the sheet's own total line
])

let sent = null
const handlers = [
  [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
  [(u) => /\/rest\/v1\/companies\?select=id%2Cname%2Ccode|\/rest\/v1\/companies\?select=id,name,code/.test(u), () => ({ body: CLIENTS })],
  [(u) => /\/rest\/v1\/client_charges/.test(u) && /brought_forward/.test(u), () => ({ body: EXISTING })],
  [(u) => /\/rpc\/bring_forward_client_balances/.test(u), (_u, req) => {
    sent = JSON.parse(req.postData() ?? '{}')
    return { body: { added: 4, skipped: 0, owed: 1609.56, credited: 250.4 } }
  }],
  [(u) => /\/rest\/v1\//.test(u), () => ({ body: [] })],
  [(u) => /\/rpc\//.test(u), () => ({ body: [] })],
]

const server = await startServer()
const browser = await chromium.launch()
try {
  const { context, page } = await signedInPage(browser, ADMIN, handlers, [])
  await page.goto(`http://127.0.0.1:${PORT}/trust/settings`, { waitUntil: 'domcontentloaded' })
  const open = page.getByTestId('brought-forward-open')
  await open.waitFor({ timeout: 20000 })
  t.ok('Trust settings offers it beside the other cut-over figures', await open.isVisible())
  await open.click()
  await page.waitForURL(/\/trust\/brought-forward$/, { timeout: 10000 })
  t.ok('it opens its own page in the trust workspace', /\/trust\/brought-forward$/.test(page.url()))
  t.check('the cut-over is filled in with the agreed day', await page.getByTestId('bf-cutover').inputValue(), '2026-12-10')

  await page.getByTestId('bf-file').setInputFiles({
    name: 'Trust Debtors Test.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(SHEET),
  })
  const month = page.getByTestId('bf-month')
  await month.waitFor({ timeout: 15000 })
  t.ok('it says which month it is bringing forward, and from which column',
    /October 2026[\s\S]*newest month on the Trust Debtors sheet \(column E\)/.test(await month.innerText()))
  t.ok('...and the words every line will carry',
    /Balance brought forward from Swordfish \(October 2026\)/.test(await month.innerText()))

  t.check('matched: by name, by name ignoring case, by code', await page.getByTestId('bf-matched').innerText(), '3')
  t.check('one row needs a client', await page.getByTestId('bf-unmatched').innerText(), '1')
  t.check('one row has nothing owed', await page.getByTestId('bf-zero').innerText(), '1')
  t.ok('owed to the firm is the matched positives', /R 1 534\.56/.test(flat(await page.getByTestId('bf-owed').innerText())))
  t.ok('credit to clients is the matched negative', /R 250\.40/.test(flat(await page.getByTestId('bf-credited').innerText())))
  t.check('the client already brought forward is marked, not sent',
    await page.locator('[data-testid="bf-row"][data-state="already"]').count(), 1)
  t.check('the total line with no client name is shown and not brought forward',
    await page.locator('[data-testid="bf-row"][data-state="no_name"]').count(), 1)
  const bring = page.getByTestId('bf-bring')
  t.ok('nothing can be brought forward while a row waits on a person', await bring.isDisabled())
  await t.shot(page, 'brought-forward-read')

  await page.locator('[data-testid="bf-row"][data-state="unmatched"]').getByTestId('bf-pick').selectOption('c-del')
  await page.locator('[data-testid="bf-row"][data-state="matched"]').nth(3).waitFor({ timeout: 5000 })
  t.check('a picked client is matched', await page.getByTestId('bf-matched').innerText(), '4')
  t.ok('...and the total moves with it', /R 1 609\.56/.test(flat(await page.getByTestId('bf-owed').innerText())))
  t.ok('now it can be brought forward', await bring.isEnabled())
  t.ok('...and the button says how many', /Bring forward 4 balances/.test(await bring.innerText()))

  await bring.click()
  const done = page.getByTestId('bf-done')
  await done.waitFor({ timeout: 10000 })
  t.ok('it says what was brought forward', /Brought forward 4 balances[\s\S]*R 1 609\.56 owed to the firm[\s\S]*R 250\.40 owed to clients[\s\S]*dated 10 December 2026/.test(flat(await done.innerText())))
  t.check('the source is the file name', sent?.p_source, 'Trust Debtors Test.xlsx')
  t.check('...the month is the newest column', sent?.p_month, '2026-10-01')
  t.check('...dated the cut-over', sent?.p_cut_over, '2026-12-10')
  const rows = (sent?.p_rows ?? []).slice().sort((a, b) => a.row_ref.localeCompare(b.row_ref))
  t.check('...one row per matched client, by cell, with its sign', JSON.stringify(rows), JSON.stringify([
    { company_id: 'c-acme', amount: 1234.56, row_ref: 'Trust Debtors!E2' },
    { company_id: 'c-beta', amount: -250.4, row_ref: 'Trust Debtors!E3' },
    { company_id: 'c-gma', amount: 300, row_ref: 'Trust Debtors!E4' },
    { company_id: 'c-del', amount: 75, row_ref: 'Trust Debtors!E5' },
  ]))
  t.ok('...and no client name leaves the page', !/Acme|BETA|Beta|Delta|Holdings/.test(JSON.stringify(sent?.p_rows ?? [])))
  await t.shot(page, 'brought-forward-done')
  await context.close()
} catch (e) {
  try { const pg = browser.contexts().flatMap((c) => c.pages())[0]; if (pg) { await t.shot(pg, 'brought-forward-where-it-stopped'); console.log('URL', pg.url()) } } catch { /* */ }
  t.ok(`the run finished without throwing (${e instanceof Error ? e.message.split('\n')[0] : e})`, false)
} finally {
  await browser.close()
  stopServer(server)
}
const good = t.finish(`Balances brought forward: read in the browser, matched, totalled, and sent by cell.
Screenshots in ${OUT}.`)
process.exit(good ? 0 : 1)

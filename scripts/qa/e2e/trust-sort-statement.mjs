/**
 * TO SORT AND THE BANK STATEMENT, IN A REAL BROWSER (S7).
 *
 * The firm, 13 Oct: "there's a tab for overpayments and then there's another tab for exceptions ...
 * I don't know where we can see the suspense account", and "keeping an historical statement of the
 * trust on Raptor ... every single transaction ... so we don't need to go into the bank". This holds
 * that To sort carries suspense, statement lines, overpayments and the rest on one page under one menu
 * item; that the old Overpayments address still opens; and that the statement lists every line with
 * what it was, searchable and filterable, with its totals.
 *
 * Run: node scripts/qa/e2e/trust-sort-statement.mjs
 */
import { OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('trust-sort-statement')
const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator', team_id: null }
const plain = (x) => x.split(String.fromCharCode(0xa0)).join(' ')
const STATEMENT = [
  { id: 's1', txn_date: '2026-09-11', amount: -12543.05, balance: 24750, description: 'INTERNET TRF TO BREDELL FERREIRA BUSINESS BF FEES-2609', direction: 'debit', reference: null, status: 'allocated', what: 'Transfer to the business account', case_number: null, account_id: null, run_id: null, run_invoice: null },
  { id: 's2', txn_date: '2026-08-20', amount: -1000, balance: 37293.05, description: 'RETURNED DEBIT SBB/2003 ZULU INSUFFICIENT FUNDS', direction: 'debit', reference: null, status: 'allocated', what: 'Returned unpaid', case_number: 'RAP-124300', account_id: 'a1', run_id: null, run_invoice: null },
  { id: 's3', txn_date: '2026-08-15', amount: 1000, balance: 38293.05, description: 'FNB APP PAYMENT FROM SBB/2003 ZULU', direction: 'credit', reference: 'SBB/2003', status: 'allocated', what: 'Debtor’s payment', case_number: 'RAP-124300', account_id: 'a1', run_id: null, run_invoice: null },
  { id: 's4', txn_date: '2026-08-22', amount: 750, balance: 39043.05, description: 'CAPITEC P NAIDOO', direction: 'credit', reference: null, status: 'unallocated', what: 'Needs an account', case_number: null, account_id: null, run_id: null, run_invoice: null },
]
const handlers = [
  [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
  [(u) => /\/rpc\/trust_bank_statement/.test(u), () => ({ body: STATEMENT })],
  [(u) => /\/rpc\/unallocated_receipts/.test(u), () => ({ body: [{ id: 's4', txn_date: '2026-08-22', amount: 750, description: 'CAPITEC P NAIDOO', reference: null, bank_account: '1', imported_at: '2026-10-13T06:00:00Z', had_reference: false },
    /* S18: a long one with a reference that matched two accounts -- what pushed the page sideways on the iPad. */
    { id: 's5', txn_date: '2026-08-23', amount: 1113.2, description: 'ADT CASH DEPO00447001 DLZ0008 CAPITEC RSW1266 FNB APP PAYMENT FROM SEA0001', reference: 'DLZ0008', bank_account: '1', imported_at: '2026-10-13T06:00:00Z', had_reference: true }] })],
  [(u) => /\/rest\/v1\//.test(u), () => ({ body: [] })],
  [(u) => /\/rpc\//.test(u), () => ({ body: [] })],
]

const server = await startServer()
const browser = await chromium.launch()
try {
  const { context, page } = await signedInPage(browser, ADMIN, handlers, [])
  await page.goto(`http://127.0.0.1:${PORT}/trust/exceptions`, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('to-sort').waitFor({ timeout: 20000 })
  const body = plain(await page.locator('main').innerText())
  /* Read the section headings, not the body: the chips at the top name the same sections first. */
  const heads = (await page.locator('[data-testid="to-sort"] h2').allInnerTexts()).map(plain)
  const want = ['Suspense', 'Statement lines to allocate', 'Overpayments', 'Anything else holding a payover up']
  const at = want.map((h) => heads.findIndex((x) => x.startsWith(h)))
  t.ok(`To sort carries suspense, statement lines, overpayments and the rest, in that order (${JSON.stringify(heads)})`,
    at.every((i) => i >= 0) && at.every((i, k) => k === 0 || at[k - 1] < i))
  t.ok('...the receipt in suspense is on it, to place', /CAPITEC P NAIDOO[\s\S]*Place it/.test(body))
  const rail = page.getByRole('navigation', { name: 'Trust menu' })
  t.check('one menu item, To sort; no Exceptions, no Overpayments', JSON.stringify([
    await rail.getByRole('link', { name: 'To sort', exact: true }).count(),
    await rail.getByRole('link', { name: 'Exceptions', exact: true }).count(),
    await rail.getByRole('link', { name: 'Overpayments', exact: true }).count(),
  ]), '[1,0,0]')
  await t.shot(page, 'trust-to-sort')

  /*
   * THE PAGE NEVER SLIDES SIDEWAYS (S18, 6 Nov). On Stephan's iPad a long bank description made the Needs an account
   * table wider than its card: the page scrolled, the left edge was cut off and Move to suspense sat on the grey.
   * Measured on an iPad-sized window, with the long line in the fixture.
   */
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.waitForTimeout(300)
  /* Any panel the page scrolls in counts, not only the document: the layout scrolls an inner pane, which is what
     slid on the iPad. The tables' own scroll boxes are allowed -- that is where a too-wide table is meant to go. */
  const wide = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => {
    const o = getComputedStyle(el).overflowX
    if (!(o === 'auto' || o === 'scroll')) return false
    if (el.querySelector(':scope > table')) return false
    return el.scrollWidth > el.clientWidth + 1
  }).map((el) => el.tagName + '.' + String(el.className).slice(0, 40)))
  t.ok(`nothing on the page scrolls sideways on an iPad but a table inside its own card (${JSON.stringify(wide)})`, wide.length === 0)
  /* With the menus narrowed, as Stephan works: the whole row fits its card, Move to suspense included. */
  await page.setViewportSize({ width: 1366, height: 900 })
  await page.waitForTimeout(300)
  const inCard = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="move-to-suspense"]')
    const box = document.querySelector('[data-testid="needs-account-scroll"]')
    if (!btn || !box) return null
    return box.scrollWidth <= box.clientWidth + 1 && btn.getBoundingClientRect().right <= box.getBoundingClientRect().right + 1
  })
  t.ok('...and on a laptop the whole row fits its card, Move to suspense included', inCard === true)
  const looks = await page.evaluate(() => {
    const [a, b] = ['move-to-suspense', null].map((id) => id && document.querySelector(`[data-testid="${id}"]`))
    const place = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Place it')
    return a && place ? getComputedStyle(a).borderTopWidth === getComputedStyle(place).borderTopWidth && getComputedStyle(a).textDecorationLine === 'none' : null
  })
  t.ok('...and looks like Place it and Split it: a button, not an underlined link', looks === true)
  await t.shot(page, 'trust-to-sort-ipad')

  await page.goto(`http://127.0.0.1:${PORT}/trust/overpayments`, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('overpayments').waitFor({ timeout: 15000 })
  t.ok('the old Overpayments address still opens', /\/trust\/overpayments/.test(page.url()))

  await page.goto(`http://127.0.0.1:${PORT}/trust/statement`, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('statement-line').first().waitFor({ timeout: 15000 })
  t.check('every line imported is listed', await page.getByTestId('statement-line').count(), 4)
  t.ok('...each with what it was, linked where it belongs', /Returned unpaid · RAP-124300/.test(plain(await page.getByTestId('statement-line').nth(1).innerText())))
  t.ok('...a line not yet placed says so, with where to sort it', /Needs an account · sort it/.test(plain(await page.locator('main').innerText())))
  t.ok('...with totals in and out', /4 lines · in R 1 750\.00 · out R 13 543\.05/.test(plain(await page.getByTestId('statement-sums').innerText())))
  await page.getByLabel('Search the statement').fill('sbb/2003')
  t.check('a search finds the lines by the bank\'s words', await page.getByTestId('statement-line').count(), 2)
  await page.getByLabel('Search the statement').fill('')
  await page.getByLabel('In or out').selectOption('debit')
  t.check('money out only', await page.getByTestId('statement-line').count(), 2)
  await page.getByLabel('In or out').selectOption('all')
  await page.getByLabel('Month').selectOption('2026-09')
  t.check('one month only', await page.getByTestId('statement-line').count(), 1)
  await t.shot(page, 'trust-bank-statement')
  await context.close()
} catch (e) {
  try { const pg = browser.contexts().flatMap((c) => c.pages())[0]; if (pg) await t.shot(pg, 'trust-sort-statement-where-it-stopped') } catch { /* */ }
  t.ok(`the run finished without throwing (${e instanceof Error ? e.message.split('\n')[0] : e})`, false)
} finally {
  await browser.close()
  stopServer(server)
}
const good = t.finish(`To sort holds suspense, lines, overpayments and the rest; the statement lists every line.
Screenshots in ${OUT}.`)
process.exit(good ? 0 : 1)

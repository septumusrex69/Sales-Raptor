/**
 * FIND A PAYMENT, IN A REAL BROWSER (request #18, Raptor H16).
 *
 * Camille: "a month later we receive a POP, the debtor used the wrong reference. Where / how do we check where
 * the payment went?" This holds that the page is reachable from the Trust menu, that an amount typed the way a
 * POP writes it ("R 1 500,00") reaches the database as 1500, that every answer says where the money is now --
 * a moved payment naming the account it went to, an unplaced line pointing at To sort -- and that an amount
 * Raptor cannot read is said rather than searched for as nothing.
 *
 * Run: node scripts/qa/e2e/find-payment.mjs
 */
import { OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('find-payment')
const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator', team_id: null }
const plain = (x) => x.split(String.fromCharCode(0xa0)).join(' ')
const asked = []
const FOUND = [
  { kind: 'payment', id: 'p1', on_day: '2026-09-30', amount: 1500, depositor: 'T MOLEFE', reference: 'ALP00011', bank_words: null,
    state: 'Moved to another account', account_id: 'a11', case_number: 'RAP-125319', account_number: 'ALP00011', debtor: 'Thabo Molefe', client: 'Alianna Pharmacy',
    moved_to_account_id: 'a10', moved_to_case: 'RAP-125318' },
  { kind: 'payment', id: 'p2', on_day: '2026-09-30', amount: 1500, depositor: null, reference: 'RAP-125318', bank_words: null,
    state: 'On the account', account_id: 'a10', case_number: 'RAP-125318', account_number: 'ALP00010', debtor: 'Tumelo Patience Molefe', client: 'Alianna Pharmacy',
    moved_to_account_id: null, moved_to_case: null },
  { kind: 'bank line', id: 'l1', on_day: '2026-09-29', amount: 1500, depositor: null, reference: null, bank_words: 'CAPITEC MOLEFE T',
    state: 'Not on any account yet (To sort)', account_id: null, case_number: null, account_number: null, debtor: null, client: null,
    moved_to_account_id: null, moved_to_case: null },
]
const handlers = [
  [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
  [(u) => /\/rpc\/find_payments/.test(u), (u, req) => { asked.push(req.postDataJSON()); return { body: FOUND } }],
  [(u) => /\/rest\/v1\//.test(u), () => ({ body: [] })],
  [(u) => /\/rpc\//.test(u), () => ({ body: [] })],
]

const server = await startServer()
const browser = await chromium.launch()
try {
  const { context, page } = await signedInPage(browser, ADMIN, handlers, [])
  await page.goto(`http://127.0.0.1:${PORT}/trust`, { waitUntil: 'domcontentloaded' })
  const rail = page.getByRole('navigation', { name: 'Trust menu' })
  await rail.getByRole('link', { name: 'Find a payment', exact: true }).click()
  await page.getByTestId('find-payment-form').waitFor({ timeout: 20000 })
  t.ok('the Trust menu opens Find a payment', /\/trust\/find$/.test(page.url()))

  await page.getByRole('button', { name: 'Find' }).click()
  t.ok('an empty search asks for something instead of searching', /Type an amount, a day or some words/.test(await page.getByTestId('find-payment-error').innerText())
    && asked.length === 0)

  await page.getByLabel('Amount').fill('fifteen hundred')
  await page.getByRole('button', { name: 'Find' }).click()
  t.ok('an amount Raptor cannot read is said, not searched for', /is not an amount Raptor can read/.test(await page.getByTestId('find-payment-error').innerText())
    && asked.length === 0)

  await page.getByLabel('Amount').fill('R 1 500,00')
  await page.getByLabel('Words').fill('molefe')
  await page.getByRole('button', { name: 'Find' }).click()
  await page.getByTestId('found-payment').first().waitFor({ timeout: 10000 })
  t.check('the amount reaches the database the way the POP meant it', JSON.stringify(asked.at(-1)),
    JSON.stringify({ p_amount: 1500, p_from: null, p_to: null, p_words: 'molefe' }))
  const rows = (await page.getByTestId('found-payment').allInnerTexts()).map(plain)
  t.check('every match is listed', rows.length, 3)
  t.ok(`a moved payment names the account it went to (${rows[0]})`, /Moved to another account · RAP-125318/.test(rows[0]) && /RAP-125319 · Thabo Molefe/.test(rows[0]))
  t.ok('...and links to it', await page.getByTestId('found-payment').first().getByRole('link', { name: 'RAP-125318' }).getAttribute('href') === '/accounts/a10')
  t.ok('a payment on an account says so, with whose', /On the account/.test(rows[1]) && /Tumelo Patience Molefe · Alianna Pharmacy/.test(rows[1]))
  t.ok('a line nobody placed points at To sort', /Not on any account yet \(To sort\) · sort it/.test(rows[2]) && /CAPITEC MOLEFE T/.test(rows[2]))
  await t.shot(page, 'find-payment')
  await context.close()
} catch (e) {
  try { const pg = browser.contexts().flatMap((c) => c.pages())[0]; if (pg) await t.shot(pg, 'find-payment-where-it-stopped') } catch { /* */ }
  t.ok(`the run finished without throwing (${e instanceof Error ? e.message.split('\n')[0] : e})`, false)
} finally {
  await browser.close()
  stopServer(server)
}
const good = t.finish(`Find a payment reads the POP's amount, and every answer says where the money is now.
Screenshots in ${OUT}.`)
process.exit(good ? 0 : 1)

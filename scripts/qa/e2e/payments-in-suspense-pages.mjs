/**
 * PAYMENTS IN WITH A BIG SUSPENSE (S19, Raptor H18; Stephan on the iPad, 7 Nov: "very slow and lagging").
 *
 * Two faults, one cause -- 1 805 receipts needing an account on staging:
 *   1. COUNTED SHORT. PostgREST hands back at most 1 000 rows a request and says nothing, so the tile read
 *      "1 000 receipts in suspense" (R 1 473 001.96 of R 2 244 757.51) and the oldest 805 were never listed,
 *      searched or counted. The page now reads every page.
 *   2. DRAWN ALL AT ONCE. Every receipt, with its reference box and four buttons, sat under the approval
 *      queue: ten thousand elements to scroll past on an iPad. Now a hundred, and Show more.
 *
 * The stub answers exactly as Supabase does: never more than 1 000 rows, whatever is asked for.
 *
 * Run: node scripts/qa/e2e/payments-in-suspense-pages.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('payments-in-suspense-pages')
const plain = (x) => x.split(String.fromCharCode(0xa0)).join(' ')
const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator', team_id: null }
const N = 1805
const day = (i) => `2026-${String(10 - Math.floor(i / 400)).padStart(2, '0')}-${String(28 - (i % 28)).padStart(2, '0')}`
const RECEIPTS = Array.from({ length: N }, (_, i) => ({
  id: `r-${String(i).padStart(4, '0')}`, txn_date: day(i), amount: 100, description: i === N - 1 ? 'OLDEST ONE MOKOENA' : `DEPOSIT ${i}`,
  reference: null, bank_account: '627', imported_at: '2026-10-13T06:50:39Z', had_reference: false,
}))
/* PostgREST's cap, as the server applies it: the asked-for window, cut to a thousand. */
function capped(url, rows) {
  const q = new URL(url).searchParams
  const offset = Number(q.get('offset') ?? 0)
  const limit = Math.min(Number(q.get('limit') ?? 1000), 1000)
  return rows.slice(offset, offset + limit)
}
const handlers = [
  [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
  [(u) => /\/rpc\/unallocated_receipts/.test(u), (u) => ({ body: capped(u, RECEIPTS) })],
  [(u) => /\/rest\/v1\//.test(u), () => ({ body: [] })],
  [(u) => /\/rpc\//.test(u), () => ({ body: [] })],
]

const server = await startServer()
const browser = await chromium.launch()
try {
  const { context, page } = await signedInPage(browser, ADMIN, handlers, [])
  /* S21: suspense lives on To sort, a tile that opens (Stephan: "you click on the suspense and it opens it"); a link
     naming #suspense opens it already. */
  await page.goto(`http://127.0.0.1:${PORT}/trust/exceptions#suspense`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-testid="needs-account-scroll"] tbody tr').first().waitFor({ timeout: 20000 })

  const tile = plain(await page.getByTestId('suspense-tile').innerText())
  t.ok(`the tile counts every receipt, not the first thousand (${tile.match(/[\d ]+ receipts? with no account/)?.[0]})`, /1 805 receipts with no account yet/.test(tile))
  t.ok('...and adds up every one of them', /R 180 500\.00/.test(tile))

  const rows = () => page.locator('[data-testid="needs-account-scroll"] tbody tr').count()
  t.check('a hundred receipts are drawn, not all of them', await rows(), 100)
  t.ok('...and it says how many there are', /Showing 100 of 1 805/.test(plain(await page.getByTestId('receipts-more').innerText())))
  await page.getByTestId('receipts-more').getByRole('button', { name: /Show 100 more/ }).click()
  t.check('Show 100 more draws the next hundred', await rows(), 200)

  /* The oldest receipt was the 1 805th -- past the cap, so before this nothing could find it. */
  await page.getByLabel('Search suspense').fill('MOKOENA')
  await page.waitForTimeout(300)
  t.check('the search finds the oldest receipt, beyond the first thousand', await rows(), 1)
  t.check('...and has nothing more to show', await page.getByTestId('receipts-more').count(), 0)
  await page.getByLabel('Search suspense').fill('')
  await page.waitForTimeout(300)
  t.check('a new search starts again at the first hundred', await rows(), 100)

  await page.getByTestId('receipts-more').getByRole('button', { name: 'Show all' }).click()
  t.check('Show all draws every one', await rows(), N)
  await context.close()
} catch (e) {
  t.ok(`the run finished without throwing (${e instanceof Error ? e.message.split('\n')[0] : e})`, false)
} finally {
  await browser.close()
  stopServer(server)
}
process.exit(t.finish() ? 0 : 1)

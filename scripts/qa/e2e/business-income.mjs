/**
 * INCOME AND DRAWINGS, IN A REAL BROWSER.
 *
 * check-business-income holds the SQL and the predicates. What only a browser sees: that an
 * Administrator -- who has everything else -- is NOT shown Income ("not even for an administrator"),
 * that the address alone does not open it, that it appears once the tick is granted and its parts add
 * to its total on the page, and that Drawings sends draw_from_trust what was typed and refuses in the
 * box what the database would refuse.
 *
 * Run: node scripts/qa/e2e/business-income.mjs
 */
import { OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('business-income')
const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator', team_id: null }
const OWNER = { ...ADMIN, grants: ['business.income'] }

const INCOME = [
  { company_id: 'c1', company_name: 'Kestrel Insurance', interest: 0, costs: 115, commission: 177,
    commission_vat: 26.55, credit_taken: 7, charges_raised: 115, other: 3, total: 443.55 },
  { company_id: 'c2', company_name: 'Rinda Roo', interest: 10, costs: 0, commission: 0,
    commission_vat: 0, credit_taken: 0, charges_raised: 0, other: 0, total: 10 },
]
const MONTH = [{ earned: 338.55, drawn: 20, still_in_trust: 358.55, invoiced: 115, invoices_paid: 0,
  owed_by_clients: 115, expenses: 0, expenses_vat: 0, made: 453.55 }]

let sent = []
function handlers(me) {
  return [
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [me] })],
    [(u) => /\/rpc\/business_income/.test(u), () => ({ body: INCOME })],
    [(u) => /\/rpc\/business_month/.test(u), () => ({ body: MONTH })],
    [(u) => /\/rpc\/business_drawings/.test(u), () => ({
      body: [{ id: 'd1', entry_at: '2026-10-07T08:00:00Z', amount: 20, reference: 'EFT 0042', drawn_by: 'Stephan' }],
    })],
    [(u) => /\/rpc\/draw_from_trust/.test(u), (u, req) => { sent.push(req.postDataJSON()); return { body: 'x' } }],
    [(u) => /\/rest\/v1\//.test(u), () => ({ body: [] })],
    [(u) => /\/rpc\//.test(u), () => ({ body: [] })],
  ]
}
async function open(browser, me, path) {
  const { context, page } = await signedInPage(browser, me, handlers(me), [])
  await page.goto(`http://127.0.0.1:${PORT}${path}`, { waitUntil: 'domcontentloaded' })
  return { context, page }
}

const server = await startServer()
const browser = await chromium.launch()
try {
  /* ---------------- an Administrator, without the tick ---------------- */
  {
    const { context, page } = await open(browser, ADMIN, '/business/income')
    /* THE ADDRESS ALONE DOES NOT OPEN IT: back to the overview. */
    await page.waitForURL((u) => u.pathname === '/business', { timeout: 20000 })
    t.ok('an Administrator typing the address is sent back to the overview', true)
    await page.getByRole('link', { name: 'Drawings' }).first().waitFor({ timeout: 20000 })
    t.check('...and is not shown Income in the rail', await page.getByRole('link', { name: 'Income' }).count(), 0)

    await page.getByRole('link', { name: 'Drawings' }).first().click()
    await page.getByTestId('held-for-firm').waitFor({ timeout: 20000 })
    t.ok('Drawings says what the firm may draw', /358[\s,.]55|358.55/.test(await page.getByTestId('held-for-firm').innerText()))
    t.ok('...and lists the month\'s drawings', await page.getByText('EFT 0042').first().isVisible())

    await page.getByRole('button', { name: 'Draw to the business account' }).click()
    const go = page.getByRole('button', { name: 'Record the drawing' })
    await page.getByLabel('Amount').fill('400')
    await page.getByLabel(/Which transfer this is/).fill('BF-OCT-01')
    /* MORE THAN IS EARNED IS SOMEBODY ELSE'S MONEY, and the box says so before the database has to. */
    t.ok('more than the firm holds is refused in the box', await go.isDisabled())
    t.ok('...and says why', await page.getByText(/somebody else’s money/).first().isVisible())
    await page.getByLabel('Amount').fill('300')
    await go.click()
    await page.waitForTimeout(400)
    t.check('a drawing calls draw_from_trust once', sent.length, 1)
    t.check('...with the amount', sent[0]?.p_amount, 300)
    t.check('...and the transfer it names', sent[0]?.p_reference, 'BF-OCT-01')
    await t.shot(page, 'business-drawings')
    await context.close()
  }

  /* ---------------- the trust tick taken away: no button ---------------- */
  {
    const { context, page } = await open(browser, { ...ADMIN, revokes: ['finance.view'] }, '/business/drawings')
    await page.getByTestId('held-for-firm').waitFor({ timeout: 20000 })
    t.check('without the trust tick there is no button to draw',
      await page.getByRole('button', { name: 'Draw to the business account' }).count(), 0)
    t.ok('...and the page says what is missing', await page.getByText(/needs the trust account tick/).first().isVisible())
    await context.close()
  }

  /* ---------------- given the tick ---------------- */
  {
    const { context, page } = await open(browser, OWNER, '/business/income')
    await page.getByTestId('income-total').waitFor({ timeout: 20000 })
    t.ok('with business.income the rail lists Income', await page.getByRole('link', { name: 'Income' }).first().isVisible())
    t.ok('...and the month totals the clients', /453[\s,.]55|453.55/.test(await page.getByTestId('income-total').innerText()))
    t.ok('...naming each client', await page.getByText('Kestrel Insurance').first().isVisible())
    t.ok('...and says VAT on commission is not kept', await page.getByText('Collected for SARS, not kept').first().isVisible())
    await t.shot(page, 'business-income')
    await context.close()
  }
} catch (e) {
  t.ok(`the run finished without throwing (${String(e).split('\n')[0].slice(0, 160)})`, false)
  try {
    const pages = browser.contexts().flatMap((c) => c.pages())
    if (pages[0]) await t.shot(pages[0], 'business-income-where-it-stopped')
  } catch { /* nothing more to learn */ }
} finally {
  await browser.close()
  stopServer(server)
}

const good = t.finish(`Income is hidden from an Administrator until granted and adds up when shown; Drawings
sends what was typed and refuses more than the firm holds. Screenshots in ${OUT}.`)
process.exit(good ? 0 : 1)

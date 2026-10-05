/**
 * THE ADMINISTRATOR'S CHECK OF A POSTED RECEIPT, IN A REAL BROWSER.
 *
 * THE FIRM: "you can add whatever you need for the administrator to ensure that we can double
 * check every single thing that comes in."
 *
 * WHY SOURCE CANNOT ANSWER THIS. The checks beside this folder can say the rules are run and the
 * spans add up; they cannot say the opened panel appeared, or that the three sections widened the
 * table when somebody clicked a heading. CLAUDE.md names the failure this layer exists for: a
 * panel shipped, was provably in the bundle, and was invisible. This screen's whole value is that
 * an administrator can SEE the arithmetic, so "it rendered" is the assertion.
 *
 * THE TWO ROWS ARE THE TWO CASES THAT MATTER.
 *
 *   The first is RRC00007's R2 500 as the engine actually posted it, read out of staging: every
 *   formula holds, and the screen has to say so rather than say nothing -- "nothing wrong" and
 *   "nothing checked" must not look the same.
 *
 *   The second is the same receipt with ONE figure moved: the client paid R900 instead of
 *   R805,98. Nothing about the row looks unusual; it is only wrong against the formula. If the
 *   screen cannot surface that, it is decoration.
 *
 * AND A THIRD, WHICH IS THE ONE THAT WOULD HAVE EMBARRASSED THE FIRM: an allocation posted by the
 * old engine, which recorded none of the figures the formulas need. Every rule that subtracts one
 * of them would fire on a payment that was correct when it was made, so the screen must show it
 * and NOT call it broken.
 *
 * Run: node scripts/qa/e2e/check-payments.mjs
 */
import { OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('check-payments')

const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator' }

/*
 * RRC00007's R2 500, AS THE ENGINE POSTED IT. Not figures invented to satisfy the screen -- these
 * came out of a real allocate_payment on staging, in a transaction that rolled back, and every one
 * of them was checked against preview_allocation on the way past.
 */
const GOOD = {
  payment_id: 'pay-7', allocation_id: 'alloc-7', account_id: 'acct-7',
  case_number: 'RAP-123856', account_number: 'RRC00007',
  debtor: 'Lebo Swakamisa', client: 'Rinda Roo Company',
  received_on: '2026-10-05', approved_on: '2026-10-05', approved_by_name: 'Stephan',
  amount: 2500, paid_to_client: false, method: 'EFT', reference: 'RRC00007',
  bank_description: 'FNB APP PAYMENT FROM  RRC00007', source: 'bank_import',
  status: 'allocated', engine_version: 'v2-5050-split', computed_at: '2026-10-05T08:10:00Z',
  run_invoice: 'BF-2026-10-001', run_status: 'paid', run_paid_on: '2026-10-07',
  reversed_on: null, reversal_reason: null,
  receipt_fee_excl: 250, receipt_fee_vat: 37.5,
  to_interest: 15.32, to_receipt_fees: 287.5, to_fees: 554.89, to_costs: 842.39,
  to_capital: 1230.5, excess: 411.79,
  commission: 369.15, commission_vat: 55.37, to_client: 805.98, due_to_bf: 0,
  commission_rate: 0.3, vat_rate: 0.15,
  interest_total: 15.32, interest_cant: 0, interest_retained: 0,
  interest_before: 15.32, interest_after: 0,
  rf_total: 287.5, rf_cant: 0, rf_retained: 0,
  fees_total: 554.89, fees_cant: 0, fees_retained: 0,
  costs_before: 554.89, costs_after: 0,
  capital_before: 1230.5, capital_after: 0,
  fees_raised: 842.39, interest_posted: 15.32, payments_banked: 2500,
}

/* THE SAME RECEIPT WITH THE CLIENT PAID THE WRONG FIGURE. One number, and nothing else about the
   row gives it away. */
const BAD = {
  ...GOOD,
  payment_id: 'pay-2', allocation_id: 'alloc-2', account_id: 'acct-2',
  case_number: 'RAP-123851', account_number: 'RRC00002', debtor: 'Alianna Lubuschangne',
  to_client: 900,
  run_invoice: null, run_status: null, run_paid_on: null,
}

/* AND ONE THE OLD ENGINE WROTE: the two fee-split columns are nought and the thirteen
   before-figures are null, because neither existed when it posted. */
const OLD = {
  ...GOOD,
  payment_id: 'pay-1', allocation_id: 'alloc-1', account_id: 'acct-1',
  case_number: 'RAP-123850', account_number: 'RRC00001', debtor: 'Nathi Kibido',
  amount: 300, engine_version: 'v1-5050',
  to_interest: 10.28, to_receipt_fees: 0, to_fees: 0, to_costs: 139.72,
  to_capital: 150, excess: 0, commission: 45, commission_vat: 6.75, to_client: 98.25,
  receipt_fee_excl: 30, receipt_fee_vat: 4.5,
  interest_total: null, interest_cant: null, interest_retained: null,
  interest_before: null, interest_after: null,
  rf_total: null, rf_cant: null, rf_retained: null,
  fees_total: null, fees_cant: null, fees_retained: null,
  costs_before: null, costs_after: null,
  capital_before: 770.45, capital_after: 620.45,
  run_invoice: null, run_status: null, run_paid_on: null,
}

async function openCheck(browser, rows) {
  const handlers = [
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
    [(u) => /\/rest\/v1\/firm_settings/.test(u),
      () => ({ body: [{ firm_name: 'Bredell Ferreira', vat_rate: 0.15 }] })],
    [(u) => /\/rpc\/payments_posted/.test(u), () => ({ body: rows })],
    [(u) => /\/rpc\//.test(u), () => ({ body: [] })],
  ]
  const { context, page } = await signedInPage(browser, ADMIN, handlers, [])
  await page.goto(`http://127.0.0.1:${PORT}/finance/check`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('table', { timeout: 15000 })
  return { context, page }
}

const server = await startServer()
const browser = await chromium.launch()
try {
  /* ------------------------------------------------------------------ the three of them together */
  {
    const { context, page } = await openCheck(browser, [GOOD, BAD, OLD])

    const rows = await page.locator('tbody tr').count()
    t.check('all three receipts are drawn', rows, 3)

    const band = (await page.locator('text=/do not obey the allocation formulas/').count()) > 0
    t.ok('the band names how many do not add up', band)
    const bandText = await page.locator('p:has-text("do not obey")').first().innerText()
    t.ok('and it is one of three, not two or three',
      /1 of 3 do not obey/.test(bandText))
    /* AND IT SAYS THE OLD ONE IS NOT CHECKED, rather than counting it as a pass or a failure. */
    t.ok('and it says the older one was not checked', /posted before Raptor recorded the figures/.test(bandText))

    /* THE ROW ITSELF CARRIES THE MARK, because a morning with more than four needs the rest
       findable and the row is where somebody is already looking. */
    const marks = await page.locator('tbody tr svg.lucide-triangle-alert').count()
    t.ok('the row that does not add up is marked', marks >= 1)

    /* THE FEE SECTIONS OPEN. This is the firm's own instruction and it is a click, so it is the
       half no source check can see. */
    const before = await page.locator('thead tr').nth(1).locator('th').count()
    await page.getByRole('button', { name: /Interest taking/i }).click()
    await page.waitForTimeout(150)
    const after = await page.locator('thead tr').nth(1).locator('th').count()
    t.check('opening a section adds its four figures and its after column', after - before, 5)
    t.ok('and the figures behind it are named', (await page.locator('th:has-text("Interest ceiling refuses")').count()) > 0)
    t.ok('...including what the ceiling refuses',
      (await page.locator('th:has-text("Interest available")').count()) > 0)

    /*
     * AND THE GROUP HEADINGS STILL LINE UP OVER THE RIGHT COLUMNS. This is the one failure a
     * source check reports as a number and a person reads as the wrong figure under the wrong
     * word, so it is measured here in the rendered table: the spans must add to the cells.
     */
    const spans = await page.locator('thead tr').first().locator('th').evaluateAll(
      (ths) => ths.map((th) => Number(th.getAttribute('colspan') ?? 1)))
    const cells = await page.locator('thead tr').nth(1).locator('th').count()
    t.check('the group headings cover exactly the columns beneath them',
      spans.reduce((n, x) => n + x, 0), cells)

    await page.screenshot({ path: `${OUT}/check-payments-list.png`, fullPage: true })
    await context.close()
  }

  /* ------------------------------------------------------------------ one receipt, end to end */
  {
    const { context, page } = await openCheck(browser, [GOOD])

    t.ok('a clean list says so rather than saying nothing',
      (await page.locator('text=/All 1 obey every allocation formula/').count()) > 0)

    await page.locator('tbody tr').first().locator('button').first().click()
    await page.waitForTimeout(200)

    for (const heading of ['Where it came from', 'What it did', 'Whether it holds', 'The account today']) {
      t.ok(`the opened receipt shows "${heading}"`,
        (await page.locator(`text=${heading}`).count()) > 0)
    }
    /* BELOW THE TABLE, NOT INSIDE IT -- see the comment on the screen. A panel in a colSpan cell
       takes the table's width, and this table is wider than the window, so the verdict column was
       drawn off the right-hand edge. */
    const panel = await page.locator('[data-check-panel]').innerText()
    t.ok('it says every formula holds', /Every formula holds/.test(panel))
    /* THE THREE FIGURES THE FIRM WOULD CHECK BY HAND, written out as sums rather than as answers. */
    /* THE FIRM'S OWN FORMAT: a dot decimal, thousands grouped with a non-breaking space. The
       first version of this assertion looked for "2 500,00" with a comma -- en-ZA's own shape, but
       not the one the firm asked Raptor for, and money.ts says so at length. */
    t.ok('and writes the accounting out as a sum',
      /2\u00a0500\.00/.test(panel) && /Fees \+ capital \+ credit/.test(panel))
    t.ok('it names who approved it', /Stephan/.test(panel))
    t.ok('it says where the client’s money got to', /Paid/.test(await page.locator('tbody tr').first().innerText()))

    await page.screenshot({ path: `${OUT}/check-payments-opened.png`, fullPage: true })
    await context.close()
  }

  /* ------------------------------------------------------------------ the one that is wrong */
  {
    const { context, page } = await openCheck(browser, [BAD])
    await page.locator('tbody tr').first().locator('button').first().click()
    await page.waitForTimeout(200)
    /* BELOW THE TABLE, NOT INSIDE IT -- see the comment on the screen. A panel in a colSpan cell
       takes the table's width, and this table is wider than the window, so the verdict column was
       drawn off the right-hand edge. */
    const panel = await page.locator('[data-check-panel]').innerText()
    t.ok('the wrong one names the formula that broke',
      /The client is paid capital less commission and its VAT/.test(panel))
    /*
     * AND WRITES THE ARITHMETIC OUT, because "the figures do not balance" is a screen nobody can
     * act on and "1 230.50 - 369.15 - 55.37 = 805.98, got 900.00" is one somebody can.
     *
     * THE FIRM'S FORMAT IS A DOT DECIMAL with thousands grouped by a non-breaking space -- their
     * own instruction for the Finance module, which money.ts carries. The detail line used
     * `toFixed(2)` and printed "1230.50" beside "R 1 230.50" in the next column; it goes through
     * the one formatter now, which is why this reads "1 230.50" with U+00A0 in it.
     */
    t.ok('...and writes out what it expected against what it got',
      /805\.98/.test(panel) && /900\.00/.test(panel) && /1\u00a0230\.50/.test(panel))
    await context.close()
  }

  /* ------------------------------------------------------------------ the one from the old engine */
  {
    const { context, page } = await openCheck(browser, [OLD])
    t.ok('an older allocation is not reported as broken', (await page.locator('text=/do not obey the allocation formulas/').count()) === 0)
    const row = await page.locator('tbody tr').first().innerText()
    t.ok('and the row says it was not checked', /not checked/.test(row))
    await page.locator('tbody tr').first().locator('button').first().click()
    await page.waitForTimeout(200)
    /* BELOW THE TABLE, NOT INSIDE IT -- see the comment on the screen. A panel in a colSpan cell
       takes the table's width, and this table is wider than the window, so the verdict column was
       drawn off the right-hand edge. */
    const panel = await page.locator('[data-check-panel]').innerText()
    t.ok('the panel explains why rather than accusing it', /did not record what the split was computed against/.test(panel))
    t.ok('...and says it is not being called wrong', /not being called wrong/.test(panel))
    await context.close()
  }
} finally {
  await browser.close()
  stopServer(server)
}

const good = t.finish(
  `The administrator's check of a posted receipt, in a real browser. Three receipts: one the engine
posted correctly, one with a single figure moved, and one from the old engine that recorded none of
the figures the formulas need. The screen has to say so in three different ways -- "every formula
holds", the named rule with the arithmetic written out, and "not checked" rather than "wrong" --
and the fee sections have to open when a heading is clicked, which is the half no source check
can see.`)
process.exit(good ? 0 : 1)

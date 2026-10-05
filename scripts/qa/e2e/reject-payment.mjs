/**
 * THROWING A RECEIPT OUT OF THE APPROVAL QUEUE, IN A REAL BROWSER.
 *
 * THE FIRM: "there are no way to reject payments that are imported. From an import sheet... so
 * there's some ones waiting in the queue to be approved, but I don't want to approve them. I want
 * to start throwing things in."
 *
 * WHY SOURCE CANNOT ANSWER THIS. check-reject-payment can say the functions refuse what they
 * should and the screen contains the words; it cannot say the box opened, that the reason really
 * gates the button, that the question about the statement line is asked for a bank receipt and not
 * for one captured by hand, or that the strip with the undo is still on the page once the queue is
 * empty. CLAUDE.md names the failure this layer exists for: a panel shipped, was provably in the
 * bundle, and was invisible.
 *
 * THE THREE RECEIPTS ARE THE THREE CASES THE BOX HAS TO TELL APART.
 *
 *   TWO OFF A STATEMENT, so the question about the line is asked and "all 2" is the wording.
 *   ONE CAPTURED BY HAND, which has no line at all -- asking where its line should go would be a
 *   question about nothing, and offering it suggests the firm is deciding something they are not.
 *
 * AND AN EMPTY QUEUE WITH A REJECTION BEHIND IT, which is where "throwing things in" actually
 * ends: the undo has to still be on the screen, and the line must not claim everything was
 * approved.
 *
 * Run: node scripts/qa/e2e/reject-payment.mjs
 */
import { OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('reject-payment')

const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator' }

/*
 * A RECEIPT WAITING, WITH THE FIGURES THE PREVIEW WOULD POST. These are a real R2 500 split off
 * staging rather than numbers invented to fill the row -- the screen runs every allocation rule
 * over what it is given, and a row that failed them would draw a warning this file is not about.
 */
const WAITING = {
  payment_id: 'pay-a', account_id: 'acct-a',
  case_number: 'RAP-123856', account_number: 'RRC00007',
  debtor: 'Lebo Swakamisa', client: 'Rinda Roo Company',
  received_on: '2026-10-05', amount: 2500, paid_to_client: false,
  method: 'EFT', reference: 'RRC00007', details: null, source: 'bank_import',
  receipt_fee: 250, receipt_fee_vat: 37.5,
  to_interest: 15.32, to_costs: 842.39, to_capital: 1230.5, excess: 411.79,
  commission: 369.15, commission_vat: 55.37, to_client: 805.98, due_to_bf: 0,
  has_rate: true, capital_before: 1230.5, capital_after: 0,
  /* OFF A STATEMENT, so the box asks where the line should go. */
  bank_line_id: 'line-a', bank_description: 'FNB APP PAYMENT FROM  RRC00007',
  came_back_from: null, came_back_reason: null, came_back_on: null,
  interest_to_date: 15.32, interest_after: 0, interest_open: 0, interest_open_from: null,
  interest_total: 15.32, interest_cant: 0, interest_retained: 0,
  rf_total: 287.5, rf_cant: 0, rf_retained: 0, to_receipt_fees: 287.5,
  fees_total: 554.89, fees_cant: 0, fees_retained: 0, to_fees: 554.89,
  costs_before: 554.89, costs_after: 0,
  commission_rate: 0.3, vat_rate: 0.15,
}

const SECOND = {
  ...WAITING,
  payment_id: 'pay-b', account_id: 'acct-b',
  case_number: 'RAP-123851', account_number: 'RRC00002', debtor: 'Alianna Lubuschangne',
  bank_line_id: 'line-b', bank_description: 'CAPITEC  L SOLOMONS',
}

/* AND ONE CAPTURED BY HAND: no bank line, so there is nothing to ask about. */
const BY_HAND = {
  ...WAITING,
  payment_id: 'pay-c', account_id: 'acct-c',
  case_number: 'RAP-123850', account_number: 'RRC00001', debtor: 'Nathi Kibido',
  source: 'manual', bank_line_id: null, bank_description: null,
}

/* WHAT payments_rejected GIVES BACK for one already thrown out. `line_status` is what the strip
   turns into "back on the unallocated list", which is the next thing somebody has to act on. */
const ALREADY = {
  payment_id: 'pay-z', account_id: 'acct-z',
  case_number: 'RAP-123844', account_number: 'RRC00004',
  debtor: 'Pieter Smit', client: 'Rinda Roo Company',
  received_on: '2026-10-04', amount: 410, reference: 'RRC00004',
  bank_description: 'ABSA  SMIT P', source: 'bank_import',
  rejected_on: '2026-10-05', rejected_at: '2026-10-05T09:12:00Z',
  rejected_by_name: 'Stephan', rejection_reason: 'Duplicate of the receipt on the 3rd',
  line_status: 'unallocated', bank_line_id: 'line-z',
}

async function openQueue(browser, { waiting, rejected = [], onReject = null }) {
  const calls = []
  const handlers = [
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
    [(u) => /\/rest\/v1\/firm_settings/.test(u),
      () => ({ body: [{ firm_name: 'Bredell Ferreira', vat_rate: 0.15 }] })],
    [(u) => /\/rpc\/payments_awaiting_approval/.test(u), () => ({ body: waiting })],
    [(u) => /\/rpc\/payments_rejected/.test(u), () => ({ body: rejected })],
    [(u) => /\/rpc\/reject_payments/.test(u), (_u, req) => {
      calls.push(JSON.parse(req.postData() ?? '{}'))
      return { body: [{ rejected: onReject?.length ?? 1, skipped: 0, problems: [] }] }
    }],
    [(u) => /\/rpc\/unreject_payment/.test(u), (_u, req) => {
      calls.push({ unreject: JSON.parse(req.postData() ?? '{}') })
      return { body: null }
    }],
    [(u) => /\/rpc\//.test(u), () => ({ body: [] })],
  ]
  const { context, page } = await signedInPage(browser, ADMIN, handlers, [])
  await page.goto(`http://127.0.0.1:${PORT}/finance`, { waitUntil: 'domcontentloaded' })
  return { context, page, calls }
}

const server = await startServer()
const browser = await chromium.launch()
try {
  /* ------------------------------------------------------- two off a statement and one by hand */
  {
    const { context, page, calls } = await openQueue(browser, {
      waiting: [WAITING, SECOND, BY_HAND], rejected: [ALREADY],
    })
    await page.waitForSelector('text=Payments waiting for you', { timeout: 15000 })

    /*
     * COUNTED BY THE ROWS THAT CAN BE TICKED, not by `tbody tr`. This screen carries more than one
     * table and the queue's own has a totals row, so a bare row count was four for three receipts
     * -- and would have been four for two as well.
     */
    t.check('all three are waiting',
      await page.locator('tbody tr:has(input[type=checkbox])').count(), 3)

    /* THE UNDO IS ON THE PAGE, with the reason and where the line went. This is the panel a
       source check cannot see. */
    t.ok('what was thrown out today is on the screen',
      (await page.locator('text=/Rejected today · 1/').count()) > 0)
    const strip = await page.locator('li:has-text("Put it back")').first().innerText()
    t.ok('...with the reason it was thrown out', /Duplicate of the receipt on the 3rd/.test(strip))
    t.ok('...and what somebody has to do about the line next',
      /back on the unallocated list/.test(strip))

    /* ---- one row on its own ---- */
    await page.locator('tbody tr').first().getByRole('button', { name: /^Reject$/ }).click()
    await page.waitForSelector('text=Reject this receipt', { timeout: 5000 })
    t.ok('one row opens a box about one receipt',
      (await page.locator('text=Reject this receipt').count()) > 0)
    t.ok('...and it says nothing is deleted',
      (await page.locator('text=/Nothing is deleted/').count()) > 0)

    /*
     * THE REASON REALLY GATES THE BUTTON. A disabled attribute in the source is not the same as a
     * button a person cannot press, and this is the half that matters: the database refuses a
     * blank reason, and finding that out after a round trip is how somebody types "x".
     */
    const go = page.getByRole('button', { name: /^Reject it$/ })
    t.ok('the button is dead before a reason is typed', await go.isDisabled())
    await page.locator('textarea').first().fill('Duplicate of the one on the 3rd')
    t.ok('...and alive after', await go.isEnabled())

    /* AND THE QUESTION ABOUT THE STATEMENT LINE IS ASKED, because this one came off a statement. */
    t.ok('a bank receipt is asked where its line should go',
      (await page.locator('text=/And the statement line\\?/').count()) > 0)
    t.ok('...with "back on the unallocated list" the default',
      await page.locator('input[type=radio]').first().isChecked())

    await go.click()
    await page.waitForTimeout(300)
    const one = calls.find((c) => c.p_payments)
    t.check('the reason reaches the database', one?.p_reason, 'Duplicate of the one on the 3rd')
    t.check('...for that one receipt', one?.p_payments?.join(','), 'pay-a')
    t.check('...and the line goes back on the unallocated list', one?.p_not_a_receipt, false)

    await t.shot(page, 'reject-payment-queue')
    await context.close()
  }

  /* ------------------------------------------------- a hand-captured receipt has no line to ask about */
  {
    const { context, page } = await openQueue(browser, { waiting: [BY_HAND] })
    await page.waitForSelector('text=Payments waiting for you', { timeout: 15000 })
    await page.locator('tbody tr').first().getByRole('button', { name: /^Reject$/ }).click()
    await page.waitForSelector('text=Reject this receipt', { timeout: 5000 })

    /*
     * NO QUESTION AT ALL. A receipt captured by hand has no statement line, so "and the statement
     * line?" would be a question about nothing -- and asking it suggests the firm is deciding
     * something they are not.
     */
    t.check('a hand-captured receipt is asked nothing about a line',
      await page.locator('text=/And the statement line\\?/').count(), 0)
    t.check('...and there are no radio buttons to get wrong',
      await page.locator('input[type=radio]').count(), 0)
    await context.close()
  }

  /* ------------------------------------------------------------- many at once, and not a receipt */
  {
    const { context, page, calls } = await openQueue(browser, { waiting: [WAITING, SECOND] })
    await page.waitForSelector('text=Payments waiting for you', { timeout: 15000 })

    /* TICK BOTH AND THROW THEM OUT TOGETHER -- the firm clears a morning's list, and one reason
       covers the lot. */
    for (const box of await page.locator('tbody input[type=checkbox]').all()) await box.check()
    await page.getByRole('button', { name: /^Reject 2$/ }).click()
    await page.waitForSelector('text=Reject 2 receipts', { timeout: 5000 })
    t.ok('two ticked opens a box about two', true)
    t.ok('...and the line question is plural',
      (await page.locator('text=/And the statement lines\\?/').count()) > 0)

    await page.locator('textarea').first().fill('Our own transfer, the import misread it')
    /* THE SECOND ANSWER: not a debtor receipt at all, so the line leaves both lists rather than
       coming back every morning. */
    await page.locator('input[type=radio]').nth(1).check()
    await page.getByRole('button', { name: /^Reject all 2$/ }).click()
    await page.waitForTimeout(300)

    const many = calls.find((c) => c.p_payments)
    t.check('both receipts go in one call', many?.p_payments?.join(','), 'pay-a,pay-b')
    t.check('...and the line is marked as not a receipt', many?.p_not_a_receipt, true)
    await context.close()
  }

  /* --------------------------------------------- the queue empties, and the undo is still there */
  {
    const { context, page, calls } = await openQueue(browser, { waiting: [], rejected: [ALREADY] })
    await page.waitForSelector('text=/No payments waiting/', { timeout: 15000 })

    /*
     * THIS IS THE ONE THAT WAS BROKEN. The screen returned early on an empty queue, so rejecting
     * the last receipt -- which is how the queue empties -- took the Put it back button off the
     * page with it.
     */
    t.ok('an empty queue still shows what was thrown out',
      (await page.locator('text=/Rejected today · 1/').count()) > 0)

    /* AND IT NO LONGER CLAIMS EVERYTHING WAS APPROVED, which is false on exactly this morning. */
    const line = await page.locator('text=/No payments waiting/').first().innerText()
    t.ok('the empty line says what actually happened', /approved or rejected/.test(line))

    /*
     * READ DEFENSIVELY, because the thing being asserted is whether this button is on the page at
     * all. Calling isEnabled() on a missing locator throws a TimeoutError thirty seconds later --
     * which aborts the file BEFORE the runner prints the failures it has already recorded, so a
     * real break reported nothing at all rather than the two lines naming it. CLAUDE.md names this
     * one: a throw two lines below the check that should have reported it.
     */
    const back = page.getByRole('button', { name: /Put it back/ })
    const there = (await back.count()) > 0
    t.ok('...and the way back is still on the page', there)
    if (there) {
      t.ok('...and still pressable', await back.isEnabled())
      await back.click()
      await page.waitForTimeout(300)
      t.check('putting it back names the receipt',
        calls.find((c) => c.unreject)?.unreject?.p_payment, 'pay-z')
    }

    await t.shot(page, 'reject-payment-empty')
    await context.close()
  }
} finally {
  await browser.close()
  stopServer(server)
}

const good = t.finish(
  `Throwing a receipt out of the approval queue, in a real browser. One on its own and two
together; a reason that really gates the button; the question about the statement line asked for a
bank receipt and not for one captured by hand; and an empty queue that still carries the undo --
which is where "throwing things in" ends, and where the Put it back button used to disappear.`)
process.exit(good ? 0 : 1)

/**
 * THE REPAYMENT CALCULATOR, IN A REAL BROWSER.
 *
 * THE FIRM ASKED FOR IT BESIDE THE PROMISE TO PAY: "the guy owes 10 000 rand, he wants to pay 500
 * rand a month, take into account interest... how long will it take him?"
 *
 * WHY THIS LAYER AND NOT ONLY check-repayment-plan. The arithmetic is held to the cent there. What
 * cannot be held there is whether a collector ever SEES it: the calculator lives inside a form that
 * only opens on a button, reads three fields that are typed one at a time, and renders nothing
 * until it has an amount, a shape and a date. A panel that is provably in the bundle and never
 * drawn is the failure this layer exists for, and it has happened in this codebase before.
 *
 * Run: node scripts/qa/e2e/repayment-calculator.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { COMPANY, PROFILE, accountsPage } from './fixtures.mjs'

const t = makeRunner('repayment-calculator')

/*
 * R10 000 AT 24% A YEAR, which is the 2% a month the migrated book charges and the rate the firm's
 * own letters quote. The posted accrual is not decoration: openAccrual needs a covered day to run
 * from, and an account with none accrues nothing however high its rate -- so without this row the
 * calculator would correctly show no interest and this file would be testing the wrong path.
 */
const ACCOUNT = {
  ...accountsPage(1)[0],
  capital_handed_over: 10000,
  capital_outstanding: 10000,
  interest_rate_annual: 24,
  in_duplum: true,
  in_duplum_ceiling: 10000,
  status: 'Active: Activated',
  opening_as_at: '2026-09-01',
}
const ACCRUALS = [{ accrued_on: '2026-09-01', days: 29, amount_accrued: 200 }]

async function openPromiseForm(browser) {
  const handlers = [
    [(u) => u.includes('/rest/v1/profiles'), () => ({ body: [PROFILE] })],
    [(u) => u.includes('/rest/v1/companies'), () => ({ body: [COMPANY] })],
    [(u) => u.includes('/rest/v1/debtor_accounts'), () => ({ body: [ACCOUNT] })],
    [(u) => u.includes('/rest/v1/account_interest_accruals'), () => ({ body: ACCRUALS })],
  ]
  const { context, page } = await signedInPage(browser, PROFILE, handlers, [])
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/accounts/${ACCOUNT.id}`, { timeout: 2000 }); break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  await page.getByRole('button', { name: /Take one/ }).first().click({ timeout: 20000 })
  await page.waitForTimeout(300)
  return { context, page }
}

/**
 * Fill the three fields the calculator reads, in the order the form asks for them.
 *
 * THE SHAPE FIRST, because the form asks in that order on purpose: it cannot know whether "5000" is
 * a whole debt or a monthly instalment until it has been told which. The amount field only exists
 * once the shape is chosen, which is why this cannot be done in one go.
 */
async function offer(page, { shape, amount, dueOn }) {
  await page.locator('form select').first().selectOption(shape)
  await page.waitForTimeout(150)
  /* An ordinary text input with inputMode="decimal", not type="number" -- a spinner on a rand
     amount is a control nobody wants on a phone call. */
  await page.locator('form input[inputmode="decimal"]').first().fill(String(amount))
  await page.locator('form input[type="date"]').first().fill(dueOn)
  await page.waitForTimeout(500)
}

const server = await startServer()
let browser
try {
  browser = await chromium.launch()

  /* ---------- nothing until there is something to work out ---------- */
  {
    const { context, page } = await openPromiseForm(browser)
    const body = await page.locator('body').innerText()
    /*
     * AN EMPTY CALCULATOR IS WORSE THAN NONE. Drawn before there is an amount it would show a row
     * of dashes on every promise anybody ever takes, and a panel that says nothing most of the
     * time is one nobody reads the day it says something.
     */
    /* Case-insensitively: the heading is drawn uppercase by CSS, so innerText hands back
       "IF THEY PAY THIS" and an exact match would pass here while failing below. */
    t.ok('the calculator draws nothing before an offer is typed', !/If they pay this/i.test(body))
    await context.close()
  }

  /* ---------- the firm's own example ---------- */
  {
    const { context, page } = await openPromiseForm(browser)
    await offer(page, { shape: 'monthly', amount: 500, dueOn: '2026-10-05' })
    const body = await page.locator('body').innerText()
    t.ok('an offer brings the calculator up', /If they pay this/i.test(body))
    /*
     * THE HEADLINE IS THE SENTENCE SOMEBODY SAYS OUT LOUD. Thirty-one payments, not the twenty a
     * debtor imagines, because R204 of the first one is interest and item 9 takes R57.50 more.
     */
    t.ok('...saying how many payments it takes', /31\s*payments/.test(body))
    t.ok('...and the month it settles', /Apr 2029/.test(body))
    /* AND WHAT IT COSTS, which is the part that changes the conversation. */
    t.ok('...what they pay in all', /15[\s ,]?267/.test(body))
    t.ok('...how much of it is interest', /3[\s ,]?314/.test(body))
    t.ok('...and how much is receipt fees', /1[\s ,]?752/.test(body))
    /* THE FIRM'S OWN CONDITION, on the screen, because the number goes to a debtor. */
    t.ok('...with the assumption beside it', /no further collection fees/i.test(body))
    t.ok('...and that the receipt fee is still charged', /receipt fee on each payment/i.test(body))
    /* OVER SIX INSTALMENTS IS SLOW PAYING, which is what the firm's own letters tell the debtor. */
    t.ok('...warning that it reads as slow paying', /slow paying/i.test(body))
    /* THE COUNTER-OFFER: what to ask for instead. */
    t.ok('...and what would clear it in six', /To clear it sooner/.test(body))
    t.ok('...with an amount against it', /6\s*payments/.test(body))
    await t.shot(page, '60-repayment-calculator')
    await context.close()
  }

  /* ---------- an offer that never clears the debt ---------- */
  {
    /*
     * THE ANSWER A COLLECTOR NEEDS MOST, and the one no calculator on a desk gives them: R150 a
     * month against R10 200 at 2% does not cover the interest, so the account never clears however
     * long the debtor pays.
     */
    const { context, page } = await openPromiseForm(browser)
    await offer(page, { shape: 'monthly', amount: 150, dueOn: '2026-10-05' })
    const body = await page.locator('body').innerText()
    t.ok('an offer below the interest says so plainly', /does not cover the interest/i.test(body))
    t.ok('...and does not quote a settlement date', !/settling/.test(body))
    await context.close()
  }

  /* ---------- the working, for a debtor who asks ---------- */
  {
    const { context, page } = await openPromiseForm(browser)
    await offer(page, { shape: 'monthly', amount: 500, dueOn: '2026-10-05' })
    /*
     * A DEBTOR IS ENTITLED TO ASK HOW THE FIGURE WAS ARRIVED AT, and a collector should not have to
     * answer "the system worked it out". Three rows are shown and the rest is one press away.
     */
    const every = page.getByRole('button', { name: /Every payment \(31\)/ })
    t.ok('the whole schedule is one press away', await every.isVisible())
    await every.click()
    await page.waitForTimeout(250)
    const rows = await page.locator('form table tbody tr').count()
    t.check('...and it is the whole schedule', rows, 31)
    await context.close()
  }
} catch (e) {
  /* A CRASH IS A FAILURE, REPORTED. Thrown out of the try the run prints a stack and no count at
     all -- and run-all reads the count, so a file that reports nothing is a file nobody sees. */
  t.ok(`the run finished without throwing (${String(e).slice(0, 160)})`, false)
  try {
    const pages = browser ? browser.contexts().flatMap((c) => c.pages()) : []
    if (pages[0]) await t.shot(pages[0], '69-where-it-stopped')
  } catch { /* nothing more to learn */ }
} finally {
  if (browser) await browser.close()
  await stopServer(server)
}

t.finish('A collector can see what an offer actually does before they record it.')

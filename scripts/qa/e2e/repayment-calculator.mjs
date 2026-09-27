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

/* The firm's own row, so the simulation has a trust account to name and letterPdfBytes does not
   refuse it for a field this account cannot fill. */
const FIRM = [{
  firm_name: 'Bredell Ferreira',
  trust_bank: 'Standard Bank',
  trust_branch_code: '051001',
  trust_account_name: 'Bredell Ferreira Trust',
  trust_account_number: '01 234 5678',
  trust_account_type: 'Legal Practitioner Trust Account',
  phone: '015 291 1234',
  email: 'info@bredellferreira.co.za',
  signatory_name: 'J Bredell',
  signatory_title: 'Duly authorised legal representative',
  email_font: 'Georgia, "Times New Roman", Times, serif',
  email_size_pt: '10.5',
  updated_at: '2026-09-01T08:00:00Z',
}]

/*
 * THE COVERING EMAIL, AS THE MIGRATION WROTE IT -- the three fields it quotes are the point.
 * {{ptp_amount}}, {{sim_frequency}} and {{sim_start}} describe an arrangement that does not exist
 * on this account, so nothing here can answer them except the calculator handing up the figures it
 * is showing. If that stops happening the box opens with braces in the middle of a sentence, which
 * is what this fixture exists to catch.
 */
const TEMPLATES = [{
  id: 'aaaaaaaa-0000-4000-8000-00000000ab01',
  scope: 'collections', kind: 'email', audience: 'individual', name: 'Payment simulation (individual)',
  subject: 'Payment simulation attached - case reference {{case_number}}',
  format: 'text',
  body: 'Dear {{debtor_name}}\n\nFollowing our conversation, attached is a simulation of what it '
    + 'would cost to settle this account by paying {{ptp_amount}} {{sim_frequency}}, starting '
    + '{{sim_start}}.\n\nPlease read the note at the top of it.',
  position: null, language: 'en', active: true, attachment_id: null,
  seed_key: 'email-ptp-simulation-individual', updated_at: '2026-09-01T08:00:00Z',
}]

async function openPromiseForm(browser) {
  const handlers = [
    [(u) => u.includes('/rest/v1/profiles'), () => ({ body: [PROFILE] })],
    [(u) => u.includes('/rest/v1/companies'), () => ({ body: [COMPANY] })],
    [(u) => u.includes('/rest/v1/debtor_accounts'), () => ({ body: [ACCOUNT] })],
    [(u) => u.includes('/rest/v1/account_interest_accruals'), () => ({ body: ACCRUALS })],
    [(u) => u.includes('/rest/v1/firm_settings'), () => ({ body: FIRM })],
    [(u) => u.includes('/rest/v1/message_templates'), () => ({ body: TEMPLATES })],
    [(u) => u.includes('/rest/v1/letterheads'), () => ({ body: [] })],
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
    /*
     * THE COUNTER-OFFER, AND WHAT IT SAVES THEM. The firm: "so that we can negotiate and the people
     * can see how fast they would pay it off and how much they would save -- kind of as a
     * motivational thing that they pay more faster." The saving is the column that does the work.
     */
    t.ok('...and what paying faster would cost', /Their offer, and paying it off faster/.test(body))
    t.ok('...with a column for what they save', /They save/.test(body))
    t.ok('...settling now among the options', /Settle now/.test(body))
    /*
     * THEIR OWN OFFER IS THE FIRST ROW. The firm asked for the ladder read downwards from what the
     * debtor said -- "I'll just put that one in the top, like it's 500 rand, and then 10
     * instalments, six instalments, three instalments, settle" -- and without the anchor the rows
     * under it are four figures the firm came up with rather than a comparison.
     */
    t.ok('...anchored on what they themselves offered', /Their offer/.test(body))
    const faster = await page.locator('table[aria-label="What paying it off faster would cost"] tbody tr').count()
    t.ok(`...and several speeds to choose from (${faster})`, faster >= 4)
    /* ---------- trying a different figure, without recording it ---------- */
    /*
     * THE FIRM: "let's say Rita wants to negotiate and wants to know, oh, what would happen if I
     * pay 3 000 rand a month? We have to give them that kind of... it'll be a nice tool."
     *
     * AND THE TWO THINGS THAT MAKE IT SAFE, both asserted here because only the page can show them:
     * the panel recalculates, and the FORM does not move. Answered by typing into the promise
     * itself, a collector would be putting a figure nobody agreed into the field that records the
     * arrangement -- and the schedule button below would then send the debtor the same mistake on
     * the firm's letterhead.
     */
    /* The promise's OWN amount box, which is the first decimal input on the form -- the same one
       offer() fills. The what-if box is found by its label, so the two cannot be confused. */
    const promiseAmount = page.locator('form input[inputmode="decimal"]').first()
    const amountBefore = await promiseAmount.inputValue().catch(() => null)
    await page.getByLabel('Try a different instalment').fill('3000')
    const tried = await page.locator('body').innerText()
    t.ok('a different figure can be tried without recording it',
      /If they paid this instead/i.test(tried))
    t.ok('...and the panel works on it', /R\s?3[\s ,]?000/.test(tried))
    /* IT SAYS SO, EVERY TIME. A panel quietly describing a figure that is not the one in the form
       above it is exactly the confusion this box could cause. */
    t.ok('...saying plainly which figure is being recorded',
      /arrangement being recorded above is still/i.test(tried))
    const amountAfter = await promiseAmount.inputValue().catch(() => null)
    t.ok(`...leaving the promise itself alone (${amountBefore} -> ${amountAfter})`,
      amountBefore !== null && amountAfter === amountBefore)
    await page.getByLabel('Try a different instalment').fill('')
    t.ok('...and clearing it goes back to the offer',
      /If they pay this/i.test(await page.locator('body').innerText()))
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

  /* ---------- the schedule as a document, on the firm's paper ---------- */
  {
    /*
     * THE FIRM: "even if possible, we can create a document that we can send him."
     *
     * DOWNLOADED FOR REAL, not asserted as a button that exists. The document is BUILT rather than
     * merged -- a table whose length is the answer cannot come out of a template -- so the only
     * thing that proves it works is bytes arriving, drawn through the same letterPdfBytes every
     * other notice this firm sends goes out on.
     */
    const { context, page } = await openPromiseForm(browser)
    await offer(page, { shape: 'monthly', amount: 500, dueOn: '2026-10-05' })
    const button = page.getByRole('button', { name: /Download it/ })
    t.ok('the schedule can be sent to the debtor', await button.isVisible())
    t.ok('...and is offered, not refused', await button.isEnabled())

    const wait = page.waitForEvent('download', { timeout: 20000 })
    await button.click()
    const download = await wait
    const name = download.suggestedFilename()
    t.ok(`...arriving as a PDF (${name})`, /\.pdf$/.test(name))
    /* NAMED FOR THE ACCOUNT. A collector with six of these in a downloads folder needs to know
       which debtor each one is for without opening it. */
    t.ok('...named for the simulation', /payment.simulation/i.test(name))

    const path = await download.path()
    const { readFileSync } = await import('node:fs')
    const bytes = readFileSync(path)
    t.ok(`...with real content (${(bytes.length / 1024).toFixed(1)} kB)`, bytes.length > 5000)
    t.check('...that is actually a PDF', bytes.subarray(0, 4).toString(), '%PDF')
    await context.close()
  }

  /* ---------- and emailed to the debtor, with the firm's own covering words ---------- */
  {
    /*
     * THE FIRM: "if you click on that, it sends it to the debtor as an email and it charges it as
     * well. So you can send it from the emails or you can send it from the promise to pay section."
     *
     * IT OPENS THE COMPOSE BOX RATHER THAN SENDING SILENTLY, and that is the whole design: the
     * account's own box sends through the collector's mailbox, files the message and raises item
     * 1(a). A second sender in this panel would be a second place that has to remember the R25.
     *
     * WHAT ONLY A BROWSER CAN PROVE. The wording quotes three fields nothing on this account can
     * answer -- there is no arrangement yet, which is the point of a simulation -- so they are
     * merged from the figures the panel is showing and handed across with the PDF. Held in a unit
     * check, every part of that would pass while the box opened empty.
     */
    const { context, page } = await openPromiseForm(browser)
    await offer(page, { shape: 'monthly', amount: 500, dueOn: '2026-10-05' })
    const send = page.getByRole('button', { name: /Email the simulation/ })
    t.ok('the simulation can be emailed to the debtor', await send.isVisible())
    t.ok('...and is offered, not refused', await send.isEnabled())
    /* WHAT IT COSTS, SAID BEFORE THE PRESS. Every other control in Raptor that raises an Annexure B
       fee says so, because a collector deciding whether to send is deciding whether to charge. */
    const panel = await page.locator('body').innerText()
    t.ok('...saying what it will cost', /charged R25 under item 1\(a\)/.test(panel))
    t.ok('...and that nothing goes until Send is pressed', /Nothing is sent until you press Send/.test(panel))

    await send.click()
    /* The box, with the firm's subject line on it. */
    const subject = page.getByLabel(/^Subject/i).or(page.locator('input[name="subject"]')).first()
    await subject.waitFor({ timeout: 20000 })
    t.ok('the compose box opens on the firm’s own covering email',
      /Payment simulation attached/.test(await subject.inputValue()))

    /* READ OUT OF THE BOX ITSELF, not off the page. The body is a textarea, and its contents are a
       value rather than text -- an innerText assertion here passes on an empty box. */
    const composed = await page.locator('form textarea').first().inputValue()
    /*
     * THE THREE FIELDS, MERGED. This is the assertion the whole feature hangs on: nothing on this
     * account has an arrangement, so if the calculator stopped handing its figures across, the
     * debtor would receive "paying {{ptp_amount}} {{sim_frequency}}, starting {{sim_start}}".
     */
    t.ok('...with the instalment merged in', /paying R.?500/.test(composed))
    t.ok(`...and how often (${/paying[^,]*,[^,]*/.exec(composed)?.[0] ?? "?"})`, /500[\s\S]{0,40}a month/.test(composed))
    t.ok('...and when it would start', /starting 5 October 2026/.test(composed))
    t.ok('...and no placeholder left standing', !/\{\{sim_|\{\{ptp_amount/.test(composed))
    /* AND THE DOCUMENT IS ALREADY ON THE MESSAGE. A covering email that says "attached is a
       simulation" and attaches nothing is a worse message than one that says nothing at all. */
    t.ok('...and the simulation already attached',
      await page.getByRole('button', { name: /Remove Payment-simulation.*\.pdf/i }).isVisible())
    /*
     * AND THE BOX KEEPS THE SIMULATION'S OWN FIGURES, which is what the letterContext override in
     * AccountDetail is for and the only way to see that it matters.
     *
     * NOTHING ON THIS ACCOUNT ANSWERS {{sim_frequency}} OR {{sim_start}} -- there is no
     * arrangement, which is the point of a simulation -- so a collector who reaches for the
     * template picker after the box has opened would, without the override, re-merge the same
     * wording against the bare account and replace three merged figures with three placeholders.
     * That is one press away from being sent.
     */
    await page.getByRole('button', { name: 'Use a template' }).first().click()
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: /Payment simulation/ }).first().click()
    await page.waitForTimeout(1500)
    const repicked = await page.locator('form textarea').first().inputValue()
    t.ok('re-picking the template keeps the simulation’s own figures',
      /starting 5 October 2026/.test(repicked))
    t.ok('...rather than putting the placeholders back',
      !/\{\{sim_|\{\{ptp_amount/.test(repicked))
    await t.shot(page, '70-simulation-composed')
    await context.close()
  }

  /* ---------- and refused where there is nothing to send ---------- */
  {
    /*
     * A SCHEDULE WITH NO END IS NOT A DOCUMENT. The button is drawn and disabled with the reason
     * beside it rather than quietly absent: a collector who cannot find it once stops looking.
     */
    const { context, page } = await openPromiseForm(browser)
    await offer(page, { shape: 'monthly', amount: 150, dueOn: '2026-10-05' })
    const button = page.getByRole('button', { name: /Download it/ })
    t.ok('the button is still on the screen', await button.isVisible())
    t.ok('...but cannot be pressed', await button.isDisabled())
    /* AND SO IS THE SEND, for the same reason and at the same moment. A page that cannot be drawn
       is not one to email either, and the two refusing apart is how one of them gets pressed. */
    const cannotSend = page.getByRole('button', { name: /Email the simulation/ })
    t.ok('...and neither can the email', await cannotSend.isDisabled())
    /*
     * THE REASON IS THE ONE FOR THIS ACCOUNT. In duplum is on here, as it is on the firm's own
     * accounts, so R150 does not "never settle" -- the debt stops growing at the ceiling and would
     * clear long after anybody cares. The refusal says what is true of it: there is no end to show.
     */
    t.ok('...and says why, beside it rather than only in a tooltip',
      /no end to show/i.test(await page.locator('body').innerText()))
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
    /* THE SCHEDULE'S OWN TABLE, named so it is not confused with the faster-options table above
       it -- which is what a bare `form table` selector counted, and why this read 35. */
    const rows = await page.locator('table[aria-label="Every payment of this arrangement"] tbody tr').count()
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

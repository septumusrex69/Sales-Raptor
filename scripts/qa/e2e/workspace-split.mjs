/**
 * TWO WORKSPACES, IN A REAL BROWSER.
 *
 * THE FIRM: "the trust and the business should be separated. It shouldn't be in the same tab in
 * finance. It should be like outside, for example."
 *
 * WHY SOURCE CANNOT ANSWER THIS. check-workspace-split can say the routes are nested where they
 * should be and that nothing links to the old addresses; it cannot say the rail DREW, that a
 * redirect actually arrives, that the Trust overview puts real figures on the page rather than
 * throwing on a shape it did not expect, or that somebody without the tick is really turned away
 * rather than merely not shown a menu item. CLAUDE.md names the failure this layer exists for: a
 * panel shipped, was provably in the bundle, and was invisible.
 *
 * THE FIGURES ARE THE FIRM'S OWN, off staging: R6 910.10 in the bank against R7 873.60 owed, which
 * is R963.50 SHORT. Invented round numbers would let the screen pass while unable to draw the one
 * case it exists for -- a trust account that does not balance. The difference is the headline and
 * the two debits behind it are named underneath, so both halves are asserted here.
 *
 * Run: node scripts/qa/e2e/workspace-split.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('workspace-split')

/* U+00A0 built rather than typed: en-ZA groups thousands with it, and a literal non-breaking space
   sitting invisibly inside a regex is unreadable and un-greppable. */
const NBSP = String.fromCharCode(0xa0)
const plain = (text) => text.split(NBSP).join(' ')

const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator' }
/* A Liaison has payment.record and client.view, and neither finance.view nor business.view --
   so they are the right person to prove the guards turn somebody away. */
const LIAISON = { ...PROFILE, name: 'Tumelo', role: 'Liaison' }

/* THE TRUST ACCOUNT AS IT ACTUALLY STANDS. Short by R963.50. */
const POSITION = {
  trust_cash: 6910.10,
  creditors: 7873.60,
  debtors: 0,
  net_owed: 7873.60,
  difference: -963.50,
  owed_to_clients: 2557.90,
  owed_to_debtors: 410.63,
  owed_to_firm: 4420.07,
  unidentified: 485.00,
  owed_by_clients: 0,
}

/* The two debits nothing accounts for. One is a payout with no run; one is a bank charge, which
   belongs to no creditor at all and cannot be matched to anything. */
const PAYOUTS = [
  {
    id: 'line-1', txn_date: '2026-10-05', amount: -962.50,
    description: 'FNB APP PAYMENT TO RINDA ROO COMPANY',
    candidate_run: 'run-1', candidate_invoice: 'PO-RRC-2610', candidate_client: 'Rinda Roo Company',
  },
  {
    id: 'line-2', txn_date: '2026-10-05', amount: -1.00, description: 'Bank charge',
    candidate_run: null, candidate_invoice: null, candidate_client: null,
  },
]

/*
 * ONE CHARGE OF EACH KIND, SPELLED THE WAY THE DATABASE SPELLS THEM.
 *
 * `client_charges_settlement_check` permits exactly 'set_off' and 'invoice'. The fixture uses those
 * two literals on purpose: business.ts was written comparing against 'off_payover', which matches
 * neither, so every charge fell silently into the invoiced column. A fixture carrying the browser's
 * wrong spelling would have agreed with it and proved nothing.
 */
const CHARGES = [
  { company_id: 'c1', amount: 1200, vat: 180, settlement: 'invoice', raised_on: '2026-10-01',
    companies: { name: 'Rinda Roo Company' } },
  { company_id: 'c1', amount: 500, vat: 75, settlement: 'set_off', raised_on: '2026-10-03',
    companies: { name: 'Rinda Roo Company' } },
]

/*
 * THE LEDGER, WITH A PARTY ON EACH SIDE. Mielie Meal Co is NEGATIVE on purpose: a PTC -- the
 * debtor paid the client direct -- is what turns a client from a trust creditor into a trust
 * debtor, and a fixture with only positives cannot tell the two tabs apart.
 */
const BALANCES = [
  { party: 'firm', who_id: 'firm', who_name: 'Bredell Ferreira',
    who_detail: 'Fees, interest and commission earned', balance: 4420.07, entries: 14,
    last_at: '2026-10-05T10:00:00Z' },
  { party: 'client', who_id: 'c1', who_name: 'Rinda Roo Company', who_detail: 'RRC',
    balance: 2557.90, entries: 8, last_at: '2026-10-05T09:00:00Z' },
  { party: 'debtor', who_id: 'a1', who_name: 'L Swakamisa', who_detail: 'RAP-123850',
    balance: 410.63, entries: 1, last_at: '2026-10-05T08:00:00Z' },
  { party: 'client', who_id: 'c2', who_name: 'Mielie Meal Co', who_detail: 'MMC',
    balance: -320.00, entries: 2, last_at: '2026-10-04T08:00:00Z' },
]

/* The firm's own month: earned, invoiced, spent, and what that leaves. */
const MONTH = {
  earned: 4420.07, drawn: 0, still_in_trust: 4420.07,
  invoiced: 1955.00, invoices_paid: 0, owed_by_clients: 1955.00,
  expenses: 26000.00, expenses_vat: 3900.00, made: -19624.93,
}

/*
 * THE SAME TRUST BALANCE, SPLIT BY THE PAYOVER EACH PART OF IT IS WAITING FOR.
 *
 * THE FIRM: "if we're on the 6th of October, the money for last month that was running from the
 * 10th of August to the 11th of September has not been paid out on the 11th of October. So that
 * money's in there. Plus, money from the 11th of September to the 6th of October is in there as
 * well." Two cycles at once, which is the whole reason this exists -- and this fixture is their
 * example, on their day.
 *
 * IT ADDS UP TO `POSITION` ON PURPOSE, TO THE CENT. 1 920.40 + 637.50 is the 2 557.90 owed to
 * clients and 3 310.07 + 1 110.00 is the 4 420.07 the firm may draw. The bands and the control
 * block are the same money read twice, so a fixture where they disagreed would let the screen pass
 * while drawing two different trust accounts one above the other.
 */
const CYCLES = [
  /* OLDEST FIRST, WHICH IS THE ORDER THE DATABASE RETURNS THEM IN. The screen does not sort, so a
     fixture in the other order would prove the rows draw and say nothing about which comes first --
     and the row that leaves soonest being on top is the point of the ordering. */
  {
    period_start: '2026-08-11', period_end: '2026-09-10', pays_on: '2026-10-11', is_open: false,
    to_clients: 1920.40, firm_earned: 3310.07, firm_moved: 0, to_debtors: 410.63, unplaced: 0,
    held: 5641.10, runs: 1, runs_paid: 0, runs_to_do: 1,
  },
  {
    period_start: '2026-09-11', period_end: '2026-10-10', pays_on: '2026-11-11', is_open: true,
    to_clients: 637.50, firm_earned: 1110.00, firm_moved: 0, to_debtors: 0, unplaced: 0,
    held: 1747.50, runs: 0, runs_paid: 0, runs_to_do: 0,
  },
]

function handlersFor(profile) {
  return [
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [profile] })],
    [(u) => /\/rest\/v1\/firm_settings/.test(u),
      () => ({ body: [{ firm_name: 'Bredell Ferreira', vat_rate: 0.15 }] })],
    [(u) => /\/rpc\/trust_position/.test(u), () => ({ body: [POSITION] })],
    [(u) => /\/rpc\/unreconciled_payouts/.test(u), () => ({ body: PAYOUTS })],
    [(u) => /\/rpc\/trust_balances/.test(u), () => ({ body: BALANCES })],
    [(u) => /\/rpc\/trust_by_cycle/.test(u), () => ({ body: CYCLES })],
    [(u) => /\/rest\/v1\/client_charges/.test(u), () => ({ body: CHARGES })],
    [(u) => /\/rpc\/business_month/.test(u), () => ({ body: [MONTH] })],
    [(u) => /\/rest\/v1\//.test(u), () => ({ body: [] })],
    [(u) => /\/rpc\//.test(u), () => ({ body: [] })],
  ]
}

async function open(browser, profile, path) {
  const { context, page } = await signedInPage(browser, profile, handlersFor(profile), [])
  await page.goto(`http://127.0.0.1:${PORT}${path}`, { waitUntil: 'domcontentloaded' })
  return { context, page }
}

const server = await startServer()
const browser = await chromium.launch()
try {
  /* ------------------------------------------------------------------ the trust workspace */
  {
    const { context, page } = await open(browser, ADMIN, '/trust')
    await page.waitForSelector('text=Trust overview', { timeout: 15000 })

    /* THE RAIL DREW, with its name and the line saying whose money this is. */
    const rail = page.locator('nav').filter({ hasText: 'Money held for other people' }).first()
    t.ok('the trust rail is on the page', (await rail.count()) > 0)
    for (const item of ['Overview', 'Payments in', 'Check', 'Payover runs', 'Exceptions']) {
      t.ok(`...listing ${item}`, (await rail.getByRole('link', { name: item }).count()) > 0)
    }
    t.ok('...and its settings', (await rail.getByRole('link', { name: 'Trust settings' }).count()) > 0)

    /*
     * BACK OFFICE IS NOT HERE. It is the firm's own income and spent its life fifth in the strip
     * this replaced, so it is the one most likely to be put back by somebody tidying.
     */
    t.check('back office is not a trust item',
      await rail.getByRole('link', { name: 'Back office' }).count(), 0)

    /* THE DOOR TO THE OTHER BOOK, which is how somebody crosses without a tab. */
    t.ok('there is a door to the business account',
      (await rail.getByRole('link', { name: 'Business account' }).count()) > 0)

    /* ---- the figures, and the difference above all ---- */
    /*
     * NON-BREAKING SPACES NORMALISED FIRST. en-ZA groups thousands with U+00A0, so "R 6 910.10" on
     * the page is not the string a test types with ordinary spaces -- and an assertion that
     * silently never matched would pass the day the figure disappeared.
     */
    const body = plain(await page.locator('main').innerText())
    t.ok('the bank balance is on the page', /R 6 910\.10/.test(body))
    t.ok('what is owed out of it is too', /R 7 873\.60/.test(body))
    /*
     * THE DIFFERENCE IS STATED IN WORDS, not only drawn as a red number. A figure with no sentence
     * under it tells somebody they have a problem and nothing about where to start.
     */
    t.ok('and the shortfall is said out loud',
      /bank holds R 963\.50 less than is owed/.test(body))
    /*
     * THE THREE FIGURES ARE NAMED AS THE TWO RECORDS BEING RECONCILED. The firm's own sketch calls
     * them BANK BALANCE and TRUST LEDGER BALANCE, and that is better here rather than merely more
     * formal: "owed out of it" describes a consequence, where "trust ledger balance" names the
     * thing being compared, and a reconciliation only reads when both sides are named.
     */
    /* CASE-INSENSITIVE for the same reason as the heading above: the dark panel's labels are drawn
       `uppercase`, so innerText returns TRUST LEDGER BALANCE. */
    t.ok('the two records are named as records',
      /Bank balance/i.test(body) && /Trust ledger balance/i.test(body))
    /* AND THE VERDICT IS ON THE PANEL, so nobody has to know that R 0.00 is the good answer. */
    t.ok('...with the match stated rather than implied', /NOT MATCHED/i.test(body))

    /* ---- does it balance? the panel the firm asked for, and it can say no ---- */
    /*
     * THE FIRM: "if the trust fund balances in the overview, then everything is fine."
     *
     * THE RECONCILIATION THEIR SKETCH DREW CANNOT SAY NO -- ledger balance less the four owners is
     * an algebraic identity, because trust_position derives the balance BY ADDING THEM UP. So the
     * panel was built from the four things that can actually be wrong, and this fixture has a real
     * shortfall in it: the assertion that matters is that the page says the account does NOT
     * balance. Drawn as the sketch had it, this line would read "match" over a R 963,50 hole.
     */
    t.ok('the page says whether the trust balances at all',
      /The trust account does not balance\./.test(body))
    t.ok('...asking whether every rand has an owner', /Does every rand in there have an owner\?/.test(body))
    t.ok('...and answering it with the unplaced receipt', /R 485\.00 is in the account with nobody/.test(body))
    /*
     * THE CHECKS THAT PASS ARE SHOWN TOO. A panel drawing only problems cannot be told apart from
     * one that failed to load, and the firm asked to be told that everything IS fine.
     */
    t.ok('...and the checks that pass are still drawn',
      /No client owes the trust/.test(body))
    t.ok('...including the payovers', /No cycle is holding client money past/.test(body))
    /*
     * A TRUST DEBTOR IS NOT A SHORTFALL, and the words have to keep them apart: the cash is all
     * there, so sending somebody to the bank over a collection job is the failure here.
     */
    t.ok('a client in debit would not be called a shortfall',
      !/owes the trust[\s\S]{0,120}shortfall/.test(body) || /not a shortfall/.test(body))

    /* ---- who owns it, named by what the money IS ---- */
    /* CASE-INSENSITIVE: the heading carries `uppercase`, so innerText hands back WHO OWNS THE
       MONEY IN TRUST? while the source says it in sentence case. The same trap as the state badge
       sixty lines down, which this file already documents. */
    t.ok('the ownership question is asked', /Who owns the money in trust\?/i.test(body))
    for (const owner of [
      'Awaiting client payover', 'Earned and still held in trust',
      'Overpayments and refunds outstanding', 'Owner not yet identified',
    ]) {
      t.ok(`...and ${owner.toLowerCase()} is one of the answers`, body.includes(owner))
    }
    /* WHOSE IT IS IS KEPT BESIDE IT. What the money is waiting for and who would be out of pocket
       are two different facts and the second is the whole point of a trust. */
    t.ok('...with whose money each one is', /Clients ·/.test(body) && /Bredell Ferreira ·/.test(body))
    t.ok('...summing to a total accounted for', /Total accounted for/i.test(body))

    /* ---- and it is EXPLAINED: both debits named, with the right action on each ---- */
    t.ok('the unmatched payout is named', /R 962\.50/.test(body))
    t.ok('...with the run it probably belongs to', /Match to PO-RRC-2610/.test(body))
    /* A bank charge has no run to match, so it must NOT offer to match it to one. */
    t.ok('the bank charge is named', /Bank charge/.test(body))
    t.ok('...and is offered no run to match', /Find its run/.test(body))

    /* ---- the two cycles in the account at once ---- */
    /*
     * THE QUESTION THE OLD SCREEN COULD NOT ANSWER. One running total per party is a true figure
     * that answers neither "what goes out on the 11th" nor "what have we collected this month",
     * and those are the two things somebody standing in front of this screen wants.
     */
    t.ok('the closed cycle names itself', body.includes('11 Aug – 10 Sep 2026'))
    t.ok('...and the one still collecting does too', body.includes('11 Sep – 10 Oct 2026'))
    /*
     * CASE-INSENSITIVE, BECAUSE `innerText` IS THE RENDERED TEXT. The state badge carries
     * `uppercase`, so the browser hands back COLLECTING NOW while the source says "Collecting now"
     * -- and an assertion on the source spelling fails on correct code. Everything else here is
     * matched as written because nothing else on this screen is transformed.
     */
    t.ok('the open one says it is still filling up', /collecting now/i.test(body))

    /*
     * AND THE ONE THAT LEAVES SOONEST IS DRAWN FIRST. The screen does not sort -- the order is the
     * database's -- so this is really asserting that nothing up here reverses it.
     */
    t.check('the cycle going out first is the top row',
      body.indexOf('11 Aug – 10 Sep 2026') < body.indexOf('11 Sep – 10 Oct 2026')
        && body.indexOf('11 Aug – 10 Sep 2026') >= 0, true)

    /* THE DAY EACH ONE LEAVES, which is the thing the firm asked for by name. */
    t.ok('the closed cycle quotes its payover date', body.includes('11 Oct 2026'))
    t.ok('...and the open one quotes its own', body.includes('11 Nov 2026'))

    /* WHAT EACH ONE HOLDS, FOR THE CLIENT AND FOR THE FIRM, SEPARATELY. */
    t.ok("last month's client money is on the page", /R 1 920\.40/.test(body))
    t.ok('...and what it earned the firm', /R 3 310\.07/.test(body))
    t.ok("this month's so far is on the page", /R 637\.50/.test(body))
    t.ok('...and what that has earned the firm', /R 1 110\.00/.test(body))

    /* A CLOSED CYCLE WITH CLIENT MONEY AND A RUN NOT YET PAID SAYS WHAT IS LEFT TO DO ON IT. */
    t.ok('the closed cycle says what is outstanding on it',
      body.includes('1 run still to be approved and paid'))

    /*
     * THE TIE-OUT, AND IT IS THE POINT OF DRAWING BOTH. The bands and the control block are the
     * same money read twice, so the totals row under the bands has to carry the SAME two figures
     * the control block does.
     *
     * READ OUT OF THE TOTALS ROW ITSELF, not counted across the page. Counting occurrences looked
     * like a tie-out and was not: R 4 420.07 already appears twice without the bands existing at
     * all -- once in the control block and once on "Yours to draw" -- so the firm's half of that
     * assertion passed with the whole cycle table deleted. The client half did fail, which is
     * exactly how an assertion that is half vacuous hides.
     */
    /* THE ROW, NOT THE LABEL INSIDE IT. `.filter({hasText})` matches every ancestor too, so the
       innermost match is the <div> holding the words alone -- which carries no figures at all. The
       row is its parent, and XPath is the one selector that can say so. */
    const totalsAt = page
      .locator('xpath=//div[normalize-space(text())="Across every cycle"]/..').first()
    /* COUNTED BEFORE IT IS READ. innerText on a locator that matches nothing waits out the whole
       timeout and then throws, which fails the run thirty seconds later as a crash rather than
       here as a named assertion -- the "read defensively" trap CLAUDE.md names. */
    const hasTotals = (await totalsAt.count()) > 0
    t.ok('the bands carry a totals row', hasTotals)
    const totalsRow = hasTotals ? plain(await totalsAt.innerText()) : ''
    t.ok('the client bands total to the control block', /R 2 557\.90/.test(totalsRow))
    t.ok("the firm's bands total to what it may draw", /R 4 420\.07/.test(totalsRow))

    /* AND THE SCREEN SAYS WHERE THE DATE IT QUOTES COMES FROM, because Raptor guessed it. */
    t.ok('the guessed payover date points at its setting', body.includes('a trust setting'))

    /* ---- the four parties, each named by WHOSE the money is ---- */
    /*
     * THE ROWS WERE RENAMED TO SAY WHAT THE MONEY IS -- "Awaiting client payover" rather than
     * "Clients" -- at the firm's asking, and whose it is was kept on the line beneath. This loop
     * asserts the second half: the label a reader uses to find their own money. "Not yet
     * identified" became "Unallocated receipts", which is what the firm calls it.
     */
    for (const who of ['Clients', 'Debtors', 'Bredell Ferreira', 'Unallocated receipts']) {
      t.ok(`${who} has a line`, body.includes(who))
    }
    t.ok('the firm knows what it may draw', /R 4 420\.07/.test(body))

    /* ---- the rail folds, and folded it STILL says which book you are in ---- */
    await page.getByRole('button', { name: /Narrow this menu/ }).click()
    await page.waitForTimeout(250)
    t.check('folded, the rail is gone',
      await page.locator('nav').filter({ hasText: 'Money held for other people' }).count(), 0)
    /*
     * THE SINGLE THING THE SPLIT EXISTS TO KEEP CLEAR. A folded rail that showed a bare icon would
     * reclaim the width and leave somebody unable to tell the trust account from the business one.
     */
    t.ok('...but it still says Trust',
      (await page.getByRole('button', { name: 'Trust', exact: true }).count()) > 0)
    await context.close()
  }

  /* ---------------------------------------------------------------------- the trust ledger */
  {
    const { context, page } = await open(browser, ADMIN, '/trust/ledger')
    await page.waitForSelector('text=Trust ledger', { timeout: 15000 })

    /*
     * ONE LEDGER READ IN TWO DIRECTIONS. Positive is owed OUT of trust and negative owes it; a PTC
     * is exactly what moves a client from one side to the other. The two tabs must therefore split
     * the SAME rows rather than listing everything twice.
     */
    let body = plain(await page.locator('main').innerText())
    t.ok('the firm is a creditor', /Bredell Ferreira/.test(body))
    t.ok('...and so is a client', /Rinda Roo Company/.test(body))
    t.ok('...and a debtor who overpaid', /L Swakamisa/.test(body))
    t.check('the client who OWES the trust is not on this side',
      /Mielie Meal Co/.test(body), false)
    t.ok('the creditors total', /R 7 388\.60/.test(body))

    /*
     * AND THE LEDGER'S TOTAL IS EXPLAINED AGAINST THE OVERVIEW'S. They differ by the unplaced
     * receipts, and two figures that differ with nothing saying why read as a system disagreeing
     * with itself.
     */
    t.ok('the gap to the overview is explained',
      /R 7 873\.60 is owed out/.test(body) && /R 485\.00 of receipts nobody has placed/.test(body))

    await page.getByRole('button', { name: /Owed back to trust/ }).click()
    await page.waitForTimeout(300)
    body = plain(await page.locator('main').innerText())
    t.ok('the client who owes the trust is on the other side', /Mielie Meal Co/.test(body))
    t.check('...and the creditors are not', /Bredell Ferreira/.test(body), false)

    /* THE RECONCILIATION IS A WORKED SUM, not two figures and a verdict: when it does not come
       out, the next question is always which part. */
    await page.getByRole('button', { name: /Against the bank/ }).click()
    await page.waitForTimeout(300)
    body = plain(await page.locator('main').innerText())
    for (const line of ['In the trust bank account', 'Owed to clients',
      'Owed to debtors who overpaid', 'Earned by the firm, not yet drawn',
      'Receipts nobody has placed']) {
      t.ok(`the sum shows "${line}"`, body.includes(line))
    }
    t.ok('...and the difference it comes to', /-R 963\.50/.test(body))
    t.ok('...said as not balancing', /does not balance/.test(body))
    await context.close()
  }

  /* ------------------------------------------------------------- the business workspace */
  {
    const { context, page } = await open(browser, ADMIN, '/business')
    await page.waitForSelector('text=Business overview', { timeout: 15000 })

    const rail = page.locator('nav').filter({ hasText: "The firm's own money" }).first()
    t.ok('the business rail is on the page', (await rail.count()) > 0)
    t.ok('...listing Back office, which moved here',
      (await rail.getByRole('link', { name: 'Back office' }).count()) > 0)
    t.ok('...and a door back to trust',
      (await rail.getByRole('link', { name: 'Trust account' }).count()) > 0)

    /* NO TRUST SCREEN IS REACHABLE FROM HERE. The whole point of two places. */
    for (const item of ['Payover runs', 'Payments in', 'Exceptions']) {
      t.check(`${item} is not a business item`, await rail.getByRole('link', { name: item }).count(), 0)
    }

    const body = plain(await page.locator('main').innerText())
    /* The earnings figure is READ FROM THE TRUST SIDE: one number, one function, two screens. */
    t.ok('what the firm has earned shows', /R 4 420\.07/.test(body))
    /*
     * AND WHAT IT MADE, WHICH USED TO SAY "not built yet". The panel was an admission while the
     * firm's own spending had nowhere to live; now business_month answers it, and the figure is
     * EARNED less spent rather than DRAWN less spent -- money earned and still in trust has been
     * earned, and a month read on drawings would say the firm made nothing in any month it chose
     * not to transfer.
     */
    t.ok('what the firm earned this month shows', /Earned/.test(body))
    t.ok('...and what it spent', /Spent/.test(body))
    /*
     * THE FIXTURE'S MONTH IS A LOSS, SO THE WORD IS "Lost". A loss drawn exactly like a profit is
     * how a month in the red gets skimmed past -- the minus sign is one character doing all the
     * work -- so the label changes with the sign and the assertion follows it. Asserting a bare
     * /Made/ here passed until the label was fixed, and then failed on correct code.
     */
    t.ok('...and that the month was a loss', /\bLost\b/.test(body))
    t.check('...not called a profit', /\bMade\b/.test(body), false)
    t.ok('...with the earned-not-drawn rule said out loud',
      /whether or not it has left the trust account/.test(body))

    /*
     * THE TWO WAYS A CHARGE IS SETTLED, SHOWN APART. Added together they would read as one overdue
     * figure and somebody would chase a client for money already coming off their next run. This
     * is also what holds business.ts to the database's spelling: with the literal wrong, BOTH
     * charges land in "invoiced" and the set-off line disappears.
     */
    t.ok('a charge coming off the payover says so', /R 575\.00 off their payover/.test(body))
    t.ok('...and an invoiced one says that instead', /R 1 380\.00 invoiced/.test(body))
    t.ok('...with the client owing the two together', /R 1 955\.00/.test(body))
    await context.close()
  }

  /* ------------------------------------------------------------------- the old addresses */
  {
    /*
     * A BOOKMARK AND A LINK IN SENT MAIL. The firm has already emailed people payover runs; a
     * redirect that silently stopped working breaks a link nobody can fix and nobody reports.
     */
    for (const [from, landsOn] of [
      ['/finance', '/trust'],
      ['/finance/payover', '/trust/payover'],
      ['/finance/back-office', '/business/back-office'],
      ['/finance/runs/run-1', '/trust/runs/run-1'],
    ]) {
      const { context, page } = await open(browser, ADMIN, from)
      /* Waiting on the URL rather than on text: a redirect is the thing being tested, and some of
         these land on screens with their own loading states. */
      await page.waitForURL(`**${landsOn}`, { timeout: 15000 }).catch(() => {})
      t.check(`${from} lands on ${landsOn}`, new URL(page.url()).pathname, landsOn)
      await context.close()
    }
  }

  /* --------------------------------------------------------- and the guards turn people away */
  {
    /*
     * HIDING THE MENU ITEM IS THE COURTESY; THIS IS THE BOUNDARY. A URL can be typed, and the
     * business side has nothing behind it in the database yet, so this redirect is all there is.
     */
    for (const path of ['/trust', '/business']) {
      const { context, page } = await open(browser, LIAISON, path)
      await page.waitForURL('**/', { timeout: 15000 }).catch(() => {})
      t.check(`a Liaison typing ${path} is put back`, new URL(page.url()).pathname, '/')
      await context.close()
    }

    /* AND NEITHER ITEM IS IN THEIR MENU. Both halves, because either alone is a half-built rule. */
    const { context, page } = await open(browser, LIAISON, '/')
    await page.waitForSelector('nav', { timeout: 15000 })
    const sidebar = await page.locator('aside').innerText()
    t.check('...and Trust is not in their menu', /\bTrust\b/.test(sidebar), false)
    t.check('...nor Business', /\bBusiness\b/.test(sidebar), false)
    /* The word that used to be there is gone for everybody, not just hidden from them. */
    t.check('...and neither is Finance', /\bFinance\b/.test(sidebar), false)
    await context.close()
  }
} finally {
  await browser.close()
  await stopServer(server)
}

const good = t.finish(
  `Two workspaces, in a real browser. The trust rail with Back office absent from it; the overview
opening on a trust account that is R963.50 SHORT, with both unexplained debits named and only the
one that has a run offered a run to match; the rail folded but still saying which book you are in;
every old /finance address still landing, the run detail with its id; and a Liaison turned away
from both by the guard rather than merely not shown the menu item.`)
process.exit(good ? 0 : 1)

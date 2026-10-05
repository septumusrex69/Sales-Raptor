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

function handlersFor(profile) {
  return [
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [profile] })],
    [(u) => /\/rest\/v1\/firm_settings/.test(u),
      () => ({ body: [{ firm_name: 'Bredell Ferreira', vat_rate: 0.15 }] })],
    [(u) => /\/rpc\/trust_position/.test(u), () => ({ body: [POSITION] })],
    [(u) => /\/rpc\/unreconciled_payouts/.test(u), () => ({ body: PAYOUTS })],
    [(u) => /\/rest\/v1\/client_charges/.test(u), () => ({ body: CHARGES })],
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
    const body = (await page.locator('main').innerText()).replace(/\u00a0/g, ' ')
    t.ok('the bank balance is on the page', /R 6 910\.10/.test(body))
    t.ok('what is owed out of it is too', /R 7 873\.60/.test(body))
    /*
     * THE DIFFERENCE IS STATED IN WORDS, not only drawn as a red number. A figure with no sentence
     * under it tells somebody they have a problem and nothing about where to start.
     */
    t.ok('and the shortfall is said out loud',
      /bank holds R 963\.50 less than Raptor says is owed/.test(body))

    /* ---- and it is EXPLAINED: both debits named, with the right action on each ---- */
    t.ok('the unmatched payout is named', /R 962\.50/.test(body))
    t.ok('...with the run it probably belongs to', /Match to PO-RRC-2610/.test(body))
    /* A bank charge has no run to match, so it must NOT offer to match it to one. */
    t.ok('the bank charge is named', /Bank charge/.test(body))
    t.ok('...and is offered no run to match', /Find its run/.test(body))

    /* ---- the four parties ---- */
    for (const who of ['Clients', 'Debtors', 'Bredell Ferreira', 'Not yet identified']) {
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

    const body = (await page.locator('main').innerText()).replace(/\u00a0/g, ' ')
    /* The earnings figure is READ FROM THE TRUST SIDE: one number, one function, two screens. */
    t.ok('what the firm has earned shows', /R 4 420\.07/.test(body))
    /*
     * EXPENSES ARE ADMITTED, NOT DRAWN EMPTY. An empty expenses table reads as a firm that spent
     * nothing this month, which is a figure, and a wrong one.
     */
    t.ok('and what is missing is said in words', /None of it is built yet/.test(body))

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

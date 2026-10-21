/**
 * THREE BOOKS, IN A REAL BROWSER — AND AN ACCOUNT MOVED THROUGH ALL OF THEM.
 *
 * THE FIRM ASKED FOR THIS TEST BY NAME: "An e2e test covers moving an account Active -> On hold ->
 * Active -> Closed, with the event trail."
 *
 * WHY SOURCE CANNOT ANSWER IT. check-books holds the generated column, the clause builder, the
 * counts and the guards; it cannot say that the Accounts screen OPENS on Active, that the chooser
 * draws with the right counts on all four books, that the shortcuts disappear off Closed, or that
 * the three boxes on the account actually open and send what they claim to. CLAUDE.md names the
 * failure this layer exists for: a panel shipped, was provably in the bundle, and was invisible.
 *
 * THE FIGURES ARE THE TWENTY TEST ACCOUNTS. 9 active, 3 on hold, 8 closed -- what the firm counted
 * by hand and what the generated column produced on staging. Invented round numbers would let the
 * screen pass while unable to draw the case it exists for.
 *
 * THE MOVES ARE ASSERTED ON WHAT WAS SENT, not on what the screen then drew. A fixture answers
 * every request, so the account comes back unchanged however the box behaves; what can be proved is
 * that pressing the button called the right function with the right arguments -- the reason, the
 * review date -- which is exactly where a box that looked right and sent nothing would show.
 *
 * Run: node scripts/qa/e2e/books.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('books')

const ADMIN = { ...PROFILE, name: 'Stephan', role: 'Administrator' }

/* The twenty test accounts, as the generated column sorted them on staging. */
const COUNTS = {
  whole_book: 28, active: 17, on_hold: 3, closed: 8,
  my_desk: 0, unallocated: 4, adrift: 2, broken_promises: 2, promises_due: 4, gone_quiet: 1,
}

const SUMMARY = {
  accounts: 17, capital: 196489.72, outstanding: 196489.72, clients: 6, commission_drift: 0,
}

/** One row per book, so the list can be seen to change when the chooser is pressed. */
const ROWS = {
  active: [{
    id: 'a-active', company_id: 'c1', account_number: 'SMF10031', case_number: 'RAP-200031',
    debtor_surname: 'Mahlangu', status: 'Active: Activated', book: 'active',
    capital_handed_over: 1500, capital_outstanding: 1500, commission_drift: false,
  }],
  on_hold: [{
    id: 'a-hold', company_id: 'c1', account_number: 'BPM0109', case_number: 'RAP-200109',
    debtor_surname: 'Swakamisa', status: 'Frozen', book: 'on_hold',
    capital_handed_over: 13662, capital_outstanding: 13662, commission_drift: false,
  }],
  closed: [{
    id: 'a-closed', company_id: 'c1', account_number: 'KIS0007', case_number: 'RAP-200007',
    debtor_surname: 'Ndlovu', status: 'Written-off', write_off_reason: 'Paid in Full',
    book: 'closed', capital_handed_over: 71286.67, capital_outstanding: 0, commission_drift: false,
  }],
}

/** What the browser ASKED the database to do. The point of the whole file. */
const sent = []

function handlers() {
  return [
    [(u) => /\/rest\/v1\/profiles/.test(u), () => ({ body: [ADMIN] })],
    [(u) => /\/rest\/v1\/firm_settings/.test(u),
      () => ({ body: [{ firm_name: 'Bredell Ferreira', vat_rate: 0.15 }] })],
    [(u) => /\/rpc\/account_view_counts/.test(u), () => ({ body: [COUNTS] })],
    [(u) => /\/rpc\/book_summary/.test(u), () => ({ body: [SUMMARY] })],
    [(u) => /\/rpc\/book_facets/.test(u), () => ({ body: [] })],
    /* THE LIST ITSELF, answered by whichever book the request asked for -- which is also the only
       way to see that the screen sent `book=eq.active` without being told to. */
    /* The responder is handed (url, request) -- see stubSupabase. */
    [(u) => /\/rest\/v1\/debtor_accounts/.test(u), (url) => {
      /* ONE ACCOUNT BY ID is the account page's own fetch, not the list's: answered from the same
         three rows so the page and the list cannot disagree about one debtor. */
      const byId = /id=eq\.([\w-]+)/.exec(url)?.[1]
      if (byId) {
        const all = [...ROWS.active, ...ROWS.on_hold, ...ROWS.closed]
        return { body: all.filter((a) => a.id === byId) }
      }
      const book = /book=eq\.(\w+)/.exec(url)?.[1] ?? 'none'
      sent.push(`list book=${book}`)
      return { body: ROWS[book] ?? [] }
    }],
    [(u) => /\/rpc\/(hold_account|release_account|settle_account)/.test(u), (url, req) => {
      sent.push(`${/\/rpc\/(\w+)/.exec(url)[1]} ${req.postData() ?? ''}`)
      return { body: 1 }
    }],
    [(u) => /\/rest\/v1\//.test(u), () => ({ body: [] })],
    [(u) => /\/rpc\//.test(u), () => ({ body: [] })],
  ]
}

async function open(browser, path) {
  const { context, page } = await signedInPage(browser, ADMIN, handlers(), [])
  await page.goto(`http://127.0.0.1:${PORT}${path}`, { waitUntil: 'domcontentloaded' })
  return { context, page }
}

const server = await startServer()
const browser = await chromium.launch()
try {
  /* ------------------------------------------------- the screen opens on Active */
  {
    const { context, page } = await open(browser, '/accounts')
    await page.waitForSelector('text=Whole book', { timeout: 15000 })
    await page.waitForTimeout(600)

    const body = await page.locator('main').innerText()

    /* THE FOUR CHOICES, WITH THEIR COUNTS. */
    for (const [label, n] of [['Active', 17], ['On hold', 3], ['Closed', 8], ['Whole book', 28]]) {
      t.ok(`${label} is offered`, body.includes(label))
      t.ok(`...counting ${n}`, body.includes(String(n)))
    }

    /*
     * AND THE LIST IT ASKED FOR WAS THE ACTIVE ONE, with nothing in the URL saying so. This is the
     * firm's headline: "The Accounts screen opens on 'Whole book', which mixes accounts collectors
     * should ring today with accounts that are paid up, written off, withdrawn or frozen."
     */
    t.ok('a bare /accounts asks for the active book', sent.includes('list book=active'))
    t.check('...and never for the whole table', sent.filter((s) => s === 'list book=none').length, 0)

    /* THE SHORTCUTS ARE THERE, because this IS Active. */
    t.check('the shortcuts are offered on Active',
      await page.getByRole('button', { name: 'Gone quiet' }).count(), 1)
    await context.close()
  }

  /* ------------------------------------------------- Closed is a different list */
  {
    sent.length = 0
    const { context, page } = await open(browser, '/accounts?book=closed')
    await page.waitForSelector('text=Whole book', { timeout: 15000 })
    await page.waitForTimeout(600)
    const body = await page.locator('main').innerText()

    t.ok('the closed book is asked for', sent.includes('list book=closed'))
    t.ok('...and its account is drawn', body.includes('KIS0007'))
    /*
     * AND THE SHORTCUTS ARE GONE. They are queues -- work waiting -- and there is no such thing as
     * a broken promise on a written-off account. Offered here they would be four links that each
     * open an empty list, which reads as a bug rather than as a rule.
     */
    /*
     * ASSERTED ON THE BUTTONS, NOT ON THE WORDS. "Unallocated" is also an option in the desk
     * filter, where it belongs on every book -- narrowing Closed to the accounts nobody holds is a
     * reasonable question. Reading the page text for it failed on correct code. The SHORTCUT is a
     * button, and that is the thing that must not be here.
     */
    t.check('no shortcut button is offered on Closed',
      await page.getByRole('button', { name: 'Gone quiet' }).count(), 0)
    t.check('...nor the unallocated one',
      await page.getByRole('button', { name: 'Unallocated' }).count(), 0)
    /* AND THE BOOK CHOOSER IS STILL THERE, or the test above would pass on a blank page. */
    t.check('the book chooser is still drawn',
      await page.getByRole('button', { name: /Whole book/ }).count(), 1)
    await context.close()
  }

  /* ------------------------------------------------- On hold has a review queue */
  {
    const { context, page } = await open(browser, '/accounts?book=on_hold')
    await page.waitForSelector('text=Whole book', { timeout: 15000 })
    await page.waitForTimeout(600)
    const body = await page.locator('main').innerText()
    t.ok('the review queue is on the on-hold book', body.includes('Due a look'))
    /* TWO QUEUES, BECAUSE THEY ARE TWO PROBLEMS: a date somebody undertook and did not keep, and an
       account parked before a date was ever required -- every frozen row off the import. */
    t.ok('...and so is the one nobody dated', body.includes('No review date set'))
    await context.close()
  }

  /* ------------------------------------------------- Active -> On hold -> Active -> Closed */
  {
    sent.length = 0
    const { context, page } = await open(browser, '/accounts/a-active')
    await page.waitForSelector('text=Put on hold', { timeout: 15000 })

    /* ---- Active -> On hold ---- */
    await page.getByRole('button', { name: 'Put on hold' }).click()
    await page.waitForSelector('text=Why it is stopping', { timeout: 10000 })
    await page.getByRole('radio').nth(1).check()           // debt review, the second of the seven
    await page.locator('textarea').first().fill('Debt counsellor 17 of 2019 wrote in')
    await page.getByRole('button', { name: 'Put it on hold' }).click()
    await page.waitForTimeout(700)

    const hold = sent.find((s) => s.startsWith('hold_account'))
    t.ok('putting it on hold reaches the database', !!hold)
    t.ok('...with the reason the firm picked', /debt_review/.test(hold ?? ''))
    t.ok('...and with what happened, in their words',
      /Debt counsellor 17 of 2019 wrote in/.test(hold ?? ''))
    /*
     * AND WITH A DATE TO COME BACK. The firm's rule: an account parked with nobody booked to look
     * at it again is the hole the whole diary design exists to close. The database refuses one
     * without it; this is what stops the box ever sending one.
     */
    t.ok('...and a review date', /"p_review_on":"\d{4}-\d{2}-\d{2}"/.test(hold ?? ''))
    await context.close()
  }

  /* ---- On hold -> Active ---- */
  {
    sent.length = 0
    const { context, page } = await open(browser, '/accounts/a-hold')
    await page.waitForSelector('text=Back to active', { timeout: 15000 })
    await page.getByRole('button', { name: 'Back to active' }).click()
    await page.waitForSelector('text=Why it is coming back', { timeout: 10000 })
    await page.locator('textarea').first().fill('Debt review withdrawn by the counsellor')
    await page.getByRole('button', { name: 'Back on the active book' }).click()
    await page.waitForTimeout(700)

    const rel = sent.find((s) => s.startsWith('release_account'))
    t.ok('taking it off hold reaches the database', !!rel)
    t.ok('...with why it is being worked again',
      /Debt review withdrawn by the counsellor/.test(rel ?? ''))
    await context.close()
  }

  /* ---- Closed -> Active, which is rule 6: a closed account re-opens with a reason ---- */
  {
    sent.length = 0
    const { context, page } = await open(browser, '/accounts/a-closed')
    await page.waitForSelector('text=Re-open', { timeout: 15000 })
    const body = await page.locator('main').innerText()
    /* THE BOOK IS ON THE ACCOUNT, which is the first thing anybody wants off this panel and the
       one thing the screen could not say. */
    t.ok('the account says which book it is in', body.includes('Closed'))

    await page.getByRole('button', { name: 'Re-open' }).click()
    await page.waitForSelector('text=Why it is coming back', { timeout: 10000 })
    /* A CLOSED ACCOUNT RE-OPENS RATHER THAN HOLDING TWO STATES AT ONCE, and the box says so. */
    t.ok('re-opening says the closure is cleared',
      (await page.locator('body').innerText()).includes('closure is cleared'))
    await page.locator('textarea').first().fill('Compromise fell through')
    await page.getByRole('button', { name: 'Re-open it' }).click()
    await page.waitForTimeout(700)

    const reopen = sent.find((s) => s.startsWith('release_account'))
    t.ok('re-opening reaches the same function', !!reopen)
    t.ok('...with the reason', /Compromise fell through/.test(reopen ?? ''))
    await context.close()
  }
} finally {
  await browser.close()
  stopServer(server)
}

t.finish(`Three books, chosen at the top of the Accounts screen, with Active where it opens. The
shortcuts exist only inside Active. An account moved Active to On hold to Active, and a closed one
re-opened, each sending its own reason to the database.`)

/**
 * The To box remembering people, in a real browser.
 *
 * THE RULES ARE CHECKED BESIDE THIS FOLDER and none of that can tell you the panel never opened,
 * that the X addressed the message to the person it was meant to forget, or that the dismissal
 * never reached the database. This is a control somebody uses forty times a day with their hands
 * on the keyboard — whether it WORKS is not a question source can answer.
 *
 * Run: node scripts/qa/e2e/recipient-field.mjs
 */
import {
  OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer,
} from './harness.mjs'
import { COMPANY, PROFILE, TEAM, USER_ID, accountsPage } from './fixtures.mjs'

const t = makeRunner('recipient-field')

/* Everyone this person has written to, as the history function would hand it back. */
const HISTORY = [
  { address: 'accounts@bredellferreira.co.za', name: null, uses: 40, last_used: '2026-09-19T08:00:00Z' },
  { address: 'r.buitendag@gpsprop.co.za', name: 'Reno Buitendag', uses: 9, last_used: '2026-09-10T08:00:00Z' },
  { address: 'andries@moloto.co.za', name: 'Andries Moloto', uses: 3, last_used: '2026-09-18T08:00:00Z' },
]

/** Everything the page tried to hide, so the test can prove the X left the browser. */
const hidden = []

/*
 * AND A DEBTOR'S FILE WITH TWO EMAIL ADDRESSES ON IT, which is the second half of this file.
 *
 * RRC00004's shape exactly: the notice goes to an address at the company's own domain and there is
 * a private one beside it. The firm, looking at that account's Cc box: "if you're on a debtor's
 * file and it asks you to CC someone and there's an alternative email address, it should kind of
 * give you the option to do that."
 */
const ACCOUNT = { ...accountsPage(1)[0], id: 'acc-0000' }
const contact = (id, value, primary, created) => ({
  id, account_id: ACCOUNT.id, kind: 'email', value, label: null,
  person_name: null, person_role: null, is_primary: primary,
  verified_at: null, retired_at: null, retired_reason: null, notes: null,
  created_at: created,
})
const WORK = 'stephan@urbanhausgroup.co.za'
const HOME = 'stephan@gmail.com'
/* RETIRED, so it is not offered: an address the firm has already found to be dead is not an
   alternative, and a Cc to it is a bounce on a statutory notice. */
const DEAD = 'stephan@oldfirm.co.za'

const handlers = [
  [(u, r) => /mail_recipient_hidden/.test(u) && r.method() === 'POST',
    (u, r) => { hidden.push(r.postData() ?? ''); return { body: [] } }],
  [(u) => /rpc\/mail_recipient_history/.test(u), () => ({ body: HISTORY })],
  /*
   * THE SIGNED-IN PERSON, ANSWERED EVERY TIME THEY ARE ASKED FOR. AuthContext re-reads the profile
   * while the app is open, and an unanswered read tears the whole app down to "We couldn't load
   * your profile" -- which took the composer, the account and the panel with it a few seconds
   * after the modal opened. A fixture that answers the first read and not the second is a test
   * that fails somewhere else entirely.
   */
  [(u) => u.includes('/auth/v1/user'), () => ({ body: { id: USER_ID, email: PROFILE.email } })],
  [(u) => u.includes('/rest/v1/profiles'), () => ({ body: [PROFILE] })],
  [(u) => u.includes('/rest/v1/companies'), () => ({ body: [COMPANY] })],
  [(u) => u.includes('/rest/v1/teams'), () => ({ body: [TEAM] })],
  [(u) => u.includes('/rest/v1/debtor_accounts'),
    () => ({ body: [ACCOUNT], headers: { 'content-range': '0-0/1' } })],
  [(u) => u.includes('/rest/v1/account_contacts'), () => ({
    body: [
      contact('ct-1', WORK, true, '2026-03-01T08:00:00Z'),
      contact('ct-2', HOME, false, '2026-04-01T08:00:00Z'),
      { ...contact('ct-3', DEAD, false, '2026-02-01T08:00:00Z'), retired_at: '2026-05-01T08:00:00Z' },
    ],
  })],
]

const server = await startServer()
let browser
try {
  browser = await chromium.launch()
  const { page } = await signedInPage(browser, PROFILE, handlers, [])

  let up = false
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/mail`, { timeout: 2000 }); up = true; break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  t.ok('the dev server answers', up)

  await page.getByRole('button', { name: 'New email' }).waitFor({ timeout: 20000 })
  await page.getByRole('button', { name: 'New email' }).click()
  /* A <select> has the combobox role too and the mail page is full of them, so the To box is
     found as the INPUT that carries it. */
  const to = page.locator('input[role="combobox"]')
  /* Scoped to the panel: every <option> in the page's own selects carries the option role too, so
     an unscoped getByRole('option') resolves to "All mail" in the folder filter. */
  const list = page.locator('ul[role="listbox"]')
  const options = list.locator('li[role="option"]')
  await to.waitFor({ timeout: 10000 })

  /*
   * IT IS A COMBOBOX, NOT A DATALIST. That is the change: a datalist's matching belongs to the
   * browser, it cannot show a name beside an address, and there is no way to take an entry out.
   */
  t.check('the To box is a combobox', await to.getAttribute('role'), 'combobox')
  t.check('...that offers a list rather than a fixed set of options',
    await to.getAttribute('aria-autocomplete'), 'list')
  t.check('...and nothing is left of the datalist', await page.locator('datalist').count(), 0)

  /*
   * NOTHING UNTIL SOMETHING IS TYPED.
   *
   * It offered the six most-written-to addresses the moment the box took focus, and the firm's
   * first word on it was that this is too much: "it shouldn't automatically already throw you out
   * all the options that there is... if you type R, then all the R's should start to come up."
   *
   * Asserted in the browser as well as against the function, because the panel has two ways of
   * opening -- focus and typing -- and the rule that matters is about what is ON SCREEN, not
   * about what the matcher returned. The field carries autoFocus, so it already has focus here
   * and the empty box is the state the modal opens in.
   */
  t.check('an empty box offers nothing at all', await options.count(), 0)
  /* And the same after typing and clearing: back to an empty box is back to no panel. */
  await to.fill('a')
  await options.first().waitFor({ timeout: 5000 })
  t.ok('...though one letter does', await options.count() > 0)
  await to.fill('')
  await page.waitForTimeout(300)
  t.check('...and clearing it puts the panel away again', await options.count(), 0)

  /* ---------- the firm's own test ---------- */

  /*
   * "I CAN PASTE IN R, E, N, AND THEN IT PICKS IT UP." Reno's address starts with r.buitendag, so
   * this is exactly the case a list matching addresses alone fails — which is what was there.
   */
  await to.fill('REN')
  await options.first().waitFor({ timeout: 5000 })
  const found = await options.allInnerTexts()
  t.check(`REN finds one person (${found.length})`, found.length, 1)
  t.ok('...and it is Reno', /Reno Buitendag/.test(found[0]))
  t.ok('...shown with the address under the name', /r\.buitendag@gpsprop\.co\.za/.test(found[0]))
  await t.shot(page, '10-suggestions')

  /* Clicking it fills the box and closes the panel. */
  await options.first().locator('button').first().click()
  t.check('picking one fills the address', await to.inputValue(), 'r.buitendag@gpsprop.co.za')
  t.check('...and closes the list', await list.count(), 0)

  /* The keyboard does the same thing, which is how a To box is actually used. */
  await to.fill('and')
  await options.first().waitFor({ timeout: 5000 })
  await to.press('ArrowDown')
  await to.press('Enter')
  t.check('the keyboard picks one too', await to.inputValue(), 'andries@moloto.co.za')

  /* ---------- the X ---------- */

  /*
   * THE X HAS TO REACH THE DATABASE. The suggestion is derived from sent mail that is still there,
   * so anything less than a stored dismissal brings it straight back on the next query — the X
   * would look like it worked until the next time the box was opened.
   */
  await to.fill('REN')
  await options.first().waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: 'Forget r.buitendag@gpsprop.co.za' }).click()
  await page.waitForTimeout(400)
  t.check(`the dismissal was sent (${hidden.length})`, hidden.length, 1)
  t.ok('...naming the address to forget', /r\.buitendag@gpsprop\.co\.za/.test(hidden[0]))

  /*
   * AND THE X MUST NOT ADDRESS THE MESSAGE TO THE PERSON IT JUST FORGOT. A button inside a button
   * is invalid markup and the browser gives the click to the outer one, so the X would fill the To
   * box with exactly the address somebody was trying to be rid of. The two are siblings for that
   * reason and this is the assertion that keeps them siblings.
   */
  t.check('...and the box was not filled with them', await to.inputValue(), 'REN')
  /* It is gone from the list on the spot rather than after a round trip. */
  t.check('...and the row is gone at once', await options.count(), 0)

  await t.shot(page, '20-forgotten')

  /* ---------- and on a debtor's file, the file itself ---------- */

  /*
   * THE FIRM: "if you're on a debtor's file and it asks you to CC someone and there's an
   * alternative email address, it should kind of give you the option to do that."
   *
   * WHY THIS IS IN A BROWSER AND NOT ONLY IN check-recipient-suggest. The rule is one line in
   * rankOf and the assertion beside it proves the rule; what it cannot prove is that the panel
   * ever appears on a focused empty box in the app -- the Cc field has to exist, be handed the
   * account's contacts, take focus, and render rows. That is four pieces of wiring between the
   * rule and the firm's eyes, and the empty box is the ONE state the panel used to refuse to open
   * in.
   */
  await page.goto(`http://localhost:${PORT}/accounts/${ACCOUNT.id}`)
  await page.getByRole('button', { name: 'Email' }).first().waitFor({ timeout: 20000 })
  await page.getByRole('button', { name: 'Email' }).first().click()
  /* THE CC BOX IS ALREADY THERE on an account: AccountDetail holds a Cc of its own, so the field
     is shown rather than hidden behind "Add Cc" -- which is the screen the firm was looking at. */
  const boxes = page.locator('input[role="combobox"]')
  await boxes.nth(1).waitFor({ timeout: 10000 })
  /*
   * AND THEN LET THE PAGE SETTLE, which is not padding. The composer is handed
   * `workspace?.contacts`, and the account page reloads that workspace after it first draws -- so
   * for a moment the modal is open with no contacts behind it and the Cc box has nothing to
   * offer. A person clicking a field they can see has long since passed that moment; a test that
   * clicks the instant the input exists lands inside it.
   */
  await page.waitForTimeout(2500)
  t.check('the composer has a To box and a Cc box', await boxes.count(), 2)
  const toBox = boxes.first()
  const ccBox = boxes.nth(1)
  t.check('...with the account’s address already on the To line', await toBox.inputValue(), WORK)

  /* FOCUSED AND EMPTY, which is the state in the firm's screenshot. */
  await ccBox.click()
  const ccList = page.locator('ul[role="listbox"]')
  /*
   * WAITED FOR AND THEN COUNTED, rather than waited for and assumed. A locator that never resolves
   * THROWS, which ends the file on a stack trace two lines above the assertion that should have
   * said what was wrong -- the trap CLAUDE.md names. Breaking the rule in rankOf has to produce
   * "offers the file: expected 1, got 0", not a timeout.
   */
  await ccList.first().waitFor({ timeout: 4000 }).catch(() => {})
  const offered = await ccList.locator('li[role="option"]').allInnerTexts()
  t.check(`an empty Cc on a debtor’s file offers the file (${offered.length})`, offered.length, 1)
  /*
   * THE ALTERNATIVE, AND ONLY THE ALTERNATIVE. Three assertions in one list: the second address is
   * there, the one already on the To line is not -- a Cc to it sends the debtor two copies of one
   * notice -- and the retired one is not either.
   */
  t.ok('...which is the alternative address', (offered[0] ?? '').includes(HOME))
  t.ok('...not the address it is already going to', !offered.join(' ').includes(WORK))
  t.ok('...and not one the firm has retired', !offered.join(' ').includes(DEAD))
  /* IT SAYS WHERE THEY CAME FROM. Nobody typed anything, so these rows are an offer rather than a
     result, and an unexplained list under an untouched box is what the firm objected to. */
  t.ok('...under a line saying what is being offered',
    await page.getByText('Already on this file').count() > 0)
  /* AND NOT ONE REMEMBERED ADDRESS BESIDE THEM, which is the firm's earlier instruction and the
     reason the two can live together: the file is two rows, history is two hundred. */
  t.ok('...and nobody out of history', !offered.join(' ').includes('r.buitendag@gpsprop.co.za'))
  await t.shot(page, '30-cc-on-a-file')

  /* AND TYPING STILL REACHES THE WHOLE BOOK from the same box, or the offer has replaced the
     search rather than filled the gap in front of it. */
  await ccBox.fill('REN')
  await ccList.locator('li[role="option"]').first().waitFor({ timeout: 4000 }).catch(() => {})
  t.ok('typing in the same box still finds a remembered person',
    (await ccList.locator('li[role="option"]').allInnerTexts()).join(' ').includes('Reno Buitendag'))
} finally {
  if (browser) await browser.close()
  stopServer(server)
}

const good = t.finish(`
REN finds Reno, whose address begins with r.buitendag — the case a list matching addresses alone
fails, which is what the To box did before. The X reaches the database, because the suggestion is
derived from sent mail that is still there; and it does not address the message to the person it
was just asked to forget, which is what a button inside a button would have done.

And on a debtor's file the empty Cc box offers that file: the alternative address, without the one
the notice is already going to and without the one the firm retired — the thing nobody can guess
the first letter of. Screenshots in ${OUT}.`)
process.exit(good ? 0 : 1)

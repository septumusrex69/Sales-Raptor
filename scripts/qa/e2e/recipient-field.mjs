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
import { PROFILE } from './fixtures.mjs'

const t = makeRunner('recipient-field')

/* Everyone this person has written to, as the history function would hand it back. */
const HISTORY = [
  { address: 'accounts@bredellferreira.co.za', name: null, uses: 40, last_used: '2026-09-19T08:00:00Z' },
  { address: 'r.buitendag@gpsprop.co.za', name: 'Reno Buitendag', uses: 9, last_used: '2026-09-10T08:00:00Z' },
  { address: 'andries@moloto.co.za', name: 'Andries Moloto', uses: 3, last_used: '2026-09-18T08:00:00Z' },
]

/** Everything the page tried to hide, so the test can prove the X left the browser. */
const hidden = []

const handlers = [
  [(u, r) => /mail_recipient_hidden/.test(u) && r.method() === 'POST',
    (u, r) => { hidden.push(r.postData() ?? ''); return { body: [] } }],
  [(u) => /rpc\/mail_recipient_history/.test(u), () => ({ body: HISTORY })],
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
   * Opening it with nothing typed offers the people written to most, not nothing. Typed and
   * cleared rather than clicked: the field carries autoFocus, so it already has focus and a click
   * lands on the modal backdrop instead.
   */
  await to.fill('a')
  await to.fill('')
  await list.waitFor({ timeout: 5000 })
  const idle = await options.allInnerTexts()
  t.ok(`an empty box already offers somebody (${idle.length})`, idle.length >= 3)
  t.ok('...the one written to most often first', /accounts@bredellferreira/.test(idle[0]))

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
} finally {
  if (browser) await browser.close()
  stopServer(server)
}

const good = t.finish(`
REN finds Reno, whose address begins with r.buitendag — the case a list matching addresses alone
fails, which is what the To box did before. The X reaches the database, because the suggestion is
derived from sent mail that is still there; and it does not address the message to the person it
was just asked to forget, which is what a button inside a button would have done. Screenshots in
${OUT}.`)
process.exit(good ? 0 : 1)

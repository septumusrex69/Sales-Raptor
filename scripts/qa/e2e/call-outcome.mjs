/**
 * ONE NOTE, NOT TWO: THE CALL BOX RECORDS WHAT CAME OF THE CALL.
 *
 * THE FIRM, after their first afternoon of real calls: "the big thing and the big problem was the
 * note. So now you make a note of the telephone call, and then you make another note of, for
 * example, the dispute. Right? So you're double making notes. So notes should be made only at one
 * place." And what they wanted instead: "add a question -- as you raise a ticket, or you can raise
 * a PTP immediately from the screen. Either way, it records. And it's then accepted as spoken to
 * the debtor, so it charges the consultation and the other thing, the phone call."
 *
 * WHY THIS LAYER AND NOT A SOURCE CHECK. check-call-outcome holds the rules; what it cannot hold is
 * HOW MANY BOXES ARE ON THE SCREEN, which is the firm's whole complaint. "Notes should be made only
 * at one place" is a COUNT of textareas in a dialog after a dispute has been chosen, and only a
 * browser can count what a component decided to render. The old build drew a second field there,
 * and a check reading the file would have said both of them were correctly implemented.
 *
 * MEASURED AT 1024x768, the iPad the firm actually works on, because the box grew: five rungs, an
 * amount, a date and a classification went into a dialog that was 460 wide and is now 560. A panel
 * that is right on a 1440 laptop and clipped on their tablet is the fault they have sent back twice.
 *
 * Run: node scripts/qa/e2e/call-outcome.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { COMPANY, PROFILE, TEAM, USER_ID, accountsPage } from './fixtures.mjs'

const t = makeRunner('call-outcome')

const ACCOUNT = { ...accountsPage(1)[0], id: 'acc-0000', status: 'Active: Activated' }

/* THE TABLET, NOT THE LAPTOP. The box is at its tallest with a promise chosen, and this is the
   screen where that either fits or does not. */
const VIEWPORT = { width: 1024, height: 768 }

const seen = []
const handlers = [
  [(u) => u.includes('/auth/v1/user'), () => ({ body: { id: USER_ID, email: PROFILE.email } })],
  [(u) => u.includes('/rest/v1/profiles'), (u) => {
    const one = /id=eq\.([0-9a-f-]+)/.exec(u)?.[1]
    return { body: one ? [PROFILE].filter((p) => p.id === one) : [PROFILE] }
  }],
  [(u) => u.includes('/rest/v1/companies'), () => ({ body: [COMPANY] })],
  [(u) => u.includes('/rest/v1/teams'), () => ({ body: [TEAM] })],
  /*
   * A NUMBER ON THE ACCOUNT, or there is no Call button at all -- the row draws a disabled "No
   * phone number on this account yet" instead, and every assertion below would be unreachable.
   */
  [(u) => u.includes('/rest/v1/account_contacts'), () => ({
    body: [{
      id: 'ct-1', account_id: ACCOUNT.id, kind: 'mobile', value: '0824567890',
      label: null, person_name: null, person_role: null, is_primary: true,
      verified_at: null, retired_at: null, retired_reason: null, notes: null,
      created_at: '2026-03-01T08:00:00Z',
    }],
  })],
  /* THE CHARGE ENGINE ASKS POSTGRES FOR ITS THREE NUMBERS. Unanswered it reads capital as nought,
     the in duplum ceiling as nought, and nothing may be charged -- which would pass this file while
     quietly testing a dial that raised no fee. */
  [(u) => u.includes('/rpc/account_charge_basis'),
    () => ({ body: { capital: 750000, spent_on_item: 0, towards_ceiling: 0 } })],
  [(u) => u.includes('/rpc/nav_counts'), () => ({ body: { mail: 0, tasks: 0, disputes: 0, diary: 0 } })],
  [(u) => u.includes('/rest/v1/account_calls'), () => ({ body: { id: 'call-1' } })],
  [(u) => u.includes('/rest/v1/debtor_accounts'), () => ({
    body: [ACCOUNT], headers: { 'content-range': '0-0/1' },
  })],
]

const server = await startServer()
let browser
try {
  browser = await chromium.launch()
  const { context, page } = await signedInPage(browser, PROFILE, handlers, seen)
  await page.setViewportSize(VIEWPORT)

  let up = false
  for (let i = 0; i < 60 && !up; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/accounts/${ACCOUNT.id}`, { timeout: 2000 }); up = true }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  t.ok('the account opens', up)
  await page.waitForTimeout(2500)

  /* ---------------- the box the call ends in ---------------- */

  /*
   * ASKED FOR BEFORE IT IS CLICKED. A bare click on a locator that is not there times out thirty
   * seconds later and takes the run down before one failure has printed.
   */
  const call = page.getByRole('link', { name: /^Call$/ }).or(page.getByRole('button', { name: /^Call$/ }))
  await call.first().waitFor({ timeout: 20000 }).catch(() => {})
  const canCall = await call.count() > 0
  t.ok('the account can be rung', canCall)

  if (canCall) {
    /*
     * WITHOUT BUZZBOX THIS IS A tel: LINK, which is what the firm's tablets use anyway -- see
     * PhoneLink. Nothing reports back on one, so the box opens straight away rather than waiting
     * for a call-ended webhook, which is the path this file wants.
     */
    await call.first().click()
    await page.waitForTimeout(2000)

    const modal = page.locator('[data-modal-open]')
    t.ok('the call ends in a question', await modal.count() > 0)
    const asked = await modal.innerText()
    t.ok('...which is whether somebody was spoken to', /did you speak to them/i.test(asked))
    /* AND THE DIAL WAS CHARGED AND RECORDED, so what follows is tested on a real call rather than
       on a box that opened after a failure. */
    t.ok('the call went on the timeline', seen.some((s) => /POST \/rest\/v1\/account_calls/.test(s)))
    t.ok('...and item 2 was raised for it', seen.some((s) => /POST \/rest\/v1\/account_fees/.test(s)))

    /* ---------------- ONE PLACE TO TYPE ---------------- */

    /*
     * THE ASSERTION THIS FILE EXISTS FOR, AND IT IS A COUNT. One box before anything is chosen,
     * and -- the half that was broken -- still one after a dispute is.
     */
    t.check('there is one place to type', await modal.locator('textarea').count(), 1)
    t.ok('...and it is the call s own note', /what was said/i.test(asked))

    /* ---------------- the five rungs, and not the three ---------------- */

    const rung = (name) => modal.getByRole('button', { name, exact: true })
    for (const name of ['Arranged', 'Negotiating', 'Cannot pay', 'Refusing to pay', 'Disputed']) {
      t.ok(`${name} can be recorded from the call`, await rung(name).count() === 1)
    }
    /*
     * AND NOT THE THREE THAT MEAN NOBODY WAS REACHED. This is a FEE assertion, not a tidiness one:
     * choosing a rung here is the press that raises the R60 consultation, so "In progress" beside
     * it would charge a conversation for a voicemail -- the exact bug this box was built to end.
     */
    for (const name of ['In progress', 'Tracing', 'Under administration']) {
      t.ok(`...and ${name} is not, because nobody was reached`, await rung(name).count() === 0)
    }

    /* ---------------- a dispute, raised from here, with no second note ---------------- */

    /*
     * THE NOTE IS WRITTEN FIRST, which is the order the box asks in and the order the firm agreed:
     * the words are in somebody's head the second the receiver goes down, the rung is still true a
     * minute later. Typed BEFORE the rung is chosen, because the panel says different things with
     * and without it -- asserting the empty state and calling it the filled one is the trap this
     * file's neighbours keep walking into.
     */
    await modal.locator('textarea').fill(
      'Says the last two invoices were for work that was never delivered.')
    await rung('Disputed').click()
    await page.waitForTimeout(400)
    const withDispute = await modal.innerText()

    /*
     * THE FIRM'S SENTENCE, AS A NUMBER.
     *
     * COUNTED OVER EVERY SHAPE A PLACE TO TYPE COMES IN, and this is the whole lesson of the file.
     * Written as `textarea` alone it passed with the second box drawn -- the picker's own words
     * field is an `<input>`, so the count stayed at one while the screen had two. Nothing on a
     * dispute asks for a number or a date, so any typing surface beyond the first is the fault.
     */
    /*
     * AND "WHO DID YOU SPEAK TO" IS EXCLUDED BY NAME RATHER THAN BY RAISING THE NUMBER.
     *
     * The firm widened item 7 to any conversation about the account -- "the debtor's mother... the
     * receptionist or the accounts lady" -- so the box now asks who was spoken to. That is a
     * different question from what was said, and it is not a second note.
     *
     * COUNTED AROUND IT, NOT COUNTED UP TO TWO. Loosening this to 2 would let a genuine second
     * note back in tomorrow and nobody would notice, which is exactly how the double note-taking
     * the firm complained about got in the first time.
     */
    const TYPE_INTO = 'textarea, input:not([type]), input[type="text"]'
    const NOTES = `:is(${TYPE_INTO}):not([name="spoke-to"])`
    t.check('a dispute asks for no second note', await modal.locator(NOTES).count(), 1)
    /* AND THE WHO IS THERE, ONCE, so the exclusion above cannot be hiding its disappearance. */
    t.check('...and who you spoke to is asked once',
      await modal.locator('[name="spoke-to"]').count(), 1)
    /* AND NOT BY ITS LABEL EITHER, which is what the second box said when it was there. */
    t.ok('...and nothing asks the same question twice',
      !/what do they dispute|say what they told you/i.test(withDispute))
    t.ok('...and says the call s own note is what the client is told',
      /goes to the client/i.test(withDispute))
    /* AND THE SENTENCE IS STILL THERE. A second field that cleared the first would count as one
       box and lose the words, which is the other way to "fix" this. */
    t.ok('...and the words typed before it are still in it',
      await modal.locator('textarea').inputValue() === 'Says the last two invoices were for work '
        + 'that was never delivered.')
    /* AND IT STILL ASKS WHAT KIND. Compulsory at the firm's own instruction, and dropping it to
       save a field would be the other way to fail this. */
    t.ok('...and still asks what kind of dispute', /what kind of dispute/i.test(withDispute))
    t.check('...with a classification to pick', await modal.locator('select').count(), 1)

    /*
     * AND THE VOICEMAIL BUTTON IS OFF. All five rungs mean somebody was reached, so "Arranged" and
     * "nobody picked up" on one press cannot both be true -- and whichever way the fee landed it
     * would be wrong.
     */
    const voicemail = modal.getByRole('button', { name: /Voicemail or no answer/ })
    t.ok('a chosen rung rules out the voicemail', await voicemail.isDisabled())
    /* AND THE OTHER BUTTON SAYS WHAT IT IS ABOUT TO DO, because it now writes a record as well as
       charging a consultation. */
    t.ok('...and the save button names the rung',
      await modal.getByRole('button', { name: /I spoke to them . Disputed/ }).count() === 1)

    await t.shot(page, 'call-outcome-dispute-from-the-call')

    /* ---------------- a promise, taken from the same box ---------------- */

    await rung('Arranged').click()
    await page.waitForTimeout(400)
    /* THE AMOUNT AND THE DATE ARE TYPED INTO AS WELL, so the surface count here is three rather
       than one -- the one that matters is that the NOTE is still a single box. */
    t.check('a promise asks for no second note either', await modal.locator('textarea').count(), 1)
    t.ok('...and asks nothing in words at all',
      !/say what they told you|what do they dispute/i.test(await modal.innerText()))
    /* THE AMOUNT AND THE DATE, which are what make it a promise rather than a status. */
    t.ok('...but does ask how much', await modal.getByText(/How much/).count() > 0)
    t.ok('...and by when', await modal.locator('input[type="date"]').count() === 1)

    /* ---------------- and it fits on the firm's tablet ---------------- */

    /*
     * THE BOX IS AT ITS TALLEST HERE -- five rungs, a hint, an amount, a date, the main-comment
     * tick, the fee line and two buttons. Measured rather than eyeballed, because "it views very
     * small" and "that one is weird" are the two pieces of feedback this screen has already had.
     */
    const card = modal.locator('> div').first()
    const fit = await card.evaluate((el) => ({
      clipped: el.scrollWidth > el.clientWidth + 1,
      width: el.getBoundingClientRect().width,
    }))
    t.ok('nothing is cut off sideways on the tablet', !fit.clipped)
    t.ok('...and the box is inside the screen', fit.width <= VIEWPORT.width)
    /*
     * AND THE PRESS IS REACHABLE. A dialog that scrolls is fine -- the firm asked for exactly that
     * on the escalate box -- but a save button nobody can get to is not, and a tall card with no
     * scroll is how that happens.
     */
    const scroll = await card.evaluate((el) => ({
      scrollable: el.scrollHeight > el.clientHeight,
      atTop: el.scrollTop === 0,
    }))
    t.ok('...and it opens at its own question', scroll.atTop)
    const save = modal.getByRole('button', { name: /I spoke to them/ })
    if (scroll.scrollable) await save.scrollIntoViewIfNeeded()
    t.ok('the press is reachable', await save.isVisible())

    /*
     * THE FIVE RUNGS ON ONE ROW, which is why the grid is five wide rather than four with an
     * orphan: four and one reads as a category of its own.
     *
     * BY EXACT NAME, one at a time. Written as one `button:has-text("Arranged")` selector it also
     * matched the SAVE button -- which by then reads "I spoke to them . Arranged" -- and reported
     * a one-row grid as two rows. has-text is a substring.
     */
    const tops = []
    for (const name of ['Arranged', 'Negotiating', 'Cannot pay', 'Refusing to pay', 'Disputed']) {
      const box = await rung(name).boundingBox()
      if (box) tops.push(Math.round(box.y))
    }
    t.check('all five rungs were measured', tops.length, 5)
    t.ok('...and they sit on one row', new Set(tops).size === 1)

    await t.shot(page, 'call-outcome-promise-from-the-call')
  }

  await context.close()
} catch (e) {
  /* A CRASH IS A FAILURE, REPORTED. Thrown out of the try the run prints a stack and no count, and
     run-all reads the count -- so a file that reports nothing is a file nobody sees. */
  t.ok(`the run finished without throwing (${String(e).slice(0, 200)})`, false)
} finally {
  if (browser) await browser.close()
  await stopServer(server)
}

t.finish('A call is written up once, and the promise or the dispute is taken from the same box.')

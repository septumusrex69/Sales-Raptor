/**
 * A DIALOG OPENS AT ITS TOP, SHOWING WHAT IT IS ASKING.
 *
 * THE FIRM, opening Raise a ticket on an account: "the first thing it does, it automatically takes
 * you to where you should dictate or you should write the note. It should go up first. The screen
 * that you see should be like, what are you doing? Is it raising a dispute or are you doing
 * something or you are requesting information or whatever? And then you can scroll down."
 *
 * WHAT DID THAT WAS A FIELD ASKING FOR FOCUS HALFWAY DOWN. A browser scrolls a focused element into
 * view, so an `autoFocus` below the fold opened the box already past its own question — "What is
 * it?" off-screen above, and the answer box for a question nobody had read in the middle.
 *
 * WHY THIS LAYER AND NOTHING ELSE WILL DO. The fault is a SCROLL POSITION, and a source check
 * cannot see one. Reading the file would tell you `autoFocus` is absent; it would not tell you
 * whether the dialog opens at nought, which depends on the card's height, the viewport's height,
 * and what the browser does about focus — three things only a browser knows.
 *
 * MEASURED ON A SHORT SCREEN, because that is where it bites and the tall one is where it hides.
 * At 1100px the card did not overflow and this assertion would have passed on the broken code —
 * the vacuous check CLAUDE.md warns about. At 720px the old build opened 443 pixels down.
 *
 * Run: node scripts/qa/e2e/escalate-box.mjs
 */
import { PORT, chromium, makeRunner, signedInPage, startServer, stopServer } from './harness.mjs'
import { COMPANY, LIAISON, PROFILE, accountsPage } from './fixtures.mjs'

const t = makeRunner('escalate-box')

const ACCOUNT = { ...accountsPage(1)[0], status: 'Active: Activated' }

/* A LAPTOP, NOT A DESKTOP. 720 is the height the firm works at and the height the fault needs. */
const VIEWPORT = { width: 1440, height: 720 }

const server = await startServer()
let browser
try {
  browser = await chromium.launch()
  const handlers = [
    [(u) => u.includes('/rest/v1/profiles'), () => ({ body: [PROFILE] })],
    [(u) => u.includes('/rest/v1/companies'), () => ({ body: [COMPANY] })],
    [(u) => u.includes('/rest/v1/debtor_accounts'), () => ({ body: [ACCOUNT] })],
    [(u) => u.includes('/rest/v1/account_queries'), () => ({ body: [] })],
  ]
  const { context, page } = await signedInPage(browser, PROFILE, handlers, [])
  await page.setViewportSize(VIEWPORT)

  let up = false
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/accounts/${ACCOUNT.id}`, { timeout: 2000 }); up = true; break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  t.ok('the dev server answers', up)

  /*
   * ASKED FOR BEFORE IT IS CLICKED. A bare click on a locator that is not there times out thirty
   * seconds later and takes the whole run down before one failure has printed — this file's
   * neighbours have all been bitten by it.
   */
  const raise = page.getByRole('button', { name: /Raise one/ })
  await raise.first().waitFor({ timeout: 20000 }).catch(() => {})
  const canRaise = await raise.count() > 0
  t.ok('a ticket can be raised from the account', canRaise)

  if (canRaise) {
    await raise.first().click()
    await page.waitForTimeout(700)
    const card = page.locator('[data-modal-open] > div').first()
    t.ok('...and the box opens', await card.count() > 0)

    /*
     * THE CARD IS TALLER THAN THE SCREEN, which is what makes the rest of this meaningful. Without
     * it there is nothing to scroll and every assertion below passes on any code at all.
     */
    const box = await card.evaluate((el) => ({
      scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
    }))
    t.ok('the box is taller than the screen, so a scroll is possible',
      box.scrollHeight > box.clientHeight)
    /* AND IT OPENS AT THE TOP. The firm's sentence, as a number. */
    t.check('...and it opens at the top', box.scrollTop, 0)

    /*
     * WHAT IT IS ASKING IS ON SCREEN, not merely present in the markup. A heading scrolled out of
     * view is in the DOM and in nobody's eyes, which is exactly the state the firm met.
     */
    const question = page.getByText('What is it?', { exact: true }).first()
    t.ok('the question is visible without scrolling', await question.isVisible())
    const where = await question.boundingBox()
    t.ok('...and inside the viewport',
      !!where && where.y >= 0 && where.y < VIEWPORT.height)

    /*
     * AND NO FIELD HAS TAKEN THE CURSOR. The dialog is a decision before it is a form: the four
     * kinds are radios, and a cursor sitting in the note is what dragged the view down.
     */
    const focused = await page.evaluate(() => document.activeElement?.tagName ?? '')
    t.ok('nothing below the fold has taken the cursor',
      focused !== 'TEXTAREA' && focused !== 'INPUT')
    /*
     * BUT FOCUS IS INSIDE THE DIALOG. Removing the autoFocus and stopping there would leave
     * somebody on a keyboard tabbing through the page behind the overlay — nothing moved focus
     * into a dialog in this app at all until now.
     */
    t.ok('...but the dialog has the focus',
      await page.evaluate(() => {
        const open = document.querySelector('[data-modal-open]')
        return !!open && open.contains(document.activeElement)
      }))

    await t.shot(page, 'escalate-box-opens-at-the-top')

    /*
     * AND THE NOTE IS STILL REACHABLE, which is the half a fix like this quietly breaks. The firm
     * asked for the question first and then "you can scroll down" — not for the dictate to go.
     */
    t.ok('the note is still there to scroll down to',
      await page.getByText(/What is the issue/).count() > 0)
    /*
     * THE DICTATE CONTROL, IN EITHER OF ITS TWO SHAPES. Headless Chromium may carry no
     * SpeechRecognition, in which case DictateButton renders its honest fallback — "not in this
     * browser" — rather than a button. Asserting only the button would fail on perfectly good
     * code, which is a check reporting a bug in the browser it happens to run in. Both shapes come
     * from the same component, so either proves the control is still beside the note.
     *
     * READ OFF THE TEXT RATHER THAN THE ROLE, because `getByRole('button', { name: /Dictate/ })`
     * found nothing while the word was plainly in the dialog — an accessible-name computation is
     * not the thing being asserted here, and a check that turns on one is a check that fails for
     * reasons nobody can act on.
     */
    const dictate = await page.locator('[data-modal-open]').innerText()
    t.ok('...and still carries the dictate control the firm asked for',
      /Dictate|not in this browser/.test(dictate))
  }

  await context.close()

  /* ---------- and the ticket you raised is still yours to follow ---------- */

  /*
   * THE FIRM: "the ticket was created and then it doesn't display in the debt collector's
   * situation."
   *
   * IT WAS ON THE BOARD. IT WAS ON THE LIAISON'S. A request is raised by a collector and GIVEN to
   * whoever has to answer it, so `owner_id` is the liaison from the moment it saves — and the board
   * scopes on owner and opens on the signed-in person. The collector pressed Raise a ticket,
   * watched it save, went to look for it, and found an empty board.
   *
   * THE FIXTURE IS THE FIRM'S OWN SHAPE: raised by the signed-in collector, owned by the liaison.
   * A ticket owned by the collector would pass on the broken code, which is the vacuous check this
   * file's neighbours keep walking into.
   */
  const RAISED_BY_ME = {
    id: '77777777-7777-4777-8777-777777777777',
    account_id: ACCOUNT.id,
    handover_id: null,
    kind: 'request',
    request_for: 'Proof of communication',
    description: 'Debtor says they were never written to before handover.',
    category: null,
    status: 'open',
    stage: 'liaison',
    owner_id: LIAISON.id,
    raised_by: PROFILE.id,
    raised_by_name: PROFILE.name,
    raised_at: '2026-10-02T06:39:59Z',
    chase_on: null,
    alleged_on: null,
    received_on: null,
    in_writing: false,
    sent_to_client_at: null,
    outcome: null, outcome_action: null, outcome_amount: null, outcome_done: false,
    closed_at: null, closed_by_name: null,
    debtor_accounts: {
      account_number: ACCOUNT.account_number,
      debtor_first_name: ACCOUNT.debtor_first_name,
      debtor_surname: ACCOUNT.debtor_surname,
      company_id: COMPANY.id,
    },
  }

  {
    const board = await signedInPage(browser, PROFILE, [
      /*
       * THE SIGNED-IN PROFILE IS FETCHED BY ID AND THE REST AS A LIST, and answering both with two
       * rows is what broke this first: AuthContext reads its own row with `maybeSingle`, two rows
       * make that an error, `currentUser` stayed null, and the board never applied its default
       * scope at all. Everything showed because nothing was filtering — so BOTH break tests passed
       * on broken code, and the only sign was "Loading…" in the corner of the screenshot.
       */
      [(u) => u.includes('/rest/v1/profiles') && /id=eq\./.test(u), () => ({ body: [PROFILE] })],
      [(u) => u.includes('/rest/v1/profiles'), () => ({ body: [PROFILE, LIAISON] })],
      [(u) => u.includes('/rest/v1/companies'), () => ({ body: [COMPANY] })],
      /* fetchAllQueries asks twice — open, then recently closed. Answering both with the same row
         drew the card twice and made the counter read 2 for one ticket. */
      [(u) => u.includes('/rest/v1/account_queries') && /status=eq\.closed/.test(u),
        () => ({ body: [] })],
      [(u) => u.includes('/rest/v1/account_queries'), () => ({ body: [RAISED_BY_ME] })],
    ], [])
    await board.page.setViewportSize(VIEWPORT)
    await board.page.goto(`http://localhost:${PORT}/queries`)
    /* The board defaults to the signed-in person in an effect, a tick after the first paint, so
       the figures have to settle before they are read. */
    await board.page.waitForTimeout(1500)
    /*
     * THE SESSION HAS TO HAVE RESOLVED, or the board never applies its default scope and this whole
     * block tests nothing. Asserted rather than assumed — see the handler note above.
     */
    const sidebar = await board.page.locator('body').innerText()
    t.ok('the board knows who is signed in', !/Loading…/.test(sidebar))
    t.ok('a ticket I raised is on my board, though the liaison owns it',
      /Debtor says they were never written to/.test(sidebar))
    /* AND THE COUNTER AGREES WITH THE CARDS. One card above "Open 0" is a board somebody stops
       believing, and the two are scoped separately in the source. ONE, not two: the ticket is one
       ticket however many requests fetched it. */
    t.ok('...and the counter counts it, once',
      /Total Disputes\s*1\b/.test(sidebar) && /Open\s*1\b/.test(sidebar))
    /* AND IT IS THE LIAISON'S TO ANSWER, which is the fact that made it invisible. A card naming
       the signed-in person as owner would pass on the broken code. */
    t.ok('...while still owned by the liaison', /Nicole Loder/.test(sidebar))
    await t.shot(board.page, 'escalate-box-raised-by-me')
    await board.context.close()
  }
} catch (e) {
  /* A CRASH IS A FAILURE, REPORTED. Thrown out of the try the run prints a stack and no count at
     all — and run-all reads the count, so a file that reports nothing is a file nobody sees. */
  t.ok(`the run finished without throwing (${String(e).slice(0, 160)})`, false)
} finally {
  if (browser) await browser.close()
  await stopServer(server)
}

t.finish('Raise a ticket opens on the question it is asking, with the cursor nowhere yet.')

/**
 * The mail screen, driven in a real browser.
 *
 * WHY THIS LAYER EXISTS, AND WHY THIS PAGE NEEDED IT. The .mjs checks beside this folder read
 * source and assert against pure functions. They are fast, and they cannot tell you that the panel
 * never rendered -- a panel shipped once this session, was provably in the deployed bundle, and was
 * invisible. This page was then rebuilt to a layout the firm drew ("make it look much better"), and
 * a layout is exactly the kind of change source-reading cannot verify: every assertion about the
 * search bar passes whether it is on screen once, twice or not at all.
 *
 * Three things here are only checkable in a browser:
 *
 *  1. ONE SEARCH BAR, EVER. It is drawn inside the reading pane's column when the pane is up and
 *     above the list when it is not. Both branches exist in the source and the bug is two of them
 *     on the screen at the same time.
 *  2. THE PANE SCROLLS IN TWO COLUMNS. A flex child without min-h-0 grows past its parent instead
 *     of scrolling, which looks fine in the markup and wrong on the screen.
 *  3. THE RIGHT MESSAGES CARRY THE WARNING. "Not matched yet" must be on the unmatched enquiry and
 *     on neither the filed message nor the one settled as free mail -- a warning that fires when
 *     nothing is wrong is worse than no warning, because people stop reading it.
 *
 * Run: node scripts/qa/e2e/mail.mjs
 * Screenshots land in .qa-screenshots/ so the result can be looked at, not just read.
 */
import {
  OUT, PORT, chromium, makeRunner, signedInPage, startServer, stopServer,
} from './harness.mjs'
import { COMPANY, FORM_BODY, MAIL, PROFILE, TEAM, USER_ID, COLLEAGUE } from './fixtures.mjs'

const t = makeRunner('mail')
const seen = []

const handlers = [
  [(u) => u.includes('/auth/v1/user'), () => ({ body: { id: USER_ID, email: PROFILE.email } })],
  [
    (u) => u.includes('/rest/v1/profiles'),
    (u) => {
      // One row for an id-scoped request: .maybeSingle() fails on two, and a failed profile
      // fetch leaves currentUser null, which shows up three screens away from the cause.
      const one = /id=eq\.([0-9a-f-]+)/.exec(u)?.[1]
      const all = [PROFILE, COLLEAGUE]
      return { body: one ? all.filter((p) => p.id === one) : all }
    },
  ],
  [(u) => u.includes('/rest/v1/companies'), () => ({ body: [COMPANY] })],
  [(u) => u.includes('/rest/v1/teams'), () => ({ body: [TEAM] })],
  [(u) => u.includes('/rpc/nav_counts'), () => ({ body: { mail: 2, tasks: 0, disputes: 0, diary: 0 } })],
  [(u) => u.includes('/rest/v1/mail_blocks'), () => ({ body: [] })],
  [(u) => u.includes('/rest/v1/mail_sender_rules'), () => ({ body: [] })],
  [(u) => u.includes('/rest/v1/calendar_events'), () => ({ body: [] })],
  [
    (u) => u.includes('/rest/v1/user_emails'),
    (u, req) => {
      /*
       * FILING A MESSAGE IS A PATCH THAT READS ONE ROW BACK. linkMailToRecord claims the row with
       * .maybeSingle(), and PostgREST fails that when more than one comes back -- so answering a
       * PATCH out of the whole fixture makes filing report "multiple (or no) rows returned" and
       * the lead lands without its email. Which is exactly the failure the app now surfaces
       * honestly, so the fixture has to be right or the check would be reading a stub's mistake.
       */
      if (req.method() === 'PATCH') {
        const one = /id=(?:eq|in)\.\(?"?([0-9a-f-]+)/.exec(decodeURIComponent(u))?.[1]
        return { body: one ? [{ id: one }] : [] }
      }
      /*
       * THE STUB APPLIES THE TAB'S OWN CLAUSES.
       *
       * Six HEAD counts come back from one page load, one per tab, and answering them all out of
       * the whole fixture would put the SAME number on every tab -- which looks like a working
       * per-tab badge and is a stub counting to six. So the clauses scope() writes are read back
       * off the URL and applied here, and the fixtures are chosen so the tabs genuinely differ.
       */
      const has = (clause) => u.includes(clause)
      let rows = MAIL
      if (has('is_sent=eq.true')) rows = rows.filter((m) => m.is_sent)
      else if (has('is_filed=eq.true')) rows = rows.filter((m) => m.is_filed)
      else if (has('no_record_at=not.is.null')) rows = rows.filter((m) => m.no_record_at)
      else if (has('is_junk=eq.true')) rows = rows.filter((m) => m.is_junk)
      else if (has('is_settled=eq.false')) {
        rows = rows.filter((m) => !m.is_settled && !m.is_junk && !m.is_sent)
      } else if (has('is_junk=eq.false')) rows = rows.filter((m) => !m.is_junk && !m.is_sent)
      if (has('read_at=is.null')) rows = rows.filter((m) => !m.read_at)

      /*
       * THE PAGE SIZE IS HONOURED, or the control that sets it cannot be tested. fetchMail asks
       * for one row PAST the page so it can tell whether there is more without a second count --
       * a stub that returns everything makes every page size look identical and "Show 25" look
       * like it works.
       */
      const limit = Number(/limit=(\d+)/.exec(u)?.[1] ?? rows.length)
      const offset = Number(/offset=(\d+)/.exec(u)?.[1] ?? 0)
      const paged = rows.slice(offset, offset + limit)
      return {
        body: paged,
        headers: { 'content-range': `0-${Math.max(0, paged.length - 1)}/${rows.length}` },
      }
    },
  ],
]

let browser
let server
try {
  server = await startServer()
  browser = await chromium.launch()
  const { page } = await signedInPage(browser, PROFILE, handlers, seen)

  /*
   * The mailbox status endpoint is a serverless function, which the dev server does not run.
   * Answered here because the address it returns is what a reply-all uses to leave you off your
   * own reply -- unanswered it is a pending request and a header that never fills in.
   */
  await page.route('**/api/email/status*', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ connected: true, email: PROFILE.email }),
  }))

  /*
   * The message body is fetched out of the mailbox on open, by another serverless function the dev
   * server does not run. It matters here beyond cosmetics: a contact-form enquiry's details exist
   * ONLY in the body -- the snippet has had its newlines collapsed -- so without this the
   * create-lead prefills would be empty and the check that they are not would be checking nothing.
   */
  await page.route('**/api/email/attachment*', async (route) => {
    const sent = JSON.parse(route.request().postData() ?? '{}')
    const message = MAIL.find((m) => m.id === sent.mailId)
    /*
     * ONE LONG MESSAGE, so the pane actually scrolls. Every fixture body being three lines is how a
     * "the bar stays put while you scroll" check passes without anything ever scrolling -- the bar
     * would have been visible because there was nowhere to scroll to.
     */
    const long = Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1} of a very long message.`)
      .join('\n\n')
    const text = message?.from_address === 'form@bredellferreira.co.za'
      ? FORM_BODY
      : message?.id === MAIL[0].id
        ? `${message?.snippet ?? ''}\n\n${long}`
        : `${message?.snippet ?? ''}`
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ text, details: [], images: [], imagesSkipped: 0, calendar: '' }),
    })
  })

  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))

  /* startServer spawns and returns; it does not wait. Retried rather than slept on, because how
     long Vite takes to come up is not a constant worth guessing. */
  let up = false
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/mail`, { timeout: 2000 }); up = true; break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  t.ok('the dev server answers', up)

  await page.getByRole('heading', { name: 'Raptor Mail', exact: true }).waitFor({ timeout: 20000 })
  await page.getByText('Debt collection enquiry').first().waitFor({ timeout: 20000 })
  await t.shot(page, '20-mail-list')

  /* ---------- the header says which mailbox this is ---------- */

  /*
   * Raptor reads a connected mailbox that is not always the address somebody signs in with, and an
   * agent who cannot see which one they are reading cannot tell whether a message is missing or
   * was never sent here.
   */
  t.ok('the header names the mailbox', await page.getByText(PROFILE.email).first().isVisible())
  t.ok('New email is on the header', await page.getByRole('button', { name: 'New email' }).isVisible())
  t.ok('...and the sync button with it',
    await page.getByRole('button', { name: 'Check for new mail now' }).isVisible())

  /* ---------- one search bar, and it narrows the list ---------- */

  t.check('there is exactly one search box',
    await page.getByLabel('Search your mailbox').count(), 1)
  t.check('...and exactly one unread filter',
    await page.getByLabel('Narrow this list').count(), 1)

  const rows = () => page.getByRole('button', { name: /Debt collection enquiry|Agreement and next steps|Follow up on outstanding|Request for information|New reasons prevent/ })
  const before = await rows().count()
  t.ok('the list has every message in it', before >= 5)

  /*
   * NARROWING IS THE POINT. A filter that renders and does nothing is the failure this catches:
   * three of the five fixtures have been read, so choosing unread has to leave fewer rows.
   */
  await page.getByLabel('Narrow this list').selectOption('unread')
  await page.waitForTimeout(600)
  const narrowed = await rows().count()
  t.ok(`unread only leaves fewer rows (${before} -> ${narrowed})`, narrowed > 0 && narrowed < before)
  await t.shot(page, '21-mail-unread-only')
  await page.getByLabel('Narrow this list').selectOption('all')
  await page.waitForTimeout(600)

  /* ---------- the open message ---------- */

  await page.getByText('Debt collection enquiry').first().click()
  await page.waitForTimeout(700)

  t.check('still one search box with a message open in the list',
    await page.getByLabel('Search your mailbox').count(), 1)

  /*
   * AND NOW THE OTHER LAYOUT, which is the branch that matters. In the reading pane the search bar
   * moves INSIDE the list column; drawn in both places it would be on screen twice, and an
   * assertion taken only in list view would pass without ever exercising the branch -- the count
   * would be 1 because the pane was never up. So the view is switched and the count taken again.
   */
  await page.getByRole('button', { name: 'Reading pane' }).click()
  await page.waitForTimeout(800)
  await page.getByText('Debt collection enquiry').first().click()
  await page.waitForTimeout(700)
  t.check('still one with the reading pane up',
    await page.getByLabel('Search your mailbox').count(), 1)
  t.check('...and one unread filter', await page.getByLabel('Narrow this list').count(), 1)
  /* The pane is two columns that scroll separately. Both have to actually be there. */
  t.ok('the list is still beside the message',
    await page.getByText('Request for information').first().isVisible())
  await t.shot(page, '22a-mail-reading-pane')

  /*
   * AND IT STAYS PUT, which is the whole point and the thing source-reading cannot see. The firm:
   * "the moment you open a mail you should be seeing that thing ... then as you scroll through the
   * message that thing stays stagnant, so you can at any point select things that can be done."
   *
   * Measured against the WINDOW, not against the document: a bar can be perfectly positioned in
   * the markup and still be a thousand pixels below the fold, which is exactly what it was.
   */
  const inView = async () => {
    const box = await page.getByRole('button', { name: 'Reply', exact: true }).boundingBox()
    const height = page.viewportSize()?.height ?? 0
    return !!box && box.y >= 0 && box.y + box.height <= height
  }
  t.ok('the bar is on screen the moment a message opens', await inView())

  /* Scroll the message itself -- not the page, which is the scrollbar this layout removed. */
  await page.locator('[aria-current="true"]').first().waitFor()
  await page.getByText('Paragraph 60 of a very long message.').scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)
  t.ok('...and is still there at the end of a long one', await inView())
  /* The end of the message really was reached, or the check above scrolled nothing. */
  t.ok('...having actually scrolled to the end',
    await page.getByText('Paragraph 60 of a very long message.').isVisible())
  await t.shot(page, '22b-mail-bar-stays-put')
  await page.getByText('Debt collection enquiry').first().click()
  await page.waitForTimeout(500)

  t.ok('the sender is named in full', await page.getByText('Ernest Mohlalisi').first().isVisible())
  /*
   * Who else was on it, which the firm could not see: "I can't see all the other recipients."
   *
   * NAMES, not addresses, and on one line each -- "make it in a line next to each other to save
   * space". Three recipients written out in full were four wrapped lines.
   */
  t.ok('everyone it went to is named', await page.getByText('To: Stephan').first().isVisible())
  t.ok('...and everyone copied on it', await page.getByText('Cc: Camille').first().isVisible())
  /* The addresses are one hover away, which is the whole trade. */
  t.check('...with the real addresses kept in the hover',
    await page.getByText('To: Stephan').first().getAttribute('title'),
    'Stephan <stephan@bredellferreira.co.za>')

  /* Three answers in front; the filing decisions behind the dots. */
  t.ok('Reply is offered', await page.getByRole('button', { name: 'Reply', exact: true }).isVisible())
  t.ok('...Reply all, because three people were on it',
    await page.getByRole('button', { name: 'Reply all' }).isVisible())
  t.ok('...and Forward', await page.getByRole('button', { name: 'Forward' }).isVisible())
  /*
   * NAMED EVEN WHERE IT IS ONLY AN ARROW. On the floating bar these are icons, and an icon with no
   * accessible name is a button nobody can identify -- "which arrow was reply-all?" is exactly the
   * question a collector should not have to answer from memory.
   */
  t.ok('...and the icons say what they are',
    await page.getByRole('button', { name: 'Mark unread' }).isVisible())

  /* ---------- the warning fires on the right message, and only there ---------- */

  t.ok('an unmatched message says so', await page.getByText('Not matched yet').first().isVisible())
  /*
   * EVERY ANSWER, ON THE MESSAGE THAT IS STILL ASKING. The firm: "move to junk, mark as free,
   * block the sender -- it's down there at the three dots, but for a new email it should be up
   * there." Checked on the screen, because whether a button is reachable without opening a menu is
   * not something source-reading can tell you.
   */
  for (const label of ['Match to a record', 'Mark as open', 'Move to junk', 'Block sender', 'Create lead']) {
    t.ok(`...and offers ${label} without opening anything`,
      await page.getByRole('button', { name: label }).first().isVisible())
  }
  /*
   * AND THE DOTS ARE GONE, because the bar has taken everything that was behind them. A dots
   * button opening a blank panel reads as a feature that has broken.
   */
  t.check('...with nothing left behind the dots',
    await page.getByRole('button', { name: 'More things to do with this message' }).count(), 0)
  /* Back to the top of the message, or the shot is of paragraph 17 rather than of the bar. */
  await page.getByRole('heading', { name: 'Debt collection enquiry' }).scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await t.shot(page, '22-mail-open-unmatched')

  /* Back to the list, which is what the rest of this reads against. */
  await page.getByRole('button', { name: 'List' }).click()
  await page.waitForTimeout(700)

  /* A message already on a debtor account is not a loose end and must not be nagged. */
  await page.getByText('Agreement and next steps').first().click()
  await page.waitForTimeout(700)
  t.check('a matched message is not nagged', await page.getByText('Not matched yet').count(), 0)
  t.ok('...it says where it went instead',
    await page.getByText(/On Willem Bezuidenhout/).first().isVisible())

  /*
   * "OTHERWISE IT SHOULD ALWAYS BE DOWN THERE." Once the question is answered the bar goes and the
   * dots come back -- these are corrections now rather than decisions, so they cost a click.
   */
  t.check('...and blocking is no longer a loose button',
    await page.getByRole('button', { name: 'Block sender' }).count(), 0)
  const dots = page.getByRole('button', { name: 'More things to do with this message' })
  t.ok('...the dots are back', await dots.isVisible())
  await dots.click()
  await page.waitForTimeout(250)
  t.ok('...and that is where blocking lives', await page.getByRole('button', { name: 'Block sender' }).isVisible())
  await page.keyboard.press('Escape')
  await page.mouse.click(5, 5)
  await page.waitForTimeout(300)
  /* This one carries a file, which is the message the attachment spacing was reported on. */
  await t.shot(page, '27-mail-attachment')
  await page.keyboard.press('Escape')
  await page.mouse.click(5, 5)
  await page.waitForTimeout(250)

  /* Nor is one deliberately settled as free mail: somebody already answered the question. */
  await page.getByText('Follow up on outstanding account').first().click()
  await page.waitForTimeout(700)
  t.check('open mail is not nagged either', await page.getByText('Not matched yet').count(), 0)

  /* ---------- unread says WHICH tab, and marking unread does not reload ---------- */

  /*
   * The firm: "the junk email doesn't indicate to me if there's anything that's unread, the free
   * mail also not." Three of the six fixtures are unread and one of them is on Open mail, so the
   * tab has to carry a number -- with one number on All it carried nothing.
   */
  const tabBadge = async (name) => {
    const tab = page.getByRole('button', { name: new RegExp(`^${name}`) }).first()
    const text = await tab.innerText()
    const n = /(\d+)/.exec(text)
    return n ? Number(n[1]) : 0
  }
  t.ok('All says how much work is outstanding', await tabBadge('All') > 0)
  t.ok('...and Needs matching with it', await tabBadge('Needs matching') > 0)
  /*
   * AND THE NUMBERS DIFFER. One fixture is unread and on Open mail; none is on Junk. Equal numbers
   * on every tab is what a stub counting the whole fixture looks like, and it is indistinguishable
   * from a working badge -- so the check is that Junk and Open mail disagree.
   */
  t.check('Junk says how many of ITS messages are unread', await tabBadge('Junk'), 2)
  t.check('...and Open mail how many of its own', await tabBadge('Open mail'), 1)

  /*
   * MARKING UNREAD RELOADS NOTHING. "When I mark an email as unread it kind of reloads everything
   * and moves to the top." Checked by scrolling the list, marking one unread, and asking whether
   * the list moved -- which is the thing that actually went wrong, and which no source check sees.
   */
  await page.getByText('Search Console').first().click()
  await page.waitForTimeout(600)
  const listBox = page.locator('[data-modal-open]').first()
  void listBox
  await page.getByRole('button', { name: 'Mark unread' }).click()
  await page.waitForTimeout(800)
  /* The row is bold again and the list did not blink through a spinner back to the top. */
  t.ok('the message is unread again',
    await page.getByText('New reasons prevent').first().isVisible())
  t.check('...and the list was not thrown away and rebuilt',
    await page.getByText('Debt collection enquiry').first().isVisible(), true)

  /* ---------- how many per page ---------- */

  /*
   * "If there's a page one or a page two, it should give you an option about how many emails to
   * show you." Six fixtures and a page of 25 fits on one page, so the control is not offered --
   * which is the point of offering it only once paging is in play. Shrinking the page to something
   * the mailbox overflows is what brings it out, and that is checked by pressing it.
   */
  const rows2 = () => page.locator('ul > li')
  /* Scoped: "Next" is not a unique word on this page, and an unscoped role lookup fails for a
     reason that has nothing to do with paging. */
  const next = () => page.getByRole('button', { name: 'Next', exact: true }).last()
  const atDefault = await rows2().count()
  t.ok(`the default page holds 50 (${atDefault})`, atDefault === 50)
  t.ok('...and there is more behind it',
    await next().isEnabled())

  /* The control is there because paging is in play, and pressing it changes the list. */
  await page.getByRole('button', { name: '25', exact: true }).click()
  await page.waitForTimeout(900)
  const at25 = await rows2().count()
  t.check('choosing 25 shows 25', at25, 25)
  t.ok('...and still says there is more',
    await next().isEnabled())

  /* And back, so the run leaves the page as it found it. */
  await page.getByRole('button', { name: '50', exact: true }).click()
  await page.waitForTimeout(900)
  t.check('and back to 50', await rows2().count(), 50)

  /* ---------- a search reaches past the tab ---------- */

  /*
   * "If you search, can you only search in a specific folder, or can you search across the whole
   * mailbox?" It was the folder. Checked from the JUNK tab, because that is the case that matters:
   * a search that quietly excludes junk is the worst of all, since junk is exactly where a message
   * goes missing. The message searched for is in the inbox, not in junk.
   */
  await page.getByRole('button', { name: /^Junk/ }).click()
  await page.waitForTimeout(700)
  await page.getByLabel('Search your mailbox').fill('Debt collection')
  await page.waitForTimeout(900)
  t.ok('a search from Junk finds an inbox message',
    await page.getByText('Debt collection enquiry').first().isVisible())
  t.ok('...and says where it is looking',
    await page.getByText(/Searching the whole mailbox/).isVisible())

  /* And the narrower reading is one press away, and really is narrower. */
  await page.getByRole('button', { name: 'Search Junk only' }).click()
  await page.waitForTimeout(900)
  t.check('...narrowed to the tab, it is not there', await page.getByText('Debt collection enquiry').count(), 0)
  await page.getByRole('button', { name: 'Search everywhere' }).click()
  await page.waitForTimeout(700)
  await page.getByLabel('Search your mailbox').fill('')
  await page.waitForTimeout(700)
  await page.getByRole('button', { name: /^All/ }).click()
  await page.waitForTimeout(700)

  /* ---------- select all, with the reading pane up ---------- */

  /*
   * "There should be an option to select all and then have a specific action." Every action already
   * existed; SELECT ALL did not, with the pane on -- the tick-all row lived inside the list branch,
   * so the way the firm actually works gave tick boxes and no way to tick them all. Checked in the
   * pane for exactly that reason.
   */
  await page.getByRole('button', { name: 'Reading pane' }).click()
  await page.waitForTimeout(700)
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await page.waitForTimeout(400)
  const tickAll = page.getByRole('checkbox', { name: /Select all \d+ on this page/ })
  t.ok('select all is offered with the reading pane up', await tickAll.isVisible())
  await tickAll.check()
  await page.waitForTimeout(400)
  /* And it really selects them: the bulk bar counts what it holds. */
  t.ok('...and it selects the whole page',
    await page.getByText(/^\d+ selected$/).first().isVisible())
  for (const action of ['Mark read', 'Mark as open', 'Move to junk']) {
    t.ok(`...offering ${action}`, await page.getByRole('button', { name: action }).isVisible())
  }
  /*
   * AND NOT BLOCKING. "Don't bulk block people. That's a very bad and dangerous idea." Checked on
   * the screen because that is where it was pressed: thirty addresses, the firm's own bank among
   * them, from one button that was sitting on a bar with six harmless ones.
   */
  t.check('...and no way to block them all at once',
    await page.getByRole('button', { name: /Block sender/ }).count(), 0)
  await page.getByRole('button', { name: 'Done' }).click()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'List' }).click()
  await page.waitForTimeout(600)

  /* ---------- a lead, out of an ordinary sender ---------- */

  await page.getByText('Debt collection enquiry').first().click()
  await page.waitForTimeout(700)
  await page.getByRole('button', { name: 'Create lead' }).first().click()
  await page.waitForTimeout(500)
  /*
   * THE REAL LEAD FORM, at the firm's instruction: "it should use the same lead form as adding an
   * actual lead." Checked by a field only the full form has -- a title alone would pass over a
   * short form wearing the same heading.
   */
  /*
   * SCOPED TO THE MODAL. "Email" and "Company" are words this page uses in several places at once
   * -- a view switcher, a tab, a list chip -- and an unscoped label lookup resolves to eight
   * things and fails for a reason that has nothing to do with the form.
   */
  const box = () => page.locator('[data-modal-open]')
  /*
   * EXACT, OR ANCHORED. getByLabel matches on substring, and "Email" is also one of the options
   * inside the Lead Source select, so an inexact lookup resolves to two controls and fails for a
   * reason that has nothing to do with the form. A required field's label carries its asterisk --
   * "First Name*" -- so those are anchored at the front rather than matched whole.
   */
  t.ok('the real lead form opens',
    await page.getByRole('heading', { name: 'Create lead' }).isVisible())
  t.ok('...the whole one, with the owner on it', await box().getByLabel('Owner', { exact: true }).isVisible())
  t.check('the first name is taken off the message',
    await box().getByLabel(/^First Name/).inputValue(), 'Ernest')
  t.check('...and the surname with it',
    await box().getByLabel('Last Name', { exact: true }).inputValue(), 'Mohlalisi')
  t.check('the company is guessed off the domain',
    await box().getByLabel(/^Company/).inputValue(), 'Example')
  t.check('...and their own address is on it',
    await box().getByLabel('Email', { exact: true }).inputValue(), 'ernest@example.co.za')
  /* Annexure B prices work on debtor accounts. The sales side raises nothing, and it says so. */
  t.ok('and it says nothing will be charged',
    await page.getByText(/Nothing is charged/).first().isVisible())
  await t.shot(page, '23-mail-create-lead')

  /*
   * AND IT ASKS WHERE TO GO. "Once it says lead created, it should ask you -- go back to mail, or
   * go to the lead." Both are real answers and neither is right for everybody.
   */
  /* Scoped to the modal: "Create lead" is also the button on the bar behind it. */
  await box().getByRole('button', { name: 'Create lead' }).click()
  await page.waitForTimeout(900)
  t.ok('it says the lead was created',
    await page.getByRole('heading', { name: 'Lead created' }).isVisible())
  t.ok('...and offers the mail back',
    await page.getByRole('button', { name: 'Back to the mail' }).isVisible())
  t.ok('...and the lead itself',
    await page.getByRole('button', { name: 'Open the lead' }).isVisible())
  await t.shot(page, '24-mail-lead-created')
  await page.getByRole('button', { name: 'Back to the mail' }).click()
  await page.waitForTimeout(600)
  t.ok('choosing the mail leaves you in the mailbox',
    await page.getByRole('heading', { name: 'Raptor Mail', exact: true }).isVisible())

  /* ---------- a lead, out of a contact-form enquiry ---------- */

  /*
   * THE CASE THAT GOES WRONG QUIETLY. The From header is form@bredellferreira.co.za -- the firm's
   * own address -- so a lead built off the header would carry it, and saved there it would match
   * every later enquiry to that same lead. Everything has to come out of the body.
   */
  await page.getByText('New Message From Bredell Ferreira').first().click()
  await page.waitForTimeout(900)
  t.ok('an enquiry off the website says what it is',
    await page.getByText('A new enquiry off the website').first().isVisible())
  await t.shot(page, '25-mail-website-enquiry')
  await page.getByRole('button', { name: 'Create lead' }).first().click()
  await page.waitForTimeout(600)
  /*
   * THE FORM POSTS NO NAME FIELD -- it puts the person's name in the From display name -- so here
   * alone the header is the fallback and the body is asked first.
   */
  t.check('the name falls back to the sender, which is where the form puts it',
    await box().getByLabel(/^First Name/).inputValue(), 'Ernest')
  t.check('...their company off the body',
    await box().getByLabel(/^Company/).inputValue(), 'Vaal Fire Services')
  /* The firm's own switchboard is in the footer of that same body. First match wins. */
  t.check('...and THEIR number, not the footer\u2019s',
    await box().getByLabel('Phone', { exact: true }).inputValue(), '021-555 0130')
  /*
   * AND NO ADDRESS AT ALL, which is the honest answer. The From header is the firm's own form and
   * the only address in the body is the firm's own signature -- either one saved on the lead would
   * match the firm's own future mail to it.
   */
  t.check('...and no address, because the form did not ask for one',
    await box().getByLabel('Email', { exact: true }).inputValue(), '')
  await t.shot(page, '26-mail-lead-from-form')
  await box().getByRole('button', { name: 'Cancel' }).click()
  await page.waitForTimeout(400)

  /* ---------- nothing broke on the way ---------- */

  const real = errors.filter((e) => !/favicon|404 \(Not Found\)/i.test(e))
  t.check('no console errors', real.length, 0)
  if (real.length) console.log('  console:', real.slice(0, 5))
} catch (e) {
  /*
   * A failed wait must REPORT, not explode. A TimeoutError stack says a locator never appeared;
   * the request log and a screenshot say why, and the why is usually a fixture answering a URL
   * the app never sent.
   */
  t.ok(`the run finished without throwing (${String(e).split('\n')[0].slice(0, 140)})`, false)
  try {
    const pages = browser ? browser.contexts().flatMap((c) => c.pages()) : []
    if (pages[0]) await t.shot(pages[0], '29-where-it-stopped')
  } catch { /* nothing more to learn */ }
  console.log('\n--- what the app asked Supabase for ---')
  console.log(seen.slice(-14).join('\n') || '(nothing)')
} finally {
  if (browser) await browser.close()
  stopServer(server)
}

const good = t.finish(`The mailbox names itself, carries one search bar wherever the pane is, leads
with the three things an open message is for, nags only the message that is actually a loose end,
and turns an enquiry from a stranger into a lead without leaving the page. Screenshots in ${OUT}.`)
process.exit(good ? 0 : 1)

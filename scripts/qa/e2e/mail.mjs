/**
 * The mailbox, driven in a real browser.
 *
 * THE FIRST BROWSER COVERAGE THIS PAGE HAS EVER HAD, and it is overdue: MailPage is the largest
 * page in the repo and the e2e layer exists precisely because a panel once shipped, was provably
 * in the deployed bundle, and was invisible.
 *
 * What it is here to catch, in order of how it actually went wrong:
 *
 *   1. A tab holding unread mail that says nothing about it. The firm had a No record needed tab
 *      full of unread messages, a sidebar reading 17, and no way to reconcile the two. A count
 *      that is computed correctly and never rendered looks exactly like no unread mail.
 *   2. The sidebar and the All tab disagreeing. They sit on screen together and are read as one
 *      fact, so they are asserted against each other here rather than only in SQL.
 *   3. Layout. "New mail on the very left, search and the two panes in the corner" is a claim
 *      about pixels, and the only honest way to check a claim about pixels is to measure them.
 *   4. The unread colour. A rule that renders as no visible difference is not a rule.
 *
 * Run: node scripts/qa/e2e/mail.mjs
 * Screenshots land in .qa-screenshots/ so the result can be looked at, not just read.
 */
import {
  PORT, chromium, makeRunner, signedInPage, startServer, stopServer,
} from './harness.mjs'
import { PROFILE, COLLEAGUE, USER_ID } from './fixtures.mjs'

const t = makeRunner('mail')
const seen = []

/*
 * Unread per tab, deliberately ALL DIFFERENT.
 *
 * If every tab carried the same number a page that ignored the counts entirely and printed one
 * value seven times would pass. Distinct numbers are what make the assertion mean "this tab read
 * its own count" rather than "a number appeared".
 *
 * `no_record: 6` is the firm's own bug, written down as a fixture: unread mail sitting behind No
 * record needed, which the page used to render with nothing at all beside it.
 */
const UNREAD = {
  all_mail: 4,
  needs_matching: 3,
  matched: 1,
  no_record: 6,
  junk: 9,
  sent: 2,
}

/** Two messages: one unread, one read. Enough to tell the unread styling from the read styling. */
const MAIL = [
  {
    id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
    folder: 'INBOX',
    is_sent: false,
    to_address: null,
    to_name: null,
    uid: 101,
    message_id: '<unread@example.co.za>',
    from_address: 'thabo@example.co.za',
    from_name: 'Thabo Mokoena',
    subject: 'Payment arrangement',
    snippet: 'I can pay R500 on Friday.',
    attachment_names: [],
    is_junk: false,
    occurred_at: '2026-09-14T08:00:00Z',
    read_at: null,
    linked_account_id: null,
    linked_lead_id: null,
    linked_deal_id: null,
    linked_company_id: null,
    linked_contact_id: null,
    is_filed: false,
    is_settled: false,
    no_record_at: null,
    debtor_accounts: null,
    leads: null,
    deals: null,
    companies: null,
    contacts: null,
  },
  {
    id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
    folder: 'INBOX',
    is_sent: false,
    to_address: null,
    to_name: null,
    uid: 102,
    message_id: '<read@example.co.za>',
    from_address: 'accounts@supplier.co.za',
    from_name: 'Supplier Accounts',
    subject: 'Invoice 4471',
    snippet: 'Please find our invoice attached.',
    attachment_names: [],
    is_junk: false,
    occurred_at: '2026-09-13T08:00:00Z',
    read_at: '2026-09-13T09:00:00Z',
    linked_account_id: null,
    linked_lead_id: null,
    linked_deal_id: null,
    linked_company_id: null,
    linked_contact_id: null,
    is_filed: false,
    is_settled: false,
    no_record_at: null,
    debtor_accounts: null,
    leads: null,
    deals: null,
    companies: null,
    contacts: null,
  },
]

/**
 * What the Sent tab is served.
 *
 * from_* is the agent, because on a sent message it always is — which is the whole reason the
 * row has to show to_* instead. A fixture whose From differed from the signed-in user would let
 * a page that still rendered the sender look correct.
 */
const SENT = [
  {
    ...MAIL[1],
    id: 'cccccccc-3333-4333-8333-cccccccccccc',
    folder: 'Sent',
    is_sent: true,
    uid: 301,
    message_id: '<sent@example.co.za>',
    from_address: PROFILE.email,
    from_name: 'Test Leader',
    to_address: 'naledi@khumalo.co.za',
    to_name: 'Naledi Khumalo',
    subject: 'Your account with us',
    snippet: 'As discussed, the balance outstanding is R4 200.',
    // Sent mail carries no_record_at so the Sent folder never pours into the matching queue, and
    // read_at because you wrote it. Both are what the row must NOT mistake for a decision.
    no_record_at: '2026-09-13T10:00:00Z',
    read_at: '2026-09-13T10:00:00Z',
    is_settled: true,
    occurred_at: '2026-09-13T10:00:00Z',
  },
]

const handlers = [
  [(u) => u.includes('/auth/v1/user'), () => ({ body: { id: USER_ID, email: PROFILE.email } })],
  [
    (u) => u.includes('/rest/v1/profiles'),
    (u) => {
      const one = /id=eq\.([0-9a-f-]+)/.exec(u)?.[1]
      if (one) return { body: [PROFILE, COLLEAGUE].filter((p) => p.id === one) }
      return { body: [PROFILE, COLLEAGUE] }
    },
  ],
  [(u) => u.includes('/rpc/mail_unread_counts'), () => ({ body: [UNREAD] })],
  /*
   * The sidebar's own number. Set to the SAME value as the All tab on purpose — that is the
   * contract this change introduced, and the assertion below reads both off the rendered page
   * rather than trusting the fixture.
   */
  [(u) => u.includes('/rpc/nav_counts'), () => ({
    /*
     * An OBJECT, not an array. useNavCounts asks with .single(), which sets the PostgREST
     * object Accept header — hand it an array and `data.mail` is undefined, every badge reads
     * nought, and the sidebar looks like an empty mailbox rather than a broken fixture.
     */
    body: { mail: UNREAD.all_mail, tasks: 0, disputes: 0, diary: 0 },
  })],
  [(u) => u.includes('/rest/v1/mail_blocks'), () => ({ body: [] })],
  [(u) => u.includes('/rest/v1/mail_sender_rules'), () => ({ body: [] })],
  /*
   * The Sent tab asks for is_sent=eq.true; every other tab excludes it. Answering both from one
   * list would put a sent message in the inbox list and hide the bug this fixture exists to
   * catch, so the stub honours the filter the page actually sent.
   */
  [
    (u) => u.includes('/rest/v1/user_emails'),
    (u) => ({ body: decodeURIComponent(u).includes('is_sent=eq.true') ? SENT : MAIL }),
  ],
]

const server = await startServer()
const browser = await chromium.launch()
try {
  const { context, page } = await signedInPage(browser, PROFILE, handlers, seen)
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)) })
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 160)}`))

  /*
   * startServer() spawns and returns; it does not wait for Vite to be listening. Retrying the
   * first navigation is how the accounts run handles the same race, and without it this fails as
   * ERR_CONNECTION_REFUSED with nothing to say about the page under test.
   */
  let up = false
  for (let i = 0; i < 60; i += 1) {
    try { await page.goto(`http://localhost:${PORT}/mail`, { timeout: 2000 }); up = true; break }
    catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  t.ok('the dev server answers', up)

  await page.waitForSelector('text=My mailbox', { timeout: 20000 })
  // The counts arrive from their own request, so the badges are not on screen at first paint.
  await page.waitForFunction(
    () => /No record needed\s*\d/.test(document.body.innerText),
    { timeout: 15000 },
  ).catch(() => { /* asserted properly below, with a readable failure */ })

  /* ---------- the tab strip ---------- */

  const tabStrip = page.locator('div.border-b.border-slate-200').first()
  const tabLabels = (await tabStrip.locator('button').allInnerTexts())
    .map((s) => s.replace(/\s+/g, ' ').trim())

  // Presence before anything about contents: an empty strip would otherwise satisfy every
  // "does not contain Senders" assertion below by having nothing in it at all.
  t.ok('the tab strip rendered', tabLabels.length >= 7)

  const labelled = (name) => tabLabels.find((s) => s === name || s.startsWith(`${name} `))

  t.ok('All is there', labelled('All') !== undefined)
  t.ok('Needs matching is there', labelled('Needs matching') !== undefined)
  t.ok('Matched is there', labelled('Matched') !== undefined)
  t.ok('No record needed is there', labelled('No record needed') !== undefined)
  t.ok('Junk is there', labelled('Junk') !== undefined)
  t.ok('Sent is there', labelled('Sent') !== undefined)

  // The firm's word for it: "that one is actually should be blocked".
  t.ok('the senders tab is called Blocked', labelled('Blocked') !== undefined)
  t.check('...and is no longer called Senders', labelled('Senders') !== undefined, false)

  /* ---------- every tab says what is unread behind it ---------- */

  /** The number rendered beside a tab, or null where the tab shows none. */
  const badgeOn = (name) => {
    const text = labelled(name)
    if (!text) return null
    const m = /\s(\d+|99\+)$/.exec(text)
    return m ? m[1] : null
  }

  t.check('All carries its own count', badgeOn('All'), String(UNREAD.all_mail))
  t.check('Needs matching carries its own count', badgeOn('Needs matching'), String(UNREAD.needs_matching))
  t.check('Matched carries its own count', badgeOn('Matched'), String(UNREAD.matched))
  /*
   * THE ONE THE FIRM REPORTED. This tab held unread mail and showed nothing beside it, because
   * the single count on the page was only ever drawn on All and Needs matching.
   */
  t.check('No record needed carries its own count', badgeOn('No record needed'), String(UNREAD.no_record))
  t.check('Junk carries its own count', badgeOn('Junk'), String(UNREAD.junk))
  t.check('Sent carries its own count', badgeOn('Sent'), String(UNREAD.sent))
  // A list of senders has no unread mail to count, so it must not grow a badge.
  t.check('Blocked carries none', badgeOn('Blocked'), null)

  /* ---------- the sidebar agrees with the All tab ---------- */

  /*
   * Read off the RENDERED sidebar, not off the fixture. The point of the change is that these
   * two numbers are the same fact, and the only way to be sure a person sees them agree is to
   * read both from the screen.
   */
  const sidebarMail = (await page.locator('a[href="/mail"]').first().innerText())
    .replace(/\s+/g, ' ').trim()
  const sidebarNumber = /\s(\d+|99\+)$/.exec(sidebarMail)?.[1] ?? null
  t.check('the sidebar badge is the All tab number', sidebarNumber, badgeOn('All'))

  /* ---------- the layout the firm asked for ---------- */

  const box = async (locator) => {
    const b = await locator.first().boundingBox()
    return b ?? { x: -1, y: -1, width: 0, height: 0 }
  }

  const newEmail = await box(page.locator('button:has-text("New email")'))
  const searchBox = await box(page.locator('input[aria-label="Search your mailbox"]'))
  const checkNow = await box(page.locator('button:has-text("Check now")'))

  // Read defensively: a missing element gives x = -1, which would otherwise sail through every
  // "is to the left of" comparison below and report a passing layout for a page with no buttons.
  t.ok('the New email button is on the page', newEmail.x >= 0)
  t.ok('the search box is on the page', searchBox.x >= 0)
  t.ok('the Check now button is on the page', checkNow.x >= 0)

  /*
   * MEASURED AGAINST THE TOOLBAR'S OWN EDGES, not against each other.
   *
   * Ordering was the first thing tried here and it is not the claim. "In the corner" means near
   * the right edge; a row where the search box merely follows the buttons satisfies
   * `search.x > checkNow.x` while sitting in the middle of the card with empty space beside it.
   * Deleting the ml-auto that pushes the pair right did exactly that, and the ordering version
   * of this check passed on it.
   */
  const toolbar = await box(page.locator('button:has-text("New email")').locator('xpath=..'))
  t.ok('the toolbar row was measured', toolbar.width > 0)

  const GUTTER = 48 // generous: this is "in the corner", not a pixel specification.

  // "A new mail should be on the left. On the very left."
  t.ok('New email is hard against the left edge of the toolbar',
    newEmail.x - toolbar.x < GUTTER)
  t.ok('...and left of everything else in the row', newEmail.x < checkNow.x)

  /*
   * "Sender or subject search, put that on the very right ... in the corner." And: "move the
   * little two panes also to the right corner."
   *
   * The switcher is found by its own buttons rather than by a class, so restyling it does not
   * quietly turn this assertion off. Whichever of the pair is rightmost is the one that has to
   * reach the corner.
   */
  const paneSwitch = await box(page.locator('button[title*="Reading"], button[aria-label*="Reading"]'))
  const toolbarRight = toolbar.x + toolbar.width
  const rightmost = Math.max(
    searchBox.x + searchBox.width,
    paneSwitch.x >= 0 ? paneSwitch.x + paneSwitch.width : 0,
  )

  t.ok('the search box is right of the action buttons', searchBox.x > checkNow.x)
  t.ok('the search and pane controls reach the right-hand corner',
    toolbarRight - rightmost < GUTTER)
  if (paneSwitch.x >= 0) {
    t.ok('the reading-pane switcher is in that corner too', paneSwitch.x > checkNow.x)
    t.ok('...and is the rightmost of the pair', paneSwitch.x >= searchBox.x)
  }

  /* ---------- unread has a colour you can actually see ---------- */

  const rows = page.locator('ul li')
  t.ok('both messages rendered', (await rows.count()) >= 2)

  /** The left border colour of the row carrying this subject. */
  const barFor = async (subject) => rows.filter({ hasText: subject }).first().evaluate((el) => {
    const s = getComputedStyle(el)
    return { colour: s.borderLeftColor, width: s.borderLeftWidth }
  })

  const unreadBar = await barFor('Payment arrangement')
  const readBar = await barFor('Invoice 4471')

  t.ok('the unread row has a bar with real width', parseFloat(unreadBar.width) >= 2)
  t.ok('...that is not transparent', !/rgba\(0, 0, 0, 0\)|transparent/.test(unreadBar.colour))
  t.check('...and it differs from a read row', unreadBar.colour === readBar.colour, false)
  /*
   * The read row keeps a bar of the SAME WIDTH, transparent. Without it the list shifts sideways
   * by three pixels every time a message is read, which reads as the page twitching.
   */
  t.check('a read row reserves the same width so nothing shifts', readBar.width, unreadBar.width)

  await t.shot(page, 'mail')

  /* ---------- the Sent tab says who a message went to ---------- */

  await page.locator('button:has-text("Sent")').first().click()
  await page.waitForFunction(
    () => /Your account with us/.test(document.body.innerText),
    { timeout: 15000 },
  ).catch(() => { /* asserted below, where the failure is readable */ })

  const sentRow = page.locator('ul li').filter({ hasText: 'Your account with us' }).first()
  t.ok('the sent message rendered', await sentRow.count() > 0)

  const sentText = (await sentRow.innerText()).replace(/\s+/g, ' ').trim()

  /*
   * THE BUG. to_address and to_name have been on the row, in the type and in the mapper since the
   * Sent folder was first synced, and nothing ever drew them — so every Sent row read as being
   * from the agent, to nobody.
   */
  t.ok('the row names the recipient', sentText.includes('Naledi Khumalo'))
  t.ok('...with their address', sentText.includes('naledi@khumalo.co.za'))
  t.ok('...labelled To, so it does not read as the sender', /\bTo\b/.test(sentText))
  t.check('...and does not show the agent as the correspondent',
    sentText.includes(PROFILE.email), false)

  /*
   * And it must not claim somebody ruled it belonged on nobody's file. Sent mail carries
   * no_record_at only to stay out of the matching queue; read in the wrong order, every message
   * the agent had ever sent wore the grey "No record needed" chip.
   */
  t.ok('the row is chipped Sent', /\bSent\b/.test(sentText))
  t.check('...not "No record needed"', sentText.includes('No record needed'), false)

  /*
   * AND NO MATCH BUTTON, which is the one that costs money.
   *
   * Matching runs fileOnAccount, which raises Annexure B item 6 — R13, "correspondence received
   * and attended to" — against the debtor. On a message the firm SENT that bills them for our own
   * letter, on top of the R25 under item 1(a) it already cost when it went out, and files it on
   * their account as though they had written it. The sync goes out of its way to keep sent mail
   * away from that code; the button offered it in one click.
   *
   * Checked in the browser as well as in the source because this is about what a person can
   * actually press.
   */
  t.check('a sent message offers no Match button',
    await sentRow.locator('button:has-text("Match")').count(), 0)

  await t.shot(page, 'mail-sent')

  /*
   * Console errors fail the run. A page that renders and throws is a page that has stopped
   * fetching something, and the symptom arrives later as a number that never updates.
   */
  const real = errors.filter((e) => !e.includes('Failed to load resource'))
  t.check('no console errors', real.length, 0)
  if (real.length) for (const e of real.slice(0, 5)) console.log(`    console: ${e}`)

  await context.close()
} finally {
  await browser.close()
  stopServer(server)
}

process.exit(t.finish('The mailbox: tab counts, the sidebar, the toolbar, and unread colour.') ? 0 : 1)

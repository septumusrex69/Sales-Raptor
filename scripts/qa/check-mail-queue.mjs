/**
 * What is waiting, what it is called, and what replying costs.
 *
 * Three things the mail module got wrong in three different ways, and a check for each so they
 * cannot come back separately.
 *
 *  1. WAITING HAD THREE DEFINITIONS. scope() built the tab's clauses, countNeedsFiling wrote its
 *     own out again, and nav_counts() wrote a third in SQL. They had already drifted: the badge
 *     required the message to be unread and the list did not, so opening five unmatched messages
 *     took the badge to nought above a list of five. The sidebar was separately counting mail we
 *     had SENT, because nothing sets read_at on a message you wrote — a mailbox whose Sent folder
 *     syncs 2 000 messages put 2 000 on the badge, and no action a person can take cleared it.
 *
 *  2. THE NAME DESCRIBED THE DATABASE. "No record needed" says what happens to the row. "Free
 *     mail" says the thing the person marking it cares about: mail on an account raises Annexure
 *     B item 6 for receiving it, and this raises nothing.
 *
 *  3. A REPLY SAID IT HAD BEEN LOGGED AND WAS NOT. On a lead or a client the status read "Reply
 *     sent and logged on Acme" and nothing was written anywhere.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-mail-queue.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)

const mail = readFileSync(new URL('../../src/lib/userMail.ts', import.meta.url), 'utf8')
const page = readFileSync(new URL('../../src/pages/mail/MailPage.tsx', import.meta.url), 'utf8')
const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
const sync = readFileSync(new URL('../../api/_lib/emailSync.ts', import.meta.url), 'utf8')

/* ---------- 1. one definition of waiting ---------- */

/*
 * The count goes THROUGH the clause builder rather than beside it. Asserted on the call and not
 * on the word "scope", which appears in this file a dozen times in prose: the body of
 * countNeedsFiling has to contain a scope(...) call whose filter is the same one the tab uses.
 */
{
  const body = mail.slice(
    mail.indexOf('export async function countNeedsFiling'),
    mail.indexOf('export async function markNoRecordNeeded'),
  )
  ok('the needs-filing count exists at all', body.length > 0)
  ok('...and is counted in the database, not fetched and counted here',
    /count: 'exact', head: true/.test(body))
  ok('...through scope(), the same builder the tab uses', /await scope\(/.test(body))
  ok('...asking for the tab’s own filter', /filter: 'needs-filing'/.test(body))
  /*
   * The clauses must NOT be written out again here. This is the whole point: two lists of
   * clauses over one question is how the badge and the list came to disagree. Read off the
   * function body, not the file, or the builder's own clauses would match.
   */
  ok('...and does not write the clauses out a second time', !/\.eq\('is_junk'/.test(body))
  ok('...nor invent a condition the list does not have', !/read_at/.test(body))
}

/*
 * The SQL badge. Not "is it correct" — it is three sub-selects and nothing here can run them —
 * but that the mail clause carries the two exclusions the Mail page itself applies. Junk is not
 * work, and mail we sent is not waiting on anybody.
 */
{
  // The LAST definition in the file is the one that wins when schema.sql is replayed, and
  // schema.sql is append-only, so an earlier definition is history rather than the truth.
  const navStart = schema.lastIndexOf('create or replace function public.nav_counts()')
  ok('nav_counts is in the checked-in schema', navStart > -1)
  const nav = schema.slice(navStart, schema.indexOf('$$;', navStart))
  const mailClause = nav.slice(nav.indexOf('from public.user_emails'), nav.indexOf('from public.tasks'))
  ok('the mail badge counts unread mail', /read_at is null/.test(mailClause))
  ok('...excluding junk, which is not work', /is_junk = false/.test(mailClause))
  ok('...and excluding what we sent, which is waiting on nobody', /is_sent = false/.test(mailClause))
  ok('...scoped to the caller, as every clause in here is', /user_id = auth\.uid\(\)/.test(mailClause))
  /*
   * FOUR columns. The diary column was added by another session against the shared staging
   * database; Postgres refuses a change to an existing function's OUT parameters (42P13), so a
   * definition that drops it cannot be applied at all and the file would be lying about live.
   */
  ok('the signature still carries the diary column',
    /returns table \(mail integer, tasks integer, disputes integer, diary integer\)/.test(nav))
}

// And the client reads all four, or a badge is computed and never shown.
{
  const counts = readFileSync(new URL('../../src/lib/navCounts.ts', import.meta.url), 'utf8')
  for (const field of ['mail', 'tasks', 'disputes', 'diary']) {
    ok(`the sidebar reads ${field}`, new RegExp(`${field}: Number\\(data\\.${field}`).test(counts))
  }
}

/* ---------- 2. Free mail ---------- */

/*
 * The old name gone from everything a person can READ. Comments are exempt — the tab's own
 * comment explains why the name changed and quotes the old one, which is the point of it.
 */
{
  const readable = page
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments, including the one that quotes the old name
    .replace(/^\s*\/\/.*$/gm, '')       // line comments
  ok('nothing on screen still says "No record needed"', !/No record needed/.test(readable))
  ok('...nor "needing no record"', !/needing no record/.test(readable))
  /*
   * THIRD NAME, AND THE LAST TWO ARE BOTH GONE FROM THE SCREEN. "No record needed" described what
   * the database does with the row; "Free mail" described what it costs, which was true and still
   * read as an adjective about the message rather than as a place it goes. The firm's word is
   * "Open mail" -- open on the desk, dealt with, on nobody's file.
   */
  ok('...nor "Free mail"', !/Free mail/.test(readable))
  ok('the tab is called Open mail', /label: 'Open mail'/.test(page))
  ok('...and its hint says what it costs', /nothing charged/.test(page))
  ok('the chip reads Open mail', /tight \? 'Open' : 'Open mail'/.test(page))
  ok('the action says what it does', /Mark as open/.test(page))
  ok('an unmatched message is sent to the tab it lands in', /mail\.noRecordAt \? 'Open mail'/.test(page))
  // The filter id is untouched. Renaming it would be a migration, and the label is not the key.
  ok('the filter id is still no-record', /\{ id: 'no-record', label: 'Open mail'/.test(page))
}

/* The blocklist tab. "Senders" named the rows; "Blocked" names what the tab is for. */
ok('the blocklist tab is called Blocked', /\{ id: 'blocked', label: 'Blocked'/.test(page))
{
  const readable = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  ok('...and no tab is called Senders any more', !/label: 'Senders'/.test(readable))
}

/* ---------- the toolbar, in the firm's order ---------- */

/*
 * Presence first, then order. indexOf returns -1 for something that is gone and -1 beats
 * everything, so an order-only assertion passes vacuously the moment its subject is deleted.
 */
{
  /*
   * THE BUTTONS' OWN BLOCK. This shipped once with the heading and the controls in a single
   * wrapping flex row, and on an iPad the row broke after the compose button: "New email" was
   * carried up beside the heading and the bar began with "Check now". Every assertion on the
   * SOURCE order passed the whole time, because the source order was right and the RENDERED order
   * was not. So the first thing checked is still that the two are not in one row to begin with.
   *
   * The shape has since changed at the firm's request -- "New email at the right top. So cool." --
   * so the two buttons that act on the mailbox sit in the page's header beside the mailbox
   * address, and everything that SORTS mail lives below with the tabs. What is checked is the same
   * property: text and buttons cannot share a wrapping row.
   */
  const headStart = page.indexOf('<div className="px-5 pt-4 pb-3 border-b border-slate-100">')
  ok('the mailbox has a header', headStart > -1)
  const head = page.slice(headStart, page.indexOf('The tabs scroll if they must'))

  /*
   * THE DESCRIPTION IS OUT OF THE WRAPPING ROW ENTIRELY, not merely ordered after the buttons in
   * it. It wrapped them onto a line below itself a SECOND time -- the firm: "that sentence is very
   * long and it goes over, so the new mail is moved down" -- because text and buttons cannot be
   * asked to share a wrapping row and keep their order, however they are ordered in the source.
   * So what is checked is the boundary, not the sequence.
   */
  const rowAt = head.indexOf('<div className="flex items-center gap-x-4 gap-y-2 flex-wrap">')
  ok('the name and the buttons share one row', rowAt > -1)
  /*
   * AND THE PARAGRAPH IS GONE. "Everything stays until you match it or block the sender..." --
   * the firm: "remove that sentence completely, it's unnecessary." It was there to reassure
   * somebody that Raptor does not delete their mail, which nobody was worried about, and it was
   * long enough to wrap the buttons onto a line below itself twice.
   */
  ok('the reassurance nobody needed is gone', !head.includes('Everything stays until you match it'))
  const row = head

  const buttonsAt = row.indexOf('<div className="ml-auto shrink-0 flex items-center gap-2">')
  ok('the buttons have a block of their own', buttonsAt > -1)
  const buttons = row.slice(buttonsAt)
  ok('...and they are inside that row, where nothing long can push them out of it',
    buttons.includes('setComposing(true)') && buttons.includes('void syncMine()'))
  /*
   * STRUCTURALLY BELOW IT, not merely later in the file. "After the buttons in the source" was the
   * property this checked the first time and it is not the property that matters -- the row
   * wrapped them onto a line beneath the sentence anyway. So: the row's two divs must close before
   * the paragraph starts.
   */
  /* Nothing long is left in the row to carry them anywhere. */
  ok('...and nothing but the name shares their row', !/<p className="text-xs text-slate-400/.test(row))

  /* Which mailbox is being read, which is not always the address somebody signs in with. */
  ok('the header names the mailbox', /\{mailbox \?\? currentUser\?\.email \?\? ''\}/.test(head))

  const compose = buttons.indexOf('setComposing(true)')
  const sync = buttons.indexOf('void syncMine()')
  ok('the header has a compose button', compose > -1)
  ok('...and the sync button', sync > -1)
  ok('writing a new message comes first', compose < sync)

  /*
   * And it is the one that is filled. Three identical outline buttons in a row gave the firm
   * nothing to aim at -- "how do I create a new mail" was asked of a bar that had the answer on it.
   *
   * GOLD, which it was argued out of once: Select wears gold-400 while selecting is on, and two
   * gold buttons on one bar would have spent the only signal saying which mode you are in. That
   * argument only holds while they share a bar, so it is checked rather than assumed.
   */
  const composeButton = buttons.slice(compose, buttons.indexOf('</button>', compose))
  ok('the compose button is filled, not another outline', /bg-gold-400/.test(composeButton))
  ok('...with text that reads on it', /text-navy-950/.test(composeButton))
  ok('...and Select is not on the same bar to be confused with it',
    !buttons.includes('aria-pressed={selecting}'))
  /* The other one stays an outline, or filling one stops meaning anything. */
  ok('sync stays an outline', /border-slate-200/.test(buttons.slice(sync, buttons.indexOf('</button>', sync))))
  /* An icon with no word needs to say what it is to anybody who cannot see it. */
  ok('...and the icon says what it does', /aria-label="Check for new mail now"/.test(buttons))

  /*
   * HOW THE MAIL IS LAID OUT lives at the right end of the tab row. Which tab you are on and how
   * it is displayed are one question asked twice.
   */
  const toolsAt = page.indexOf('<div className="shrink-0 flex items-center gap-2 py-1.5">')
  ok('the tab row carries the layout controls', toolsAt > -1)
  const tools = page.slice(toolsAt, page.indexOf('</div>\n        </div>', toolsAt))
  ok('...Select among them', tools.includes('aria-pressed={selecting}'))
  ok('...and the pane switcher', tools.includes('<EmailViewSwitcher'))

  /*
   * SEARCHING AND NARROWING SIT OVER THE LIST, at the firm's instruction: "the search mail in the
   * left with the unread only ... you can filter that stuff there." Neither may be back on the
   * page's own bar, which is where they both used to be and is what made them read as controls
   * over the whole page rather than over the column they narrow.
   */
  const barStart = page.indexOf('function MailSearchBar(')
  ok('searching and narrowing are one control', barStart > -1)
  const searchBar = page.slice(barStart, page.indexOf('\nfunction ', barStart + 10))
  ok('...with the search box in it', /aria-label="Search your mailbox"/.test(searchBar))
  ok('...and the unread filter', /aria-label="Narrow this list"/.test(searchBar))
  ok('the search box is not on the page header', !head.includes('aria-label="Search your mailbox"'))
  ok('...nor is the unread filter', !head.includes('aria-label="Narrow this list"'))

  /*
   * A REAL <select>, not a rebuilt one: the keyboard, the screen reader and an iPad's own picker
   * all come free, and the firm works on iPads.
   */
  /*
   * Anchored to the markup and not to the word: the comment above it explains why this is a real
   * <select>, and a bare /<select/ over the function passed with the element itself replaced -- the
   * exact trap this codebase keeps walking into.
   */
  ok('the unread filter is a real select',
    /<select\s*\n\s*value=\{unreadOnly \? 'unread' : 'all'\}/.test(searchBar))
  ok('...offering the whole mailbox as well', />All mail</.test(searchBar))
  /* The count rides in the option, which is the honest place for it -- it is the number of rows
     choosing that option leaves behind. */
  ok('...and the unread count with the option that applies it', /Unread only \\u00b7 \$\{unread\}/.test(searchBar))
  /* Tinted while it narrows, because a filter you cannot see is on is a mailbox with mail
     missing from it. */
  ok('...and it shows that it is narrowing', /unreadOnly\s*\n?\s*\? 'border-brand-500/.test(searchBar))

  /*
   * ONE BAR ON THE SCREEN, EVER. It is drawn inside the reading pane's own column when the pane
   * is up and above the list when it is not, and the condition that decides is worked out once --
   * two copies of it would eventually disagree and put two search boxes on the page.
   */
  ok('where the bar is drawn is decided once', /const paneShowing = /.test(page))
  ok('...and the pane carries it in its own column', /listHeader=\{/.test(page))
  ok('...and the standalone copy stands down when the pane is up',
    /\{filter !== 'blocked' && !paneShowing && \(/.test(page))
}

/* ---------- 3. replying ---------- */

/*
 * THE MONEY. A debtor's email costs them twice, once each way, and each half is raised at a
 * different moment: item 6 (R13, correspondence received and attended to) when the message
 * arrives and is filed, item 1(a) (R25) when the reply goes out. The reply must raise 1(a) and
 * must NOT raise item 6 again — attending to the message is what item 6 already paid for, and a
 * second one would bill the debtor twice for one incoming email.
 */
{
  /*
   * The FIRST of the two reply modals in this file. The second belongs to the reading pane and
   * hands its send back to this one; taking the last would slice the wrong component and every
   * assertion below would pass or fail for the wrong reason.
   */
  const replyStart = page.indexOf('{replying && (')
  const replyEnd = page.indexOf('{replying && (', replyStart + 1)
  ok('the mailbox has a reply modal', replyStart > -1)
  const reply = page.slice(replyStart, replyEnd > -1 ? replyEnd : page.length)
  ok('a reply to a debtor is sent through the account’s own send', /recordSentEmail\(\{/.test(reply))
  ok('...which is what charges item 1 (a)', /chargeMessage\(charge, '1a'\)/.test(reply))
  ok('...and nothing here raises item 6 a second time', !/chargeItem\(/.test(reply))
  ok('the agent is told the price before typing', /charged R25 under item 1\(a\)/.test(reply))

  /*
   * And the branch that is not a debtor. It said "Reply sent and logged on Acme" and logged
   * nothing: ComposeEmailModal hands the sent subject and body back for the caller to record,
   * and this caller returned instead.
   */
  const crm = reply.slice(reply.indexOf('if (!answering?.linkedAccountId) {'), reply.indexOf('recordSentEmail({'))
  ok('a reply to a lead or client is written somewhere', /addActivity\(\{/.test(crm))
  ok('...as an email', /type: 'Email'/.test(crm))
  ok('...carrying what was actually sent', /notes: bodyText/.test(crm))
  for (const [kind, field] of [['lead', 'leadId'], ['deal', 'dealId'], ['client', 'companyId'], ['contact', 'contactId']])
    ok(`...on the ${kind} it was matched to`, new RegExp(`${field}: on\\.kind === '${kind}' \\? on\\.id`).test(crm))
  ok('...and only claims it was logged when there was something to log', /setStatus\(on\n/.test(crm))
  /*
   * Annexure B prices collecting a debt. A lead is not a debt and must never be charged, so no
   * charging call may appear on this branch. Asserted on the CALLS, not on the word: the comment
   * beside them explains why there is no charge and says "charge" three times doing it.
   */
  for (const called of ['chargeItem(', 'recordSentEmail(', 'chargeMessage('])
    ok(`nothing on the CRM branch calls ${called})`, !crm.includes(called))
}

/* ---------- the actions sit above the message ---------- */

/*
 * THE FIRM'S REPORT: "it's sitting there at the bottom and I have to scroll down all the way to
 * do anything."
 *
 * They were under the body, which reads as the natural order and is wrong for the mail people
 * actually get: a corporate signature is a full-width letterhead and a photograph, the message
 * above it is three lines, and so Reply sat a screen and a half below the thing it was about.
 */
{
  const start = page.indexOf('function MailBody(')
  ok('the message renderer exists', start > -1)
  const mailBody = page.slice(start, page.indexOf('function MailRow(', start))

  /*
   * WHERE THE ACTIONS ARE NOW: one component, two placements.
   *
   * In the LIST they are still above the message, which is where the firm asked for them ("it's
   * sitting there at the bottom and I have to scroll down all the way to do anything"). In the
   * READING PANE they float at the foot of the pane, Spark's way, which the firm sent over and
   * preferred -- and which answers the same complaint better, because a bar that is always on
   * screen never has to be reached at all.
   *
   * So the ordering assertions below apply to the list placement only. What the pane does is
   * checked in check-reply-all.mjs, on the bar itself.
   */
  const inline = mailBody.indexOf('{!sticky && <MessageActions')
  const floating = mailBody.indexOf('{sticky && <MessageActions')
  const attachments = mailBody.indexOf('{mail.attachmentNames.length > 0 && (')
  const body = mailBody.indexOf('whitespace-pre-wrap break-words')
  const signature = mailBody.indexOf('In this message')

  /*
   * Presence before order, always. indexOf returns -1 for something deleted and -1 beats
   * everything, so an order-only assertion passes vacuously the moment its subject is gone.
   */
  ok('the list renders the actions inline', inline > -1)
  ok('...and the pane floats them', floating > -1)
  ok('...there is an attachment row', attachments > -1)
  ok('...the message body itself', body > -1)
  ok('...and the pictures it was written with', signature > -1)

  ok('in the list the actions come before the message, not after it', inline < body)
  ok('...and before the signature pictures that used to bury them', inline < signature)
  ok('the attachments are above the message too', attachments < body)
  /* The controls come first; the files they act on second; the message last. */
  ok('...and below the buttons, which are the things you press most', inline < attachments)
  /*
   * AND THE FLOATING ONE IS LAST. A bar that sticks to the bottom only stays on screen while its
   * own place in the flow is on screen -- put half way up a long message it scrolls away exactly
   * when it is wanted, and looks correct in the markup the whole time.
   */
  ok('the floating bar is the last thing in the message', floating > signature)

  /*
   * Both placements come out of ONE component, so the list and the pane cannot end up offering
   * different buttons -- which is what two argument lists would have quietly produced.
   */
  const bar = page.slice(page.indexOf('function MessageActions'), page.indexOf('\nfunction BarButton'))
  ok('there is one bar, written once', bar.length > 0)
  for (const [what, needle] of [
    ['reply', 'onClick={onReply}'],
    ['forward', 'onClick={onForward}'],
    ['mark unread', 'onClick={onUnread}'],
    ['reach the rest of the actions', '<RowMenu'],
    ['open the record it is filed on', '<Link to={mail.linkedTo.path}'],
  ]) {
    ok(`there is a way to ${what}`, bar.includes(needle))
  }
  /* Blocking stays behind the dots, on the open message rather than on every row. */
  ok('there is a way to block the sender', mailBody.includes('onClick: onBlock'))

  // A rule under the controls, so the message reads as the message and not as more toolbar.
  ok('the controls are ruled off from the message', /border-b border-slate-100 mb-3/.test(mailBody))
}

/* ---------- 4. unread, per tab, and without a reload ---------- */

/*
 * THE FIRM, ON TWO SEPARATE THINGS THAT WERE THE SAME BUG UNDERNEATH:
 *
 *  "The junk email doesn't indicate to me if there's anything that's unread. The free mail also
 *   not." One number, on All, said the mailbox had unread mail and nothing about WHERE -- so a
 *   client's reply a spam filter had misfiled sat in Junk with nothing anywhere saying so.
 *
 *  "When I mark an email as unread it kind of reloads everything and moves to the top." It did:
 *   the handler ended with load(), which sets `loading`, which swaps the list for a spinner. A
 *   list that unmounts comes back scrolled to the top, so marking one message unread threw you out
 *   of wherever you were reading.
 */
{
  ok('every tab is counted', /export async function countUnreadByTab/.test(mail))
  /*
   * THROUGH scope(), via countUnread. A function in SQL would be a second definition of every
   * tab's clauses, and this file already documents what that costs: nav_counts wrote its own and
   * drifted, so the badge said 3 over a list of 5.
   */
  const byTab = mail.slice(mail.indexOf('export async function countUnreadByTab'), mail.indexOf('export function bumpUnread'))
  ok('...through the one clause builder', /countUnread\(userId, \{ filter, search \}\)/.test(byTab))
  ok('...and scoped by the search too, so a badge cannot lie once somebody types',
    /countUnreadByTab\(\s*\n?\s*userId: string, search\?: string,/.test(mail))
  /* All six, or a tab quietly has no badge and nobody notices which. */
  for (const tab of ['all', "'needs-filing'", "'filed'", "'no-record'", 'junk', 'sent']) {
    ok(`...counting ${tab.replace(/'/g, '')}`, byTab.includes(tab.replace(/'/g, '')))
  }

  /*
   * THE PAGE DRAWS THE RIGHT ONE, and which one is right changed.
   *
   * All used to carry work outstanding alongside Needs matching. The firm caught it on the
   * screen: "I've got about four or five unread messages in my All mailbox, and it just shows
   * that I have two." Both numbers were right; neither was the one being asked of a mailbox. So
   * Needs matching carries work outstanding and every other tab -- All included -- carries unread.
   *
   * Pinned as the whole expression rather than as two loose mentions, because the failure this
   * replaces was a tab quietly reading the other number while both names were still in the file.
   */
  ok('the tabs carry a badge', /unreadByTab\[t\.id\]/.test(page))
  ok('...work outstanding on Needs matching, and nowhere else',
    /t\.id === 'needs-filing' \? outstanding\s*\n?\s*: unreadByTab\[t\.id\]/.test(page))
  ok('...so All counts what has not been read', /const isWork = t\.id === 'needs-filing'/.test(page))
  ok('...and nothing at zero, which is what teaches people to stop reading badges',
    /if \(n <= 0\) return null/.test(page))

  /*
   * AND IT COUNTS THE SAME THING THE SIDEBAR COUNTS, which is where this drifted.
   *
   * nav_counts once counted mail still needing matching and was changed to unread; the All tab
   * was not changed with it, so two badges six inches apart on one screen answered two different
   * questions and neither said which. What nav_counts counts is asserted above, in SQL; this is
   * the other side of the same rule, in TypeScript. The two cannot share code, so they are held
   * side by side here instead.
   */
  ok('the All tab narrows on the same two facts the sidebar excludes on',
    /input\.filter === 'all'\) out = out\.eq\('is_junk', false\)\.eq\('is_sent', false\)/.test(mail))
  ok('...with unread applied on top, which is what countUnread adds to whatever tab it is given',
    /\{ \.\.\.input, unreadOnly: true \}/.test(mail))
  /* Told apart by colour: unread is brand, the same as the dot on a row and the unread filter. */
  ok('...the two are told apart', /isWork \? 'bg-gold-500 text-navy-950' : 'bg-brand-500 text-white'/.test(page))

  /* AND MARKING UNREAD RELOADS NOTHING. */
  const unreadOne = page.slice(page.indexOf('async function unreadOne'), page.indexOf('\n  /*\n   * Whether the reading pane'))
  ok('marking unread has a handler', unreadOne.length > 0)
  ok('...which updates the row in place', /setItems\(\(list\) => list\.map/.test(unreadOne))
  ok('...and the badge with it', /setUnreadByTab\(\(counts\) => bumpUnread\(counts, mail, 1\)\)/.test(unreadOne))

  /*
   * AND THE OTHER HALF OF IT. Opening a message marked it read and un-bolded the row, and left
   * every badge where it was -- so a badge counted what was unread when the page last loaded
   * rather than what is unread now. Read four of five and All still said five. The sidebar
   * already followed, because markMailRead fires refreshNavCounts, so the two also disagreed.
   */
  const toggleAt = page.indexOf('async function toggleTo(')
  const toggle = page.slice(toggleAt, page.indexOf('\n  }\n', toggleAt) + 4)
  ok('opening a message has a handler', toggle.length > 0)
  ok('...which marks it read', /markMailRead\(\[mail\.id\]\)/.test(toggle))
  ok('...and takes the badges down with it',
    /setUnreadByTab\(\(counts\) => bumpUnread\(counts, mail, -1\)\)/.test(toggle))
  /*
   * Compared against the CALL, not the name. The comment above that line explains the fix and
   * mentions markMailRead, so matching the bare name would have this reading its own prose --
   * the trap this suite has fallen into more than once.
   */
  ok('...before the write, so the number moves when the row does',
    toggle.indexOf('bumpUnread') < toggle.indexOf('void markMailRead('))
  /*
   * NO load() ON THE SUCCESS PATH. This is the whole fix: load() sets `loading`, the list unmounts,
   * and an unmounted list comes back at the top.
   */
  /*
   * Read with the comments stripped. The comment above this handler explains that it USED to end
   * with load(), so tested against the source as written the guard matches its own explanation --
   * the same trap that has caught three checks in this suite already.
   */
  const success = unreadOne.slice(0, unreadOne.indexOf('} catch'))
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  ok('...and reloads nothing, which is what threw the reader to the top', !/load\(/.test(success))
  /* A failure still reloads, because then the screen and the database really do disagree. */
  ok('...though a failure puts the truth back', /catch \(e\) \{[\s\S]*?await load\(page\)/.test(unreadOne))
}

/* ---------- 5. sent mail arrives read ---------- */

/*
 * "All the sent emails are marked as unread. Sent emails should automatically be read."
 *
 * Nothing sets read_at on a message you wrote, and opening one is the only thing that marks mail
 * read -- so a synced Sent folder put a permanent column of bold rows on the Sent tab that no
 * action a person could take would ever clear. You wrote it; you have read it.
 */
ok('the sync stamps sent mail as read', /read_at: message\.isSent \? new Date\(\)\.toISOString\(\) : null,/.test(sync))
/* And what was already stored is settled, dated to when it was sent rather than to now. */
ok('...and what was already stored is settled too',
  /set read_at = coalesce\(read_at, occurred_at\)\s*\nwhere is_sent = true and read_at is null;/.test(schema))

/* ---------- 6. how many per page, and where the attachments sit ---------- */

/*
 * "I see page one, page two -- if there's a page one or a page two, it should give you an option
 * about how many emails to show you."
 */
ok('the page size can be changed', /const PAGE_SIZES = \[25, 50, 100, 200\]/.test(page))
ok('...and the list is fetched at that size', /offset: at \* pageSize, limit: pageSize,/.test(page))
/*
 * AND REFETCHED WHEN IT CHANGES. A page size that only takes effect on the next filter change is
 * a control that does nothing when you press it, which is worse than not offering it.
 */
ok('...and refetched when it changes',
  /\[currentUser, filter, asked, unreadOnly, pageSize, searchEverywhere\]/.test(page))
/*
 * `asked`, NOT `search`, AND THE DIFFERENCE IS THE WHOLE OF A BUG THE FIRM REPORTED.
 *
 * `search` is what is in the box; `asked` follows a third of a second behind. With `search` in
 * here every keystroke re-ran the query and set `loading` -- and the search box lives inside the
 * reading pane, which was drawn only while not loading, so the box unmounted under the person
 * typing into it. THE FIRM: "I press one letter and then it goes away."
 *
 * Both halves are asserted: the box must never be fed the delayed value either, or the caret
 * would run a third of a second behind the typing instead.
 */
ok('the query follows the typing rather than racing it',
  /setTimeout\(\(\) => setAsked\(search\), \d+\)/.test(page))
ok('...and the box itself is never the delayed value',
  /search=\{search\} onSearch=\{setSearch\}/.test(page) && !/search=\{asked\}/.test(page))
/*
 * AND THE PANE DOES NOT COME DOWN WHILE IT LOADS, which is the other half. A search box drawn
 * inside something conditional on `loading` is a search box that cannot be typed into.
 */
ok('the reading pane survives a load and an empty result',
  /const paneShowing = !loadFailed && filter !== 'blocked' && view === 'reading'/.test(page))
/* Back to the first page, or "page 4 of 50" becomes "page 4 of 200" and skips 600 messages. */
ok('...from the first page', /setPageSize\(n\); setPage\(0\)/.test(page))
/*
 * ONLY WHERE IT IS ANY USE. A control offering to resize a list that already fits on one page is
 * furniture -- and it is what teaches people to stop reading the rest of the bar.
 */
ok('...offered only once paging is in play', /\(page > 0 \|\| more \|\| pageSize !== PAGE\) && \(/.test(page))
/* The same pills the account book uses: one question asked twice should not look like two
   mechanisms. */
ok('...as the same control the book uses', /aria-pressed=\{pageSize === n\}/.test(page))

/*
 * THE ATTACHMENTS SIT BETWEEN THE TWO RULES. The firm: "the NDA attachment is lying on top of the
 * line that's on top of Hi Camille and Stephan -- make it in the middle of those two little
 * lines."
 *
 * It was `mt-3`: twelve pixels above the chips and NOTHING below them, so the rule separating the
 * header from the message ran along their bottom edge. The space above comes from the header's own
 * margin, so the row only supplies the space below -- matching it here as well would double the
 * top and put them off-centre the other way.
 */
{
  const chips = page.slice(
    page.indexOf('{mail.attachmentNames.length > 0 && ('),
    page.indexOf('{downloadError &&'),
  )
  ok('the attachment row exists', chips.length > 0)
  ok('...and clears the rule below it', /className="pb-3 flex flex-wrap items-center gap-1\.5"/.test(chips))
  ok('...without doubling the space above', !/mt-3 flex flex-wrap/.test(chips))
}

/* ---------- 7. select all, and what you can do with a selection ---------- */

/*
 * "When you have a select for the emails, there should be an option to select all and then have a
 * specific action -- move to junk or open, or mark as unread or read."
 *
 * Every one of those actions already existed. What did not was SELECT ALL with the reading pane
 * up: the tick-all row lived inside the list branch, so the way the firm actually works -- pane
 * on -- gave you tick boxes and no way to tick them all.
 */
{
  const selectAll = page.slice(
    page.indexOf('{selecting && filter !== \'blocked\' && items.length > 0 && ('),
    page.indexOf('{loading ? ('),
  )
  ok('there is a select-all', selectAll.length > 0)
  ok('...outside the two view branches, so both get it', !/view === 'reading'/.test(selectAll))
  ok('...which ticks every row on the page', /new Set\(items\.map\(\(i\) => i\.id\)\)/.test(selectAll))
  ok('...and untick puts it back to none', /: new Set\(\)/.test(selectAll))
  /*
   * AND IT SAYS HOW MANY. These buttons block senders and delete rows; "select all" that reaches
   * messages nobody has seen is how somebody blocks a client they never laid eyes on. The page is
   * what is on screen, the page size is theirs to choose, and the label states the number.
   */
  ok('...and says how many that is', /Select all \{items\.length\} on this page/.test(selectAll))

  /* The actions themselves, which is the rest of what was asked for. */
  const bulk = page.slice(page.indexOf('{chosen.size > 0 && ('), page.indexOf('{status &&'))
  ok('the bulk bar exists', bulk.length > 0)
  for (const [what, needle] of [
    ['mark read', 'void readChosen()'],
    ['mark unread', 'void unreadChosen()'],
    ['mark as open', 'void noRecordChosen()'],
    ['move to junk', 'void junkChosen(true)'],
    ['rescue from junk', 'void junkChosen(false)'],
  ]) {
    ok(`a selection can ${what}`, bulk.includes(needle))
  }
  /*
   * AND BLOCKING IS NOT ON IT. "Don't bulk block people. That's a very bad and dangerous idea."
   *
   * The firm lost thirty addresses to one press -- their own bank among them -- through the same
   * capability offered from the Empty junk box. Leaving it on a selection puts the identical
   * hazard one screen away.
   *
   * It is not like the rest of this bar. Everything else here acts on MAIL THAT IS ALREADY HERE
   * and shows its result: junk it, read it, delete it, and you can see what happened. Blocking
   * acts on EVERY FUTURE MESSAGE from somebody, shows nothing once done, and what it costs is a
   * client's mail that silently never arrives. It stays on the open message, one sender at a time.
   */
  ok('a selection cannot block anybody', !bulk.includes('blockChosen'))
  ok('...and there is no bulk block left to call', !/export async function blockSenders/.test(mail))
  /* One at a time, on a message somebody has read, is still there. */
  ok('blocking one sender is still offered', /onClick: onBlock/.test(page))

  /*
   * READ AND UNREAD ARE OFFERED ONLY WHERE THEY WOULD DO SOMETHING. On a selection that is all
   * read, "Mark read" is furniture -- and a button that does nothing when pressed is worse than
   * no button, because it is the one that teaches people the rest may not work either.
   */
  ok('...and only the one that would change something',
    /items\.some\(\(m\) => chosen\.has\(m\.id\) && !m\.readAt\)/.test(bulk)
    && /items\.some\(\(m\) => chosen\.has\(m\.id\) && !!m\.readAt\)/.test(bulk))
}

/* ---------- 8. a search looks at the whole mailbox ---------- */

/*
 * The firm's question gave this away: "if you search, can you only search in a specific folder, or
 * can you search across the whole mailbox?" It was the tab -- which is the wrong default for a
 * search box. Somebody looking for a message knows the sender and the subject and has no idea
 * which of six tabs it settled in, and a search that quietly excludes junk is the worst case of
 * all, because junk is exactly where a message goes missing.
 */
{
  ok('the scope builder knows about it', /everywhere\?: boolean/.test(mail))
  ok('...and drops the tab clause entirely', /const wholeMailbox = !!input\.everywhere && searching/.test(mail))
  /*
   * GUARDED ON THE TERM AS WELL AS THE FLAG. Without a search, "everywhere" would silently turn
   * whichever tab somebody is looking at into the whole mailbox -- junk and sent folded in, which
   * is not a view anybody asked for.
   */
  ok('...only while something is actually being searched for',
    /const searching = !!input\.search\?\.trim\(\)/.test(mail))
  /* The tab clauses hang off the same condition, so there is one place that decides. */
  ok('...and the tab clauses hang off that one condition',
    /if \(wholeMailbox\) \{[\s\S]{0,400}?\} else if \(input\.filter === 'needs-filing'\)/.test(mail))

  /* The page asks for it, and it is on by default because that is the common question. */
  ok('the mailbox searches everywhere by default', /useState\(true\)[\s\S]{0,80}?searchEverywhere|const \[searchEverywhere, setSearchEverywhere\] = useState\(true\)/.test(page))
  ok('...passing it to the query', /everywhere: searchEverywhere,/.test(page))

  /*
   * AND IT SAYS SO, only while searching. A permanent switch beside the box is a question asked of
   * somebody who has not typed anything yet; a line that states what is happening and offers the
   * other reading in the same breath is not.
   */
  const bar = page.slice(page.indexOf('function MailSearchBar('), page.indexOf('\nfunction RowGutter'))
  ok('the bar says where it is looking', /Searching the whole mailbox, junk and sent included/.test(bar))
  ok('...naming the narrower option', /Search \$\{tabLabel\} only/.test(bar))
  ok('...and only once there is something to look for', /search\.trim\(\) !== '' && \(/.test(bar))
}

/* ---------- 9. the gutter collapses when nothing is being selected ---------- */

/*
 * "The little circles that indicate the name are in a weird place, off-centre and a little bit to
 * the right -- make them a little more to the left. The moment you select something it'll move a
 * little to the right to make space for that little circle."
 *
 * The column was permanently sixteen pixels wide because it carried the unread mark as well as the
 * tick box -- so every avatar was pushed in off the edge, on every row, for ever, to serve a mode
 * that is off almost all the time.
 */
{
  const gutter = page.slice(page.indexOf('function RowGutter('), page.indexOf('\n/**\n * What has happened to this message'))
  ok('the gutter exists', gutter.length > 0)
  ok('...and is nothing at all unless something is being selected', /if \(!selecting\) return null/.test(gutter))
  /* Only the tick box is left in it; the unread mark has gone to the avatar. */
  ok('...carrying only the tick box', !/bg-brand-500/.test(gutter))

  /* And the pane's wrapper collapses with it, or the padding is the gap all over again. */
  ok('the pane\u2019s lead collapses too', /selecting \? 'pl-4 pt-2\.5 shrink-0' : ''/.test(page))

  /*
   * THE UNREAD MARK IS ON THE AVATAR NOW. It costs no width there and sits nearer the name it
   * belongs to. The ring is the row's background, so it reads as sitting ON the face.
   */
  const summary = page.slice(page.indexOf('function MailSummary('), page.indexOf('\nfunction MessageActions'))
  ok('unread is marked on the face', /\{!mail\.readAt && \(/.test(summary))
  ok('...as a badge on it', /absolute -top-0\.5 -right-0\.5/.test(summary))
  ok('...reading as on it rather than behind it', /ring-2 ring-white/.test(summary))
}

/* ---------- 10. deleting junk deletes junk ---------- */

/*
 * THE ONE THAT COST SOMETHING. "I accidentally just said empty junk and then it said block all of
 * these people ... that's a very bad and dangerous idea." The box offered "Block these senders
 * too", TICKED BY DEFAULT, and thirty addresses went onto the blocklist in one press -- the firm's
 * own bank among them, with Telkom, a supplier and four real people who had written to them.
 *
 * Deleting junk and blocking a sender are not one decision. One is about mail already here, is
 * reversible in the way that matters (every message is still on the mail server) and is done in a
 * hurry because junk is where the volume is. The other is about every future message from
 * somebody, is invisible once done, and costs a client's mail that silently never arrives.
 */
{
  const emptyJunk = mail.slice(mail.indexOf('export async function emptyJunk'), mail.indexOf('/** Let a sender back in.'))
  ok('emptying junk exists', emptyJunk.length > 0)
  ok('...and takes nothing but who is asking', /emptyJunk\(input: \{ userId: string \}\)/.test(emptyJunk))
  ok('...and blocks nobody', !/block/i.test(emptyJunk.replace(/\/\*[\s\S]*?\*\//g, '')))
  /* Junk somebody has since put on a record is on a debtor's file and a fee may have been raised
     against it. It is not ours to delete. */
  ok('...and leaves matched mail alone', /\.eq\('is_filed', false\)/.test(emptyJunk))

  const box = page.slice(page.indexOf('function EmptyJunkModal('), page.indexOf('\n/**\n * Senders whose mail never needs matching'))
  ok('the box has no tick box at all', !/type="checkbox"/.test(box))
  ok('...and says so out loud', /nobody is blocked/.test(box))
  /* Named for what it does. "Empty" is a tidy-up; this deletes. */
  ok('...and is called what it does', /title="Delete all junk"/.test(box))
}

/* ---------- 11. moving to junk only moves to junk ---------- */

/*
 * "If you select a message and you move to junk, it just goes to junk." It always did -- setJunk
 * touches is_junk and the settled flag and nothing else -- but after the above it is worth holding
 * still, because the cheapest way to reintroduce that bug would be to "helpfully" block here.
 */
{
  const setJunk = mail.slice(mail.indexOf('export async function setJunk'), mail.indexOf('\n/**\n * Move a message that was filed on the wrong debtor account.'))
  ok('setJunk exists', setJunk.length > 0)
  ok('...and only sets the junk flag', /is_junk: junk,/.test(setJunk))
  ok('...blocking nobody', !/block/i.test(setJunk))
  /* Junking something already settled is a change of mind, and junk is the later decision. */
  ok('...clearing the settled flag, which is the one thing it does change',
    /no_record_at: null, no_record_by: null/.test(setJunk))
  /* Matched mail is on a record and is not anybody's to junk. */
  ok('...and refusing matched mail', /\.eq\('is_filed', false\)/.test(setJunk))
  /* And nothing is deleted: the Junk tab is where it goes, not where it ends. */
  ok('the screen says nothing was deleted', /Nothing deleted/.test(page))
}

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
The badge and the queue ask one question through one builder, the sidebar no longer counts our
own sent mail, "Open mail" is the name everywhere a person can read it, and a reply is charged
once on a debtor and written down on a lead.`)

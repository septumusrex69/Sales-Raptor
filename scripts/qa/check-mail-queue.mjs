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

  /* The page draws it, and draws the right one: work outstanding on the two work tabs, unread on
     the rest. Two numbers answering two questions, and neither at zero. */
  ok('the tabs carry a badge', /unreadByTab\[t\.id\]/.test(page))
  ok('...work outstanding on All and Needs matching',
    /\(t\.id === 'all' \|\| t\.id === 'needs-filing'\)\s*\n?\s*\? outstanding/.test(page))
  ok('...and nothing at zero, which is what teaches people to stop reading badges',
    /if \(n <= 0\) return null/.test(page))
  /* Told apart by colour: unread is brand, the same as the dot on a row and the unread filter. */
  ok('...the two are told apart', /isWork \? 'bg-gold-500 text-navy-950' : 'bg-brand-500 text-white'/.test(page))

  /* AND MARKING UNREAD RELOADS NOTHING. */
  const unreadOne = page.slice(page.indexOf('async function unreadOne'), page.indexOf('\n  /*\n   * Whether the reading pane'))
  ok('marking unread has a handler', unreadOne.length > 0)
  ok('...which updates the row in place', /setItems\(\(list\) => list\.map/.test(unreadOne))
  ok('...and the badge with it', /setUnreadByTab\(\(counts\) => bumpUnread\(counts, mail, 1\)\)/.test(unreadOne))
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

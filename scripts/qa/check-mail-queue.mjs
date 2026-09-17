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
  ok('the tab is called Free mail', /label: 'Free mail'/.test(page))
  ok('...and its hint says what free means', /nothing charged/.test(page))
  ok('the chip reads Free mail', /tight \? 'Free' : 'Free mail'/.test(page))
  ok('the action says what it does', /Mark as free/.test(page))
  ok('an unmatched message is sent to the tab it lands in', /mail\.noRecordAt \? 'Free mail'/.test(page))
  // The filter id is untouched. Renaming it would be a migration, and the label is not the key.
  ok('the filter id is still no-record', /\{ id: 'no-record', label: 'Free mail'/.test(page))
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
   * THE CONTROLS' OWN ROW. This shipped once with the heading and the controls in a single
   * wrapping flex row, and on an iPad the row broke after the compose button: "New email" was
   * carried up beside "My mailbox" and the bar began with "Check now". Every assertion below
   * passed the whole time, because the SOURCE order was right and the RENDERED order was not.
   * So the first thing checked is that the two are not in one row to begin with.
   */
  const rowStart = page.indexOf('<div className="flex flex-wrap items-center gap-3">')
  ok('the controls have a row of their own', rowStart > -1)
  const bar = page.slice(rowStart, page.indexOf('The tabs scroll if they must'))
  ok('...which the heading is not in, so it cannot wrap the order apart',
    !bar.includes('My mailbox'))
  const compose = bar.indexOf('setComposing(true)')
  const search = bar.indexOf('aria-label="Search your mailbox"')
  const switcher = bar.indexOf('<EmailViewSwitcher')
  ok('the bar has a compose button', compose > -1)
  ok('...a search box', search > -1)
  ok('...and the pane switcher', switcher > -1)
  ok('writing a new message comes first', compose < search)
  ok('searching sits to the right of it', search < switcher)
  ok('and how the mail is laid out is last', switcher === Math.max(compose, search, switcher))
  // Pushed right by the search box's own auto margin, which is what puts a gap between the
  // buttons that change mail and the two controls that only change how you look at it.
  ok('the right-hand group is pushed there', /relative ml-auto \$\{filter === 'blocked'/.test(bar))
  // Named in the order the firm drew them on the screenshot: write, sync, select.
  const sync = bar.indexOf('void syncMine()')
  const select = bar.indexOf('aria-pressed={selecting}')
  ok('the sync button is on the bar', sync > -1)
  ok('...and Select', select > -1)
  ok('writing comes before syncing', compose < sync)
  ok('...and syncing before selecting', sync < select)
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

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
The badge and the queue ask one question through one builder, the sidebar no longer counts our
own sent mail, "Free mail" is the name everywhere a person can read it, and a reply is charged
once on a debtor and written down on a lead.`)

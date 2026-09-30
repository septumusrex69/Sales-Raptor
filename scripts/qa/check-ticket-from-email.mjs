/**
 * A TICKET, RAISED OFF THE EMAIL THAT CAUSED IT.
 *
 * THE FIRM: "if we've received a dispute, for example, possibly it would be an email. I think
 * maybe there what we could do is we could create the ticket like it already exists for the
 * dispute and like somehow attach the email and the attachments from there to that ticket and
 * then have a note there."
 *
 * WHAT IT REPLACES IS SIX STEPS AND A RETYPE: read the email, raise a dispute, type out what the
 * debtor said, mark it received in writing, download the attachments, upload them again. The
 * retyping is where disputes get mis-recorded -- it is the step most likely to be shortened at
 * half past four, and what the debtor actually wrote is the thing a finding has to answer.
 *
 * THE THREE THINGS THAT WOULD GO WRONG SILENTLY, and what this holds:
 *
 *   - A TICKET FROM ANOTHER ACCOUNT. A mistyped id files one debtor's bank statements against
 *     another debtor's dispute. That is a leak between two people's records, and the sort that is
 *     found by the person it was leaked to. The database refuses it on both tables.
 *   - A SECOND PRESS. Two people reading one inbox, or a double click, raises two tickets for one
 *     objection -- and on a dispute the second is refused only AFTER the first has charged item 3.
 *   - AN ORPHANED FILE. The upload lands, the row fails, and a private bucket quietly fills with
 *     files nothing points at.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-ticket-from-email.mjs
 */
import { readFileSync } from 'node:fs'
import { escalationChargeable } from '../../src/lib/disputeCategories.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
/* Comments off before any source assertion: these files explain at length what they refuse, and a
   grep cannot tell the explanation from the thing. */
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(--|\/\/).*$/gm, '')

const sql = read('supabase/schema.sql')
const api = code('api/_lib/email/ticket.ts')
const router = code('api/email/[action].ts')
const panel = code('src/pages/accounts/EmailsPanel.tsx')
const mailLib = code('src/lib/accountEmails.ts')

/* ---------------- the links, and the account they may cross ---------------- */

ok('a document can belong to a ticket',
  /alter table public\.account_documents\s*\n\s*add column if not exists query_id uuid references public\.account_queries\(id\) on delete set null/.test(sql))
ok('...and so can an email on the account',
  /alter table public\.account_emails\s*\n\s*add column if not exists query_id uuid references public\.account_queries\(id\) on delete set null/.test(sql))
/*
 * ON THE ACCOUNT'S CORRESPONDENCE, NOT ON A PERSON'S INBOX. `user_emails` is somebody's own
 * mailbox; `account_emails` is the account's record of what was sent and received, and it is the
 * one with the BODY on it -- which is why the press does not have to reach into a mailbox for what
 * the debtor wrote. The first attempt put the link on the wrong table.
 */
ok('...and the inbox table carries no such link',
  /alter table public\.user_emails drop column if exists linked_query_id/.test(sql))
/*
 * CLOSING A TICKET MUST NEVER TAKE THE PAPERWORK WITH IT. The document is the record; the ticket
 * is how it was worked. `on delete cascade` here would delete a debtor's own bank statements when
 * somebody tidied up a dispute.
 */
check('a deleted ticket takes nothing with it',
  (sql.match(/references public\.account_queries\(id\) on delete cascade/g) ?? []), [])

const guardAt = sql.lastIndexOf('create or replace function public.ticket_belongs_to_the_same_account(')
ok('the database refuses a ticket from another account', guardAt > 0)
const guard = guardAt > 0 ? sql.slice(guardAt, sql.indexOf('$$;', guardAt)) : ''
ok('...comparing the ticket to the row’s own account',
  /v_ticket_account <> new\.account_id/.test(guard))
/* A SHEET-LEVEL TICKET HAS NO ACCOUNT, and neither does unfiled mail. "Belongs to the same
   account" is unanswerable when one side has none, and unanswerable is not the same as yes. */
ok('...and refuses it where either side has no account',
  /v_ticket_account is null or new\.account_id is null/.test(guard))
/* BOTH TABLES, or the rule holds on the half somebody happens to test. */
ok('...on documents', /create trigger documents_ticket_same_account/.test(sql))
ok('...and on the account’s emails', /create trigger mail_ticket_same_account\s*\n\s*before insert or update of query_id, account_id on public\.account_emails/.test(sql))

/* ---------------- the press ---------------- */

ok('it is an action on the existing email router', /\bticket,/.test(router))
/*
 * TWO KINDS ONLY. A decision and a litigation recommendation are things somebody DECIDES, not
 * things that arrive in the post; offering them here would be a door onto the wrong ladder.
 */
ok('only a dispute or a request can be raised from an email',
  /const kind = body\.kind === 'request' \? 'request' : 'dispute'/.test(api))
/*
 * A DISPUTE RAISED THIS WAY IS IN WRITING BY DEFINITION -- that is what pressing it on an email
 * MEANS. And all three columns go on in ONE insert, because workflow_start_on_dispute reads NEW: a
 * second update fires it against a row that still says the dispute has not arrived.
 */
ok('a dispute off an email is received in writing', /in_writing: kind === 'dispute'/.test(api))
ok('...dated the same day it is alleged',
  /alleged_on: kind === 'dispute' \? today : null,\s*\n\s*received_on: kind === 'dispute' \? today : null/.test(api))
ok('...in one insert, because the trigger reads NEW',
  (api.match(/\.from\('account_queries'\)\s*\n\s*\.insert\(/g) ?? []).length === 1)
/*
 * THE DESCRIPTION IS THE AGENT'S NOTE, AND THIS ASSERTED THE OPPOSITE.
 *
 * It used to hold that the description was `mail.body` -- "the debtor's own words, not a retype".
 * The firm sent that back: "the email now goes into the description, whereas the email should come
 * to the ticket in another form. The note should be something mandatory made by the clerk raising
 * the dispute, to give more of a description of what is actually happening."
 *
 * They are right about what it produced. The quoted thread became the summary, clamped to two
 * lines on the liaison's board, and the one person who had read the email wrote nothing down. The
 * email is not lost -- it is filed against the ticket with its attachments, which is the "another
 * form", and the box now shows it read-only beside the note.
 */
ok('the description is the note that was sent', /typeof body\.description === 'string'/.test(api))
ok('...and not the email body', !/const written = \(mail\.body \?\? ''\)/.test(api))
/* CAPPED, because a dictated note can run long and the card is 19rem wide. */
ok('...capped rather than unbounded', /written\.length > 4000/.test(api))
/* AND REQUIRED. A fallback to the body is how the old behaviour returns one quiet afternoon. */
ok('...and refused when it is empty', /!queryId && !description/.test(api))

/* ---------------- once, and only once ---------------- */

/*
 * A SECOND PRESS IS A SECOND TICKET FOR ONE OBJECTION. On a dispute the database would refuse it
 * -- one_open_dispute_per_account -- but only after the first had already charged item 3, so the
 * refusal has to come first and it has to come from the email.
 */
ok('an email that already raised a ticket refuses a second', /if \(mail\.query_id\) \{/.test(api))
ok('...and the screen does not offer one either', /email\.queryId\s*\n?\s*\?/.test(panel))
/* WHICH MEANS THE COLUMN HAS TO REACH THE SCREEN. CLAUDE.md's own warning: a column in the table,
   the type and the select but missing from the hand-written mapper reads as undefined for ever and
   nothing fails -- here that is a button that reappears after it has been used. */
ok('the mapper carries the ticket back', /queryId: r\.query_id \?\? null/.test(mailLib))
ok('...and the select asks for it', /occurred_at, query_id'/.test(mailLib))

/* ---------------- inbound only ---------------- */

/*
 * A DISPUTE IS SOMETHING THE DEBTOR SAYS. Raising one off a letter the firm itself sent would be
 * the firm objecting to its own demand -- and it would stop the very sequence that sent it.
 */
ok('the buttons are offered on inbound mail only', /extra=\{inbound \?/.test(panel))
/*
 * AND THEY OPEN THE BOX RATHER THAN RAISING ANYTHING. The firm: "if it says this is a dispute, it
 * should take you to kind of like creating a real dispute... it should ask you, what is the issue
 * where you can dictate and stuff." The buttons used to post straight to the endpoint, which
 * produced a dispute with no classification, no dictated issue, nobody's name on it and no chase
 * date -- and charged the debtor item 3 on the press.
 */
ok('...and they open the Escalate box rather than raising anything',
  /onClassify\(email, 'dispute'\)/.test(panel) && /onClassify\(email, 'request'\)/.test(panel))
ok('...so the panel does not reach the endpoint at all',
  !/raiseTicketFromEmail/.test(panel))
/* BESIDE REPLY AND FORWARD, at the firm's asking: "the dispute and the stuff is here at the
   bottom. Put it up there by the reply and the forward." On a long message they were three
   screens down. */
ok('...from the actions bar, not the foot of the message',
  /<MessageActions[\s\S]{0,1200}?extra=\{inbound \?/.test(panel))

/* ---------------- the attachments ---------------- */

/* ONE AT A TIME, so a failure can name the file: in parallel the first failure leaves the rest
   mid-flight and the report would be a guess. */
ok('attachments are fetched one at a time', /for \(const name of names\) \{/.test(api))
ok('...and filed against the ticket', /query_id: ticket\.id,/.test(api))
/*
 * AND AN ORPHAN IS CLEANED UP. The file lands in storage, the row fails, and a private bucket
 * quietly fills with things nothing points at -- uploadDocument's own rule, applied here because
 * this path cannot call it.
 */
ok('...with the file removed when its row fails',
  /await admin\.storage\.from\(BUCKET\)\.remove\(\[path\]\)/.test(api))
/* THE TICKET IS RAISED BY THEN, so what could not be fetched is reported rather than pretended
   away: a file the mailbox no longer holds is a line the collector acts on. */
ok('what could not be filed is named', /failed\.push\(/.test(api))
ok('...and handed back to the screen', /failed,/.test(api))

/* ---------------- and the debtor pays for a dispute and nothing else ---------------- */

check('a dispute is chargeable', escalationChargeable('dispute'), true)
check('...and a request is not', escalationChargeable('request'), false)
/*
 * DECIDED BY THE SAME FUNCTION THE BROWSER'S PATH USES, not by an `if` written here. Two places
 * that decide what a debtor pays is how one of them ends up charging for something the firm said
 * was free.
 */
ok('the endpoint asks that function rather than deciding for itself',
  /if \(!queryId && escalationChargeable\(kind\)\)/.test(api))
/* A FEE THAT WILL NOT WRITE IS NOT A REASON TO UNDO A DISPUTE that has been recorded and has
   already stopped the collection sequences. */
ok('...and a fee that fails does not undo the dispute', /catch \{[\s\S]{0,200}?charged = null/.test(api))

console.log(`\ncheck-ticket-from-email: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)

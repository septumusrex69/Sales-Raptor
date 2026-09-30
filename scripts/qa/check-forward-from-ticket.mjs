/**
 * FORWARDING THE DEBTOR'S EMAIL TO THE CLIENT, FROM THE TICKET IT RAISED.
 *
 * THE FIRM: "can me, as a client liaison, for example, Stefan, or Nicole, forward that email just
 * like that to the client?"
 *
 * THEY COULD NOT, AND THE REASON WAS NOT THE DATA. `account_emails.query_id` has carried the link
 * since the day the button existed, and the attachments have been filed beside it as documents.
 * Nothing ever read it back. A liaison working a dispute had the clerk's summary and not one word
 * the debtor actually wrote, and the only route to the words was to leave the ticket, find the
 * account and scroll its mail.
 *
 * AND THE FIRM RULED ON WHAT IT COSTS, against the recommendation put to them: "raising the
 * dispute charges a charge. I think it should charge the debtor for it. And also correspondence to
 * charge." So item 3 on the dispute and item 1(a) on the message are two chargeable things, not
 * one charged twice — which means this button spends the debtor's money and has to say so before
 * it is pressed rather than after.
 *
 * FOUR THINGS HOLD IT UP:
 *
 *   - THE LINK IS READ BACK. Without the fetch the card is empty and this is the old screen.
 *   - ONLY A LIAISON PRESSES IT. `canSendToClient` already decides who may put a query in front
 *     of a client, and a collections agent is deliberately not on that list.
 *   - THE FORWARD IS FILED ON THE TICKET, not loose on the account, or the liaison who picks it
 *     up next week cannot tell whether it was ever sent.
 *   - AND IT IS CHARGED, because the firm said so.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-forward-from-ticket.mjs
 */
import { readFileSync } from 'node:fs'
import { canSendToClient, CAN_SEND_TO_CLIENT } from '../../src/lib/disputeCategories.ts'
import { forwardSubject, forwardBody } from '../../src/lib/emailRules.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(--|\/\/).*$/gm, '')

const sql = read('supabase/schema.sql')
const page = code('src/pages/queries/QueryDetail.tsx')
const card = code('src/components/queries/TicketEmails.tsx')
const mail = code('src/lib/accountEmails.ts')
const queries = code('src/lib/accountQueries.ts')

/* ---------------- the link is read back ---------------- */

/* THE COLUMN EXISTS AND NOTHING CASCADES OFF IT. Closing a ticket must never take the debtor's
   own correspondence with it -- the message is the record, the ticket is how it was worked. */
ok('an email can belong to a ticket',
  /alter table public\.account_emails\s*\n\s*add column if not exists query_id uuid references public\.account_queries\(id\) on delete set null/.test(sql))

ok('there is a way to read a ticket’s mail back', /export async function fetchQueryEmails\(/.test(mail))
ok('...by the ticket', /\.eq\('query_id', queryId\)/.test(mail))
/*
 * OLDEST FIRST, which is the opposite of the account's list and deliberate. An account's mail is a
 * stream you look at the top of; a ticket's is a short conversation read in order -- the debtor's
 * objection, then what was passed on about it.
 */
ok('...oldest first', /\.eq\('query_id', queryId\)\s*\n\s*\.order\('occurred_at', \{ ascending: true \}\)/.test(mail))
/* THE SAME COLUMNS THE ACCOUNT'S LIST ASKS FOR. A narrower select here is a second hand-written
   column list and a second place to forget one -- and every field the reading pane draws is a
   field the forward needs too. */
for (const col of ['body', 'attachment_names', 'our_address', 'sent_by_name', 'occurred_at']) {
  ok(`...asking for ${col}`, new RegExp(`\\.eq\\('query_id', queryId\\)`).test(mail)
    && mail.slice(mail.indexOf('fetchQueryEmails')).includes(col))
}
ok('the page asks for it', /fetchQueryEmails\(id\)/.test(page))
/* NEVER FATAL. A ticket whose mail cannot be read is still a ticket somebody has to work. */
ok('...and a failure to read it does not break the ticket',
  /fetchQueryEmails\(id\)\.catch\(\(\) => \[\]\)/.test(page))
ok('the card is drawn', /<TicketEmails/.test(page))
/* ABSENT RATHER THAN EMPTY: most tickets are raised on a call and have no email at all. */
ok('...and hides itself when there is no mail', /if \(emails\.length === 0\) return null/.test(card))

/* ---------------- only a liaison presses it ---------------- */

check('a liaison may write to the client', canSendToClient('Liaison'), true)
check('...and a liaison manager', canSendToClient('Liaison Manager'), true)
/* THE RULE THIS SHARES RATHER THAN RESTATES. `canSendToClient`'s own note: a collections agent
   should not be writing to a client about a disputed account on their own initiative. */
check('a pre-legal agent may not', canSendToClient('Pre-legal Agent'), false)
check('...nor a pre-legal team leader', canSendToClient('Pre-legal Team Leader'), false)
check('...nor somebody with no role at all', canSendToClient(undefined), false)
ok('the list is the one the rest of the query screens use', CAN_SEND_TO_CLIENT.includes('Liaison'))
ok('the page asks that function rather than listing roles again',
  /canSendToClient\(currentUser\?\.role\)/.test(page))
ok('...and does not spell the roles out beside it', !/'Liaison Manager'/.test(page))

/*
 * TWO REASONS TO BE UNABLE TO PRESS IT, EACH WITH ITS OWN SENTENCE. Mail goes out through the
 * sender's OWN mailbox, so somebody who has not connected one cannot forward anything either --
 * and a button disabled without saying which reason applies is a button people ask about rather
 * than fix.
 */
ok('a mailbox is required too', /!mailbox/.test(page))
ok('...and the two reasons are told apart',
  /Only a liaison or a manager[\s\S]{0,200}?Connect your mailbox/.test(page))
ok('the button is disabled without both', /disabled=\{!canForward\}/.test(card))
ok('...and says why', /title=\{why \?\? undefined\}/.test(card))

/* ---------------- what it costs, said before the press ---------------- */

/*
 * THE FIRM OVERRULED THE RECOMMENDATION PUT TO THEM AND THIS IS THE RECORD OF IT. The argument
 * against charging was that item 3 on the dispute already covered the work; the firm's answer was
 * "raising the dispute charges a charge... and also correspondence to charge". So the forward is
 * item 1(a) like any message that leaves, and the price is on the screen beside the button.
 */
ok('the card says it is charged', /item 1\(a\)/.test(card))
ok('...before the press, not after', /canForward && \(\s*<p/.test(card))
ok('the composer repeats it where the message is actually written', /charged R25 under `\s*\+ 'item 1\(a\)/.test(page))
/* CHARGED THROUGH THE ONE FUNCTION THAT CHARGES, never an `if` written here. Two places that
   decide what a debtor pays is how one of them charges for something the firm said was free. */
ok('and it goes through recordSentEmail', /recordSentEmail\(\{/.test(page))
ok('...which raises the fee itself', /const charge = await chargeItem\(\{[\s\S]{0,200}?itemId: EMAIL_ITEM_ID/.test(mail))

/* ---------------- filed on the ticket, not loose on the account ---------------- */

ok('a sent message can carry its ticket', /queryId\?: string \| null/.test(mail))
ok('...and it is written', /query_id: input\.queryId \?\? null,/.test(mail))
ok('the forward passes it', /queryId: q\.id,/.test(page))
/*
 * AND THE DATABASE REFUSES A TICKET FROM ANOTHER ACCOUNT ON THIS VERY COLUMN. A mistyped id would
 * otherwise file one debtor's dispute correspondence against another debtor's ticket -- a leak
 * between two people's records, and the sort found by the person it leaked to.
 */
ok('...on a column the database guards',
  /create trigger mail_ticket_same_account\s*\n\s*before insert or update of query_id, account_id on public\.account_emails/.test(sql))
/* THE CARD RE-READS AFTERWARDS, so "was this sent?" is answered by what was filed rather than by
   what the screen pushed into its own state. */
ok('the card re-reads after a send',
  /recordSentEmail\(\{[\s\S]{0,700}?\.then\(\(\) => fetchQueryEmails\(q\.id\)\)/.test(page))

/* ---------------- the quote itself ---------------- */

check('a forward is marked as one', forwardSubject('Dispute on my account'), 'Fwd: Dispute on my account')
/* IDEMPOTENT. A message passed along twice must not arrive as "Fwd: Fwd:". */
check('...once', forwardSubject('Fwd: Dispute'), 'Fwd: Dispute')
check('...and an empty subject still says what it is', forwardSubject(null), 'Fwd:')

/*
 * AND THE QUOTE SAYS IT IS ONLY THE PREVIEW, which is the honest half. account_emails stores a
 * SNIPPET, not the whole message -- a forward that ends mid-sentence reads to the client as all
 * there was, and a client answering a dispute on half of what the debtor wrote is the failure
 * this one line prevents.
 */
const quoted = forwardBody(
  { fromName: 'A Debtor', fromAddress: 'd@example.com', subject: 'Dispute', occurredAt: '2026-09-01T09:00:00Z' },
  'I never received anything.',
  false,
)
ok('the quote carries who it was from', quoted.includes('d@example.com'))
ok('...and when', quoted.includes('2026'))
ok('...and says the rest was not stored', /Only the stored preview/.test(quoted))
ok('the page asks for it that way', /forwarding\.body \?\? '',\s*\n\s*false,\s*\n\s*\)/.test(page))

/* ---------------- and the address it goes to ---------------- */

/*
 * OFF THE CLIENT, FETCHED WITH THE TICKET. The page already made the hop one row to the client for
 * its name; making the liaison find and type the address is how a dispute gets forwarded to the
 * wrong client.
 */
ok('the ticket knows the client’s address', /clientEmail: string \| null/.test(queries))
ok('...read on the same round trip as the name',
  /\.select\('name, email, contact_person'\)/.test(queries))
ok('the forward opens addressed to them', /to=\{data\.clientEmail \?\? ''\}/.test(page))
/* NULL IS AN ANSWER, not a failure: a client with no address on file opens an empty To rather
   than hiding the button, because the sender may know what the record does not. */
ok('...and an unknown address leaves the box open rather than the button hidden',
  !/data\.clientEmail &&[\s\S]{0,80}?<TicketEmails/.test(page))

console.log(`\ncheck-forward-from-ticket: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)

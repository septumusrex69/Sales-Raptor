/**
 * The shape of the mail screen, and the lead that comes off an email.
 *
 * The firm rebuilt this page's layout in a mockup and handed it over: "Make it look much better.
 * Try harder." Six things in that picture were not in Raptor, and each of them is here because the
 * thing it fixes is invisible rather than broken -- a page that is merely plainer than it should
 * be never fails anything, so nothing stops it drifting back.
 *
 *  1. THE MAILBOX IS NAMED. Raptor reads a connected mailbox that is not always the address
 *     somebody signs in with, and an agent who cannot see which one they are reading cannot tell
 *     whether a message is missing or was never sent here.
 *  2. THE SENDER GETS A FACE. A mailbox is scanned by correspondent, and that only works if the
 *     colour is derived from the address -- a random one is worse than none.
 *  3. THE MESSAGE HAS A HEADING: subject, then when, then who from, then who else. It was one
 *     truncated grey line carrying the name, the address and the day together.
 *  4. THREE ANSWERS IN FRONT AND THE DOTS HARD RIGHT. Checked in check-reply-all.mjs.
 *  5. AN UNMATCHED MESSAGE SAYS SO. That is the state that costs money: a reply sent from one
 *     goes out earning nothing and leaves no trace on any statement.
 *  6. A LEAD CAN BE MADE FROM THE MESSAGE. The picker answers "which of our records is this?" and
 *     has nothing to say when the answer is "none of them, yet" -- which is the most valuable
 *     email the firm gets.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-mail-screen.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const page = read('../../src/pages/mail/MailPage.tsx')
const pane = read('../../src/components/email/ReadingPane.tsx')
const menu = read('../../src/components/ui/RowMenu.tsx')

/* One function cut out before asserting on it -- a regex over a whole file is satisfied by any
   line in it, and this file has been bitten by exactly that before. */
function slice(src, from, to, label) {
  const a = src.indexOf(from)
  if (a === -1) { failures.push(`${label}: could not find its opening anchor -- ${from}`); return '' }
  const b = src.indexOf(to, a + from.length)
  if (b === -1) { failures.push(`${label}: could not find its closing anchor -- ${to}`); return '' }
  return src.slice(a, b)
}

/* ---------- 1. a face per sender ---------- */

const colour = slice(page, 'const SENDER_COLOURS', '\n}\n', 'senderColour')
/*
 * DERIVED FROM THE ADDRESS, which is the whole point. Today's message from this debtor has to be
 * the same colour as last week's, or the avatar is decoration and costs a row its width for
 * nothing. Math.random or an index into the visible page would both look fine in a screenshot.
 */
ok('the colour is computed from the address', /senderColour\(address: string\)/.test(colour))
ok('...character by character, so it cannot depend on the page', /charCodeAt\(i\)/.test(colour))
ok('...and nothing about it is random', !/Math\.random/.test(colour))
ok('...nor drawn from where the row happens to sit', !/index/.test(colour))

const summary = slice(page, 'function MailSummary', 'function MailBody', 'MailSummary')
ok('every row in the list carries one',
  /<Avatar name=\{mail\.fromName \|\| mail\.fromAddress\} color=\{senderColour\(mail\.fromAddress\)\}/.test(summary))
/*
 * A SPAN, NOT A DIV. This whole summary renders inside the button that opens the message, and a
 * div inside a button is invalid markup that React will render and the browser will re-parent.
 */
ok('...as a span, because the row is a button', !/<div/.test(summary))
/* The narrow column gets a smaller one, for the same reason its rows drop the sender's address. */
ok('the reading pane column gets a smaller one', /size=\{tight \? 32 : 36\}/.test(summary))

/* ---------- 2. the message's own heading ---------- */

const detail = slice(page, 'renderDetail={(m) => (', '<MailBody mail={m}', 'the reading pane heading')

ok('the subject leads, and reads as a heading', /<h3 className="text-base font-semibold text-navy-950/.test(detail))
/*
 * THE TIME AS WELL AS THE DAY. "Today" stops being an answer the moment two messages from the
 * same debtor are open, and an hour apart is a different story from a week apart.
 */
ok('the day it came is beside the subject', /relativeDayLabel\(m\.occurredAt\)/.test(detail))
ok('...and the time of day with it', /timeOfDay\(m\.occurredAt\)/.test(detail))
/* Digits that line up, because two of these read as a pair. */
ok('...set in figures that line up', /tabular-nums/.test(detail))

ok('the sender has a face here too', /<Avatar name=\{m\.fromName \|\| m\.fromAddress\}/.test(detail))
ok('...at the size a heading wants', /size=\{40\}/.test(detail))
ok('the sender is named in full weight', /font-semibold text-navy-950">\{m\.fromName \|\| m\.fromAddress\}/.test(detail))
/*
 * THE ADDRESS IN ANGLE BRACKETS after the name, which is how every mail client writes it and how
 * anybody checking a message really is from their client expects to read it.
 */
ok('...with the address after it', /&lt;\{m\.fromAddress\}&gt;/.test(detail))
/* Wrapped rather than truncated: a half-shown address looks like the whole of a shorter one. */
ok('...which wraps rather than being cut off', /break-words/.test(detail))
ok('and then who else was on it', /<RecipientLines mail=\{m\} \/>/.test(detail))
/*
 * THE MATCH BUTTON IS GONE FROM THE CORNER. It said what to press and never said why; the bar
 * under the actions says both. Left here as well, an unmatched message would offer two.
 */
ok('there is no second Match button in the corner', !/startLink/.test(detail))
/* Where it IS filed still shows, and says what kind -- "On a lead" and "On a debtor account" are
   different enough that leaving the kind off would mislead. */
ok('a filed message still says where it went', /On \{m\.linkedTo\.label\}/.test(detail))
ok('...and what kind of record that is', /CRM_OR_ACCOUNT\[m\.linkedTo\.kind\]/.test(detail))

/* ---------- 3. an unmatched message says so ---------- */

const bar = slice(page, 'function NotMatchedBar', '\n/**', 'NotMatchedBar')
ok('it names the state', />Not matched yet</.test(bar))
/*
 * AND WHAT IT COSTS, which is the reason it exists. Item 1(a) is R25 on every message we send and
 * a fee can only be raised against an account, so a reply typed on an unmatched message goes out
 * earning nothing. Said plainly rather than left to be discovered on the statement.
 */
ok('...and what replying from it would mean', /will not\s*\n?\s*appear on any record/.test(bar))
/* Two ways out, because there are two reasons a message matches nothing. */
ok('the picker is offered', /onClick=\{onLink\}/.test(bar))
ok('...and a brand-new lead beside it', /onClick=\{onCreateLead\}/.test(bar))
ok('matching is the one to press', /bg-gold-400/.test(bar))
/*
 * SILENT ON ANYTHING ALREADY ANSWERED. Filed mail has its record and free mail was deliberately
 * given "none" as its answer -- neither is a loose end, and a warning that fires when nothing is
 * wrong is worse than no warning, because people stop reading it.
 */
ok('filed mail is not nagged', /if \(mail\.isFiled \|\| mail\.noRecordAt\) return null/.test(bar))
/* And it is on the open message, under the actions, not on every row in the list. */
ok('it hangs off the open message', /<NotMatchedBar mail=\{mail\}/.test(page))

/* ---------- 4. a lead, out of the sender ---------- */

const lead = slice(page, 'function CreateLeadFromMailModal', '\n/** A CRM record', 'the create-lead modal')

/*
 * EVERY PREFILL IS A GUESS IN AN EDITABLE BOX. The name comes out of one header field, the company
 * off the domain. Written straight to the record they would be wrong quietly; in a box, in front
 * of somebody reading the message, they are wrong visibly and for about two seconds.
 */
ok('the name is split out of the header', /splitPersonName\(mail\.fromName\)/.test(lead))
ok('...into a box that can be corrected', /onChange=\{\(e\) => setFirstName\(e\.target\.value\)\}/.test(lead))
ok('the company is guessed off the domain', /companyFromDomain\(domain\)/.test(lead))
/*
 * AND ONLY WHERE THE DOMAIN SAYS SOMETHING. A gmail.com address says nothing about who somebody
 * works for, and "Gmail" in the Company box is worse than a blank one.
 */
ok('...but never off a shared provider', /isSharedDomain\(mail\.fromAddress\) \? ''/.test(lead))
/*
 * NUMBERS ARE OFFERED, NEVER FILLED IN. A number lifted off a signature looks authoritative and is
 * still a guess, and a wrong one here is one a salesperson later phones. Same treatment the
 * account picker gives them.
 */
ok('numbers found in the message are suggested', /findContactDetails\(/.test(lead))
ok('...as something to press', /onClick=\{\(\) => setPhone\(c\.value\)\}/.test(lead))
ok('...and the phone box starts empty', /const \[phone, setPhone\] = useState\(''\)/.test(lead))

/* Email, because that is literally where this lead came from. */
ok('the source says where it came from', /useState<LeadSource>\('Email'\)/.test(lead))
ok('the sender’s address goes on the lead', /email: mail\.fromAddress/.test(lead))

/*
 * FILED ON THE NEW LEAD IN THE SAME BREATH, which is the whole point of doing this from the
 * mailbox. A lead created from an email that is not then carrying that email is the same
 * three-screen problem with one screen removed.
 */
ok('the message is filed on the lead it created', /linkMailToRecord\(\{/.test(lead))
ok('...as a lead', /kind: 'lead'/.test(lead))

/*
 * NOTHING IS CHARGED, and it says so. Annexure B prices work on DEBTOR ACCOUNTS; the sales side
 * raises no fees at all. The rest of this page talks about money constantly, so silence here
 * would read as "some fee, unstated".
 */
/*
 * Read with the comments stripped out. Both of these words are in the comment above the modal
 * explaining WHY nothing is charged, so tested against the file as written they would pass with
 * the sentence deleted off the screen -- which is the only place it matters.
 */
const leadVisible = lead.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
/* Before, in the modal -- so it is known while the decision is being made... */
ok('the modal says nothing is charged', /Nothing is charged &mdash; Annexure B/.test(leadVisible))
/* ...and after, in what it reports, because that line is the one that gets read. */
ok('...and so does the line it reports back',
  /Nothing was charged \\u2014 Annexure B is for debtor accounts/.test(leadVisible))
/* No fee call of any kind in this path. The check is the point: it cannot be added by accident. */
ok('and no fee is raised anywhere in it', !/chargeMessage|chargeItem|raiseFee/.test(lead))

/* ---------- 5. the plumbing the layout hangs on ---------- */

/*
 * THE LIST HEADER SCROLLS NOTHING. A search box that scrolls away with the list is one you have to
 * go back up for, and the flex child below it needs min-h-0 or it grows past the pane instead of
 * scrolling -- which is the classic way this shape ships broken.
 */
ok('the pane can carry something above its list', /listHeader\?: ReactNode/.test(pane))
ok('...which stays put', /shrink-0 border-b border-slate-100">\{listHeader\}/.test(pane))
ok('...while the list under it scrolls', /flex-1 min-h-0 lg:overflow-y-auto/.test(pane))

/* The dots take the shape of their neighbours on a toolbar, and stay a bare icon on a table row. */
ok('the overflow menu can be drawn as a button', /bordered\?: boolean/.test(menu))
ok('...and says what it is when it is only an icon', /aria-label=\{label \?\? 'More actions'\}/.test(menu))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
The mailbox says which mailbox it is, a sender has the same face every time, an open message
reads as a message, an unmatched one says what that costs, and the enquiry from somebody nobody
knows yet becomes a lead without leaving the page.`)

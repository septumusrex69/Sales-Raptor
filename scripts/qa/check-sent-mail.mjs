/**
 * Sent mail, forwarding, and the one thing that must never happen to either.
 *
 * THE MONEY RISK. The sync files an incoming message onto a debtor's account and raises Annexure
 * B item 6 for RECEIVING it. A message the firm SENT is item 1(a) and was already charged when it
 * went out. Pulling the Sent folder through the same code would bill the debtor twice for one
 * email — silently, on every message, for ever. Most of what is checked here is that sent mail
 * leaves the sync before it can reach any of that.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-sent-mail.mjs
 */
import { readFileSync } from 'node:fs'
import { forwardBody, forwardSubject, replySubject } from '../../src/lib/emailRules.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)

const sync = readFileSync(new URL('../../api/_lib/emailSync.ts', import.meta.url), 'utf8')
const mail = readFileSync(new URL('../../src/lib/userMail.ts', import.meta.url), 'utf8')
const schema = readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')

/* ---------- sent mail must never be filed or charged ---------- */

ok('the sync knows which kind of folder it is reading', /kind: 'inbox' \| 'junk' \| 'sent'/.test(sync))
ok('sent mail leaves before anything is filed', /if \(isSent\) \{/.test(sync))
{
  /*
   * ORDER IS THE WHOLE GUARANTEE. The early return has to come before findAccount, which is where
   * a message starts being filed onto a debtor and charged. Asserted as presence first: indexOf
   * returns -1 for a string that is gone, and -1 beats everything, so an order-only check passes
   * vacuously the moment the guard is deleted.
   */
  ok('...and the guard exists at all', sync.includes('if (isSent) {'))
  ok('...before the account match that charges item 6',
    sync.indexOf('if (isSent) {') < sync.indexOf('await findAccount('))
}
// includes() rather than a regex: the pattern is two literal backslashes and escaping them
// through a regex literal is how a check ends up asserting nothing.
ok('the Sent folder is found by special-use, not by guessing one name',
  sync.includes("findFolder(mailboxes, '\\\\Sent'"))
ok('sent mail carries its own watermark', /last_seen_uid_sent/.test(sync))
ok('...which is stored', /last_seen_uid_sent integer/.test(schema))

/* ---------- and it stays out of the working lists ---------- */

ok('the mailbox row records that it was sent', /is_sent: message\.isSent/.test(sync))
ok('sent mail arrives settled, not as work',
  /noRecordNeeded \|\| message\.isSent/.test(sync))
ok('Needs matching excludes sent mail', /needs-filing'\) out = .*eq\('is_sent', false\)/.test(mail))
ok('All excludes sent mail', /'all'\) out = out\.eq\('is_junk', false\)\.eq\('is_sent', false\)/.test(mail))
ok('Sent has its own tab', /'sent'\) out = out\.eq\('is_sent', true\)/.test(mail))
// The recipient is the useful address on a sent message; From is always us.
ok('who it went to is stored', /to_address: message\.toAddress/.test(sync))

/* ---------- forwarding ---------- */

check('a forward is marked as one', forwardSubject('Payment arrangement'), 'Fwd: Payment arrangement')
// Passed along twice must not arrive as "Fwd: Fwd:".
check('forwarding twice does not stutter', forwardSubject('Fwd: Payment arrangement'), 'Fwd: Payment arrangement')
check('...whatever the case', forwardSubject('FWD: Payment arrangement'), 'FWD: Payment arrangement')
check('an empty subject still says what it is', forwardSubject(null), 'Fwd:')
/*
 * "Re:" is left alone deliberately. Forwarding a reply is a forward OF that reply, and stripping
 * it would lose which turn of the thread was passed on.
 */
check('a reply forwarded keeps both', forwardSubject('Re: Payment arrangement'), 'Fwd: Re: Payment arrangement')
ok('reply and forward do not produce the same subject',
  replySubject('Query') !== forwardSubject('Query'))

{
  const original = {
    fromName: 'Ryno Buitendag', fromAddress: 'ryno@example.co.za',
    subject: 'Payment arrangement', occurredAt: '2026-09-12T13:58:51Z',
  }
  const out = forwardBody(original, 'I can pay R2 000 on the 30th.')
  // Headers first: a forward without them is a wall of text nobody can place.
  ok('the forward names who sent it', /Ryno Buitendag/.test(out))
  ok('...and their address', /ryno@example\.co\.za/.test(out))
  ok('...and when', /12 September 2026/.test(out))
  ok('...and the original subject', /Subject: Payment arrangement/.test(out))
  ok('...and carries the body', /I can pay R2 000 on the 30th\./.test(out))
  ok('a complete body is not apologised for', !/stored preview/.test(out))
  /*
   * The mailbox stores a 240-character snippet and keeps the message in the mailbox. Sending the
   * snippet as though it were the whole message is the failure to avoid — so where only the
   * snippet was available, the forward says so rather than passing itself off as complete.
   */
  ok('a truncated one says so', /stored preview/.test(forwardBody(original, 'I can pay…', false)))
  check('a missing subject is named, not left blank',
    /Subject: \(no subject\)/.test(forwardBody({ ...original, subject: null }, 'x')), true)
}

const page = readFileSync(new URL('../../src/pages/mail/MailPage.tsx', import.meta.url), 'utf8')
ok('the mail page can start a message to anybody', /setComposing\(true\)/.test(page))
ok('...and forward one', /onForward=\{\(\) => startForward\(m\)\}/.test(page))
// A forward starts a new conversation. Threading it would file the recipient's reply against the
// debtor the original came from.
{
  const fwd = page.slice(page.indexOf('{forwarding && ('), page.indexOf('{replying && ('))
  // The PROP, not the word — the comment beside it explains why it is absent and would match.
  ok('a forward is not threaded onto the original', !/inReplyTo=\{/.test(fwd))
}
// The body is fetched rather than taken from the row, which holds only a snippet.
ok('forwarding fetches the real message', /await fetchMailBody\(mail\.id, token\)/.test(page))

/* ---------- and the unmatch tells the truth ---------- */

/*
 * It said "It is back under Needs matching" unconditionally. For a junk message that is false —
 * Needs matching excludes junk — so an agent unmatched a newsletter, was told where to look, and
 * found an empty list. Junk is the COMMON case for an unmatch: matching a newsletter to a debtor
 * by mistake is exactly the thing being undone.
 */
ok('the unmatch names the tab it actually lands in', /You will find it under \$\{landsIn\}/.test(page))
ok('...and knows junk goes to Junk', /mail\.isJunk \? 'Junk'/.test(page))
ok('...and that settled mail does not go to the queue either', /mail\.noRecordAt \? 'No record needed'/.test(page))

/* ---------- a sent message says who it went to ---------- */

/*
 * to_address and to_name were on the row, in MailRow, in MailItem and in toItem from the day the
 * Sent folder was first synced — and nothing rendered them. Every Sent row read as being from the
 * agent, to nobody, which is the one fact a sent message is actually about.
 *
 * The same shape as the mapper bug CLAUDE.md describes, one level further up: present in the
 * database, present in the type, present in the mapper, absent from the screen. Nothing failed.
 */
ok('the summary picks the recipient on a sent message', /mail\.isSent \? mail\.toName : mail\.fromName/.test(page))
ok('...and their address with it', /mail\.isSent \? mail\.toAddress : mail\.fromAddress/.test(page))
// Without the word, a recipient sitting in the sender's position is simply read as the sender.
ok('...and labels it To, so it cannot be mistaken for the sender', /isSent && <span[^>]*>To /.test(page))

/*
 * The Sent chip is tested BEFORE the no_record_at chip, and the order is the whole point: sent
 * mail carries no_record_at only to stay out of the matching queue, so read in the other order
 * every message the agent ever sent claimed somebody had ruled it belonged on nobody's file.
 */
{
  const status = page.slice(page.indexOf('function MailStatus('), page.indexOf('function MailSummary('))
  const sentAt = status.indexOf('mail.isSent ?')
  const noRecordAt = status.indexOf('mail.noRecordAt ?')
  // Presence before order. An order-only assertion passes vacuously the moment the branch it
  // orders is deleted, because indexOf returns -1 — the trap CLAUDE.md names.
  ok('the row has a Sent chip', sentAt !== -1)
  ok('...and a No record needed chip', noRecordAt !== -1)
  ok('...and Sent is decided first', sentAt !== -1 && noRecordAt !== -1 && sentAt < noRecordAt)
}

/* ---------- and can be found by who it went to ---------- */

{
  /*
   * Sliced to the function's own closing brace, not to whatever happened to follow it. The first
   * version of this cut at `export async function countUnread` — a function this same change had
   * just deleted — so indexOf returned -1, the slice came back EMPTY, and all three assertions
   * below failed for a reason that had nothing to do with the code under test. An empty slice is
   * just as capable of passing vacuously, which is why the length check comes first.
   */
  const scopeAt = mail.indexOf('function scope<Q>')
  const scopeBody = scopeAt === -1 ? '' : mail.slice(scopeAt, mail.indexOf('\n}\n', scopeAt))
  ok('scope() was found and has a body to read', scopeBody.length > 100)
  ok('the Sent tab searches the recipient', /to_address\.ilike/.test(scopeBody))
  ok('...and their name', /to_name\.ilike/.test(scopeBody))
  /*
   * Only on the Sent tab. The sync records to_address on EVERY message, incoming ones included,
   * where it holds the firm's own address — searched everywhere, the firm's address would match
   * every message in the mailbox.
   */
  ok('...but only there', /input\.filter === 'sent'[\s\S]{0,200}to_address\.ilike/.test(scopeBody))
}

/* ---------- a sent message can never be matched, and so never charged item 6 ---------- */

/*
 * THE MONEY BUG THIS FILE OPENS BY DESCRIBING, arriving through the other door.
 *
 * The sync is careful: sent mail gets a mailbox row and leaves before anything can charge it,
 * because item 6 is "correspondence RECEIVED" and the message was already charged R25 under item
 * 1(a) on its way out. Then the mailbox drew a gold "Match" button on every unfiled row — sent
 * ones included — and matching goes straight to fileOnAccount, which raises item 6. One click
 * billed the debtor R13 for the firm's own letter, filed it on their account as direction 'in'
 * with the agent's address recorded as the debtor's, and wrote "Email from <the agent>" on their
 * timeline.
 *
 * Guarded in two places, and both are checked, because the button is a courtesy and the claim is
 * the rule.
 */
ok('the mailbox does not offer Match on a message you sent',
  /!mail\.isFiled && !mail\.isSent && \(/.test(page))

for (const fn of ['linkMailToAccount', 'linkMailToRecord']) {
  const body = bodyOf(fn)
  ok(`${fn} was found and has a body to read`, body.length > 100)
  // In the CLAIM, so a crafted request is refused by the same conditional update that makes the
  // fee happen once — not by an early return somebody can forget to keep.
  ok(`${fn} refuses a sent message`, /\.eq\('is_sent', false\)/.test(body))
}

// And says which of the two it is. "Already filed" would send somebody hunting for a match that
// was never there.
ok('the refusal says it is a message you sent', /message you sent/.test(mail))

/* ---------- a reply to a lead is actually written down ---------- */

/*
 * It said "Reply sent and logged on Acme" and logged nothing. ComposeEmailModal sends and does no
 * more, and only the debtor branch recorded anything — so every reply the sales side sent from
 * the mailbox was lost, by a page that said it had kept it.
 */
ok('there is a way to record a sent reply on a CRM record', /export async function recordSentToRecord/.test(mail))
ok('...and the mailbox calls it', /recordSentToRecord\(\{/.test(page))
ok('...writing it to the record\'s timeline', /from\('activities'\)\.insert/.test(mail))

/*
 * NOTHING IS CHARGED on that path, and this is the assertion worth having. Annexure B is the
 * tariff for collecting a debt; a lead answering a quotation owes the firm nothing. A chargeItem
 * call reaching this function would put an Annexure B fee on somebody who has no account.
 */
/** One function's source, from its declaration to its closing brace at column nought. */
function bodyOf(name) {
  const at = mail.indexOf(`export async function ${name}`)
  if (at === -1) return ''
  const rest = mail.slice(at)
  const end = rest.indexOf('\n}\n')
  return end === -1 ? '' : rest.slice(0, end)
}

/*
 * BOTH CRM paths, not just the new one.
 *
 * linkMailToRecord (a message coming in) and recordSentToRecord (a reply going out) are the two
 * halves of the same rule, and testing only the half just written would leave the other free to
 * grow a fee. They came within one edit of being the same function, which is exactly how the
 * rule gets lost.
 */
for (const fn of ['linkMailToRecord', 'recordSentToRecord']) {
  const body = bodyOf(fn)
  // Presence first: an empty slice would satisfy every "does not contain chargeItem" below by
  // containing nothing whatever.
  ok(`${fn} was found and has a body to read`, body.length > 100)
  check(`${fn} raises no fee`, /chargeItem/.test(body), false)
}

// The id we send is what lets THEIR reply thread back onto this record. See emailSync.
ok('a sent reply records its message id, so the answer can thread back',
  /email_message_id/.test(bodyOf('recordSentToRecord')))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
Sent mail is pulled but never filed and never charged, a forward carries the real message with
its headers, and an unmatched email says which tab it actually went to.`)

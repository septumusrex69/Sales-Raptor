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
ok('...and that free mail does not go to the queue either', /mail\.noRecordAt \? 'Free mail'/.test(page))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
Sent mail is pulled but never filed and never charged, a forward carries the real message with
its headers, and an unmatched email says which tab it actually went to.`)

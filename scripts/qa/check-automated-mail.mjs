/**
 * Our own mail system is not the debtor.
 *
 * An inbound message is matched to an account by the Message-ID it quotes in References or
 * In-Reply-To, and nothing checked who sent it. A Mail Delivery Subsystem failure notice for a
 * demand letter quotes that id — so the bounce was filed on the debtor's account as their
 * correspondence, put on their timeline in the daemon's name, and CHARGED R13 under item 6.
 *
 * That is money on a real statement for our mail server talking to itself. It counts toward the
 * items 1-7 ceiling, so it also displaces a fee the firm could legitimately have charged, and
 * once remittance has run it cannot be taken off.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-automated-mail.mjs
 */
import { readFileSync } from 'node:fs'
import { automatedMailKind, automatedMailNote } from '../../src/lib/emailRules.ts'

let pass = 0
const failures = []
const ok = (name, actual) => {
  if (actual === true) { pass += 1; return }
  failures.push(`${name}\n    expected true\n    got      ${JSON.stringify(actual)}`)
}
const eq = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const sync = read('../../api/_lib/emailSync.ts')
const userMail = read('../../src/lib/userMail.ts')

/* ---------- what a bounce looks like ---------- */

/*
 * THE NULL SENDER is the one signal here that is definitional rather than conventional: a bounce
 * is sent from <> precisely so that a bounce of a bounce cannot loop.
 */
eq('a null return path is a bounce', automatedMailKind({ returnPath: '<>' }), 'bounce')
/*
 * AN ABSENT RETURN-PATH IS NOT A NULL ONE. Plenty of ordinary mail reaches us without the header
 * at all, and reading "missing" as "empty" would classify half the inbox as undeliverable — which
 * fails in the direction that loses a debtor's words.
 */
eq('...but no return path at all is not', automatedMailKind({}), null)
eq('...and neither is a real one', automatedMailKind({ returnPath: '<thabo@example.co.za>' }), null)

/* The machine-readable bounce format. Both parts matter: multipart/report alone is not a bounce. */
eq('a delivery-status report is a bounce',
  automatedMailKind({ contentType: 'multipart/report; report-type=delivery-status; boundary=x' }), 'bounce')
eq('...but a report that is not about delivery is not',
  automatedMailKind({ contentType: 'multipart/report; report-type=disposition-notification' }), null)
eq('a failed-recipients header is a bounce',
  automatedMailKind({ failedRecipients: 'thabo@example.co.za' }), 'bounce')
/* The two mailbox names the standards reserve for a mail system talking about itself. */
eq('mail from the daemon is a bounce',
  automatedMailKind({ from: 'Mail Delivery Subsystem <MAILER-DAEMON@example.co.za>' }), 'bounce')
eq('...and from the postmaster', automatedMailKind({ from: 'postmaster@example.co.za' }), 'bounce')
/*
 * AND A PERSON WHOSE ADDRESS MERELY CONTAINS ONE OF THOSE WORDS IS A PERSON. "postmaster" inside
 * a longer local part, or a display name, must not silence somebody's reply.
 */
eq('a person is not a daemon because of their name',
  automatedMailKind({ from: 'Ann Postmasterson <ann@example.co.za>' }), null)
eq('...nor because of their domain', automatedMailKind({ from: 'thabo@mailer-daemon-services.co.za' }), null)

/* ---------- and what an out-of-office looks like ---------- */

/* RFC 3834: anything other than 'no' means a machine composed it. */
eq('an auto-submitted header is an automatic reply',
  automatedMailKind({ autoSubmitted: 'auto-replied' }), 'auto_reply')
eq('...however it is cased', automatedMailKind({ autoSubmitted: 'Auto-Generated' }), 'auto_reply')
/* 'no' is what an ordinary client sets when it sets the header at all. It means a person wrote it. */
eq('...but "no" means a person wrote it', automatedMailKind({ autoSubmitted: 'no' }), null)
eq('an autoreply header counts too', automatedMailKind({ autoReply: 'yes' }), 'auto_reply')

/*
 * DELIBERATELY CONSERVATIVE, and the direction of the error is why.
 *
 * A bounce read as a reply costs the debtor R13 and puts a wrong line on their timeline. A REPLY
 * READ AS A BOUNCE loses the debtor's own words, which is the thing the account exists to record.
 * So `Precedence: bulk` is not a signal here although it would catch more: mailing lists set it,
 * and a debtor's message must never be discarded because their employer's mail server is chatty.
 */
eq('a bulk precedence is not enough to silence somebody',
  automatedMailKind({ from: 'thabo@example.co.za', contentType: 'text/plain' }), null)
/* An ordinary reply, with the headers an ordinary reply carries, is left entirely alone. */
eq('a real reply is a real reply', automatedMailKind({
  from: 'Thabo Mokoena <thabo@example.co.za>',
  returnPath: '<thabo@example.co.za>',
  contentType: 'text/plain; charset=utf-8',
  autoSubmitted: null,
}), null)

/* ---------- it is still recorded, because a letter that bounced did not arrive ---------- */

/*
 * NOT DROPPED. A collector about to ring and ask why nobody has answered needs to know the letter
 * never got there.
 */
const note = automatedMailNote('bounce', 'Letter of demand')
ok('a bounce is written down', /could not be delivered/.test(note))
ok('...quoting what it was about', /Letter of demand/.test(note))
/* And saying plainly that nobody was charged, because the timeline is the record of what was. */
ok('...and says no fee was raised', /No correspondence fee has been raised/.test(note))
ok('...in our voice, not the debtor\'s', /An email we sent/.test(note))
ok('an automatic reply says what it is', /automatic reply/.test(automatedMailNote('auto_reply', null)))
/* A message with no subject leaves the sentence alone rather than quoting an empty string. */
ok('...with no empty quotation when there is no subject',
  !/""/.test(automatedMailNote('bounce', null)) && !/Subject/.test(automatedMailNote('bounce', '  ')))

/* ---------- the sync refuses to file or charge it ---------- */

ok('the sync asks whether a message is automated', /automatedMailKind\(headerFields\(parsed\)\)/.test(sync))
/*
 * CHECKED AFTER THE MATCH and BEFORE the filing, which is the only order that works: the note
 * needs to know which account it belongs to, and the fee is raised inside fileAccountEmail.
 */
ok('...once it knows which account it belongs to', /accountMatch \? automatedMailKind/.test(sync))
ok('...and stops before filing it', /if \(accountMatch && automated\) \{/.test(sync))
ok('...writing a note instead', /body: automatedMailNote\(automated, parsed\.subject \?\? null\)/.test(sync))
/* Raptor composed that sentence, so the timeline's "just what people wrote" filter must hide it. */
ok('...marked as ours rather than as the debtor\'s words', /source: 'system',/.test(sync))
/*
 * Claimed against the account so that nobody can file it by hand afterwards and raise the R13
 * this branch just refused. It belongs to that account; it is simply not the debtor's.
 */
ok('...and claimed so it cannot be filed by hand later',
  /if \(accountMatch && automated\)[\s\S]{0,1400}markUserEmailLinked/.test(sync))

/*
 * HEADERS READ OFF headerLines, NOT parsed.headers. mailparser turns some headers into objects —
 * a Content-Type comes back as { value, params } — and a caller expecting a string gets
 * "[object Object]", which matches nothing and fails silently in the direction that charges the
 * debtor.
 */
ok('the headers are read unparsed', /const lines = parsed\.headerLines \?\? \[\]/.test(sync))
ok('...and the content type keeps its parameters', /failedRecipients: of\('x-failed-recipients'\)/.test(sync))

/* ---------- and so does the path a person uses ---------- */

/*
 * THE SAME RULE ON THE OTHER DOOR. Without it an agent could put a delivery failure notice on an
 * account by hand and raise the R13 the sync had just declined.
 */
ok('filing by hand asks the same question', /const automated = automatedMailKind\(\{ from: input\.mail\.fromAddress \}\)/.test(userMail))
ok('...and refuses', /if \(automated !== null\) \{[\s\S]{0,80}throw new Error/.test(userMail))
/*
 * REFUSED BEFORE THE CHARGE, not after. chargeItem is the first thing fileOnAccount does, so a
 * guard placed below it would decline the filing and still bill the debtor.
 */
const guardAt = userMail.indexOf('const automated = automatedMailKind({ from: input.mail.fromAddress })')
const chargeAt = userMail.indexOf('const charge = await chargeItem({', guardAt === -1 ? 0 : guardAt)
ok('...before anything is charged', guardAt !== -1 && chargeAt !== -1 && guardAt < chargeAt)
/* And it says why, because "no" without a reason reads as a broken button. */
ok('...telling the agent what it is', /delivery failure notice from a mail system/.test(userMail))
ok('...and what it would have cost the debtor', /R13 under item 6/.test(userMail))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
A bounce is not the debtor writing to us. It is not filed as their correspondence, it does not go
on their timeline in the daemon's name, and it does not raise item 6 — but the account is still
told that the letter did not arrive, which is the part a collector needs.`)

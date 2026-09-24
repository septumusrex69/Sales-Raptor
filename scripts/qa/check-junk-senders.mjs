/**
 * MOVING SOMETHING TO JUNK REMEMBERS THE SENDER.
 *
 * The firm: "if you move something to junk, it should be pretty much almost junk, always junk --
 * and then every time a new email is received from that email address, it should be moved to
 * junk. Stay there."
 *
 * It did not. `setJunk` moved the message and nothing else, so the same newsletter was junked by
 * hand every week and the decision was thrown away each time.
 *
 * WHAT THIS GUARDS:
 *
 *   - THE DECISION IS KEPT, on mail_sender_rules -- the table whose own note said 'always_junk'
 *     was "the obvious next one, and adding it should not need a second table".
 *   - AND UNDONE. "Not junk" removes the rule, or the move cannot be reversed: the next message
 *     would come straight back to Junk and the person would have no idea why.
 *   - THE SYNC APPLIES IT, and only ever ADDS to what the folder said -- a rule must not be able
 *     to pull a message OUT of the server's own Spam folder.
 *   - AN ADDRESS ON A DEBTOR'S FILE GETS NO RULE. This file's own words: "junk is exactly where a
 *     message goes missing", and a debtor writing from a free address lands there often enough
 *     that the move was made reversible on purpose. The message still moves; the standing rule is
 *     what is withheld, and the person is TOLD, because otherwise they assume it was made.
 *   - IT IS NOT A BLOCK. mail_blocks stops mail becoming a row at all. This files it, under Junk,
 *     where it is readable, searchable and reversible.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-junk-senders.mjs
 */
import { readFileSync, existsSync } from 'node:fs'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')

const mail = read('src/lib/userMail.ts')
const sync = read('api/_lib/emailSync.ts')
const page = read('src/pages/mail/MailPage.tsx')
const schema = read('supabase/schema.sql')

ok('the mail library is readable at all', mail.length > 0)
ok('the sync is readable at all', sync.length > 0)

/* ------------------------------------------------ the decision is kept */

ok('the database accepts an always-junk rule',
  /mail_sender_rules_action_check[\s\S]{0,200}?'always_junk'/.test(schema))
/*
 * ONE RULE PER SENDER, which the existing unique index already enforces. That is the reason
 * junking REPLACES a no-record rule rather than sitting beside it: a sender cannot be both a
 * supplier whose mail needs no record and spam.
 */
ok('...one per sender, as the index already required',
  /mail_sender_rules_pattern_idx[\s\S]{0,120}?\(user_id, pattern\)/.test(schema))

ok('junking writes the rule', /action: 'always_junk'/.test(mail))
/*
 * AND THE WRITE IS REACHED. Asserted only as "the function exists and writes the rule", this
 * passed with the CALL deleted -- the rule-writer sat there complete and unreachable. Found by
 * break-testing, which is the only reason it is written this way.
 */
ok('...and junking actually calls it',
  /if \(junk\) \(\{ remembered, kept \} = await rememberJunkSenders\(userId, senders\)\)/.test(mail))
ok('...replacing whatever rule was there rather than ignoring it',
  /onConflict: 'user_id,pattern' \}/.test(mail.slice(mail.indexOf('rememberJunkSenders'))))
/*
 * READ BEFORE THE UPDATE. Afterwards the rows are still there, so this is not correctness by
 * accident -- but reading first is what makes the rule come from the same list the person saw.
 */
const remembering = mail.slice(mail.indexOf('export async function setJunk'))
const sendersAt = remembering.indexOf('await sendersOf(ids)')
const updateAt = remembering.indexOf(".from('user_emails')")
ok('the senders are read', sendersAt > 0)
ok('the update happens', updateAt > 0)
ok('...and the senders are read before the messages move', sendersAt < updateAt)

/* ------------------------------------------------ and undone */

/*
 * THE HALF THAT MAKES IT REVERSIBLE. Without this, "Not junk" moves one message and the sender's
 * next one arrives back in Junk -- a move that cannot be undone, which is precisely the trap the
 * junk tab was made reversible to avoid.
 */
ok('"not junk" forgets the sender', /async function forgetJunkSenders/.test(mail))
ok('...deleting only the junk rules, never the no-record ones',
  /\.eq\('action', 'always_junk'\)\.in\('pattern', senders\)/.test(mail))
ok('...and it is actually called when un-junking', /else await forgetJunkSenders\(userId, senders\)/.test(mail))

/* ------------------------------------------------ the sync applies it */

ok('the sync loads the junk rules', /loadSenderRules\(admin, conn\.user_id, 'always_junk'\)/.test(sync))
/* Once per folder, like the blocks beside it -- not a query per message on a mailbox this size. */
const perFolder = sync.slice(sync.indexOf('const junkRules'), sync.indexOf('const junkRules') + 400)
ok('...once per folder rather than once per message', !/for \(/.test(perFolder))
ok('the sync matches a junked sender', /isBlocked\(normaliseAddress\(fromAddress\), junkRules\)/.test(sync))
/*
 * IT ONLY ADDS. `isJunk || junkedSender` — a rule can make a message junk, and can never take one
 * OUT of the server's own Spam folder, which would be the app overruling the mail server.
 */
ok('a rule can only make something junk, never un-junk it', /isJunk: isJunk \|\| junkedSender/.test(sync))

/* ------------------------------------------------ a debtor's address gets no rule */

/*
 * THE ONE JUDGEMENT IN HERE, and the reason it is written down. The message still moves -- one
 * message, asked for -- and the standing rule is withheld, because a debtor's every future reply
 * quietly landing in Junk could lose an arrangement with nobody seeing it go.
 */
ok('an address on a debtor file is checked for', /if \(await debtorFileFor\(address\)\) \{ kept\.push\(address\); continue \}/.test(mail))
ok('...and reported back rather than swallowed', /remembered: string\[\]; kept: string\[\]/.test(mail))
ok('the screen says what the standing rule now does', /function junkRuleNote/.test(page))
/*
 * AND THE SENTENCE REACHES THE SCREEN. Same hole as above: asserting the helper exists passed
 * with it spliced out of both status messages, leaving a rule nobody is told about.
 */
check('...on both the bulk and the single-message paths',
  [...page.matchAll(/junkRuleNote\(junk, remembered, kept\)/g)].length, 2)
ok('...naming the sender it will junk from now on', /will go straight to junk/.test(page))
/* The case somebody would otherwise assume had been done. */
ok('...and saying plainly where no rule was made', /is on a debtor's file, so their future mail is left in your inbox/.test(page))
ok('the screen passes who is asking, or no rule could be made', /setJunk\(ids, junk, currentUser\?\.id \?\? null\)/.test(page))
ok('...from the single-message path too', /setJunk\(\[mail\.id\], junk, currentUser\?\.id \?\? null\)/.test(page))

/* ------------------------------------------------ it is not a block */

/*
 * THE DISTINCTION THIS FEATURE RESTS ON. A block stops the mail becoming a row at all -- which is
 * why blockSender REFUSES an address on a debtor's file outright. Junk files it and shows it.
 */
ok('blocking still refuses a debtor’s address outright',
  /Blocking it would stop their `?\s*\+?\s*'?mail reaching Raptor at all/.test(mail))
ok('...and the junk rule is a different table row, not a block', !/mail_blocks/.test(mail.slice(mail.indexOf('rememberJunkSenders'), mail.indexOf('rememberJunkSenders') + 1500)))

/* ------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-junk-senders: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)

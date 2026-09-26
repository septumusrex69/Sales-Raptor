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
  /if \(remember\) \(\{ remembered, kept \} = await rememberJunkSenders\(userId, senders\)\)/.test(mail))
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

/* ------------------------------------------------ but only if you said so */

/*
 * THE FIRM, HAVING LIVED WITH THE RULE BEING AUTOMATIC: "if I say move to junk, can it also ask
 * me if I can move and always send those things to junk?"
 *
 * WHY IT IS A QUESTION AND NOT A SETTING. The firm described both answers in one breath. One is
 * the nuisance sender — the reason the rule exists at all, and the instruction at the top of this
 * file. The other is the mail they actually want: "sometimes I get like stuff that I want to see
 * but it's junk, so I don't want to see it in my main inbox — I'll get to it later — it's
 * cluttering my main mailbox because it's actually junk but it's kind of semi-important,
 * otherwise I would have blocked it." Shelving one of those is not a verdict on its sender, and
 * a standing rule made on that move quietly diverts mail somebody wanted.
 */
ok('the mover can be told not to make a rule', /remember: boolean = true/.test(mail))
/*
 * TRUE BY DEFAULT, and that is deliberate rather than convenient: every caller that predates the
 * question meant the rule, and flipping the default silently would put the firm's nuisance
 * senders back in the inbox with nothing on screen to explain it.
 */
ok('...and the default is still to make it', /remember: boolean = true/.test(mail))
/*
 * "JUST THIS ONE" LEAVES A RULE THAT IS ALREADY THERE. It is a decision about this message, not
 * a change of mind about the sender — and a button saying "move it" that quietly cancelled a
 * standing rule is the kind of thing nobody connects to the mail that starts arriving a week
 * later. "Not junk" is the undo, and it says so.
 */
ok('...and never quietly cancels one', !/if \(!remember\)[\s\S]{0,200}forgetJunkSenders/.test(mail))

/* The box that asks, and both answers on it. */
ok('the screen asks before it decides for you', /function JunkModal/.test(page))
ok('...offering the one message on its own', /Just this message/.test(page))
ok('...and the standing rule as the other answer', /Always junk \{one\}/.test(page))
ok('...calling the mover with what was chosen', /setJunk\(ids, true, userId, remember\)/.test(page))
/*
 * AND JUNKING IS WHAT GOES THROUGH THE BOX, both ways in. Asserted on both paths because the
 * reading pane and the bulk bar are separate buttons, and one of them left unasked is the
 * silent rule still being made.
 */
ok('the bulk bar asks', /if \(junk\) \{ setJunking\(items\.filter/.test(page))
ok('...and so does the open message', /if \(junk\) \{ setJunking\(\[mail\]\)/.test(page))
ok('...and the box is actually rendered', /<JunkModal/.test(page))
/*
 * "NOT JUNK" IS NOT ASKED ABOUT, because it has one meaning: it takes the message back AND drops
 * the rule, or the next message returns to Junk and the undo looks broken. Nothing to choose.
 */
ok('un-junking goes straight through', /setJunk\(ids, junk, currentUser\?\.id \?\? null\)/.test(page))
ok('...and says the rule went with it', /lands in your mailbox again/.test(page))

/*
 * THE THIRD DECISION IS NAMED ON THE BOX so nobody reaches for junk to get it. The firm drew the
 * line themselves: semi-important mail goes to Junk, "otherwise I would have blocked it".
 */
ok('the box says neither answer blocks anybody', /Neither of these blocks anyone/.test(page))
ok('...and points at the thing that does', /use Block sender/.test(page))
/* And says what junk IS, which is the sentence that makes the choice above make sense. */
ok('...and that junk is a shelf rather than a bin', /Junk is a shelf, not a bin/.test(page))

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
/*
 * AND IT IS SAID BEFORE THE PRESS NOW, NOT AFTER IT. The refusal used to arrive in the status
 * line once the move had happened — which is the one case where somebody would otherwise assume
 * the rule HAD been made. The box looks the address up as it opens, the same correction the
 * block box beside it already carries.
 */
ok('the box looks up whether a rule may be made at all', /debtorFileFor\(a\)/.test(page))
ok('...and says so before anything moves', /is on a debtor.rsquo;s file/.test(page))
ok('...naming what is withheld and why', /no standing rule is made for them/.test(page))
/* And afterwards, what the rule now does — a rule nobody is told about surprises somebody in a
   fortnight when a sender's mail is "missing". */
ok('...naming the sender it will junk from now on', /will go straight to junk/.test(page))
ok('...and reporting the ones left alone', /so their future mail is left in your inbox/.test(page))
ok('the screen passes who is asking, or no rule could be made',
  /setJunk\(ids, true, userId, remember\)/.test(page))
/*
 * IT DOES NOT OFFER TO MAKE A RULE THAT IS ALREADY THERE. Pressing "always junk" on a sender
 * already junked does nothing and reads as a button that failed.
 */
ok('...and knows which senders already have one', /alwaysJunked: Set<string>/.test(page))
ok('...read from the same table', /fetchSenderRules\(currentUser\.id, 'always_junk'\)/.test(page))

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

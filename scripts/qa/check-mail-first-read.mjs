/**
 * A NEW MAILBOX STARTS FROM TODAY, AND A COLLEAGUE IS NOT A DEBTOR.
 *
 * THE FIRM, WATCHING FOUR NEW MAILBOXES FILL UP: "if you upload a new person, then it downloads
 * all of the other stuff... and then a lot of that stuff needs matching. Should we just start their
 * mailboxes from scratch so that they can start matching from this point on forward? Otherwise it
 * could be overwhelming." And: "somebody from inside Bredell Ferreira should obviously be in open
 * mail."
 *
 * WHAT THEY WERE LOOKING AT: 127 messages waiting to be matched in Camille's inbox, 60 in Vusi's,
 * and climbing as the sync worked through the remaining folders.
 *
 * THE FIRST HALF WAS ALREADY DECIDED IN THIS CODEBASE AND NOT APPLIED. `firstRead` says "a folder
 * being read for the first time is history, not post", and it was honoured for Archive and every
 * custom folder -- but the INBOX call passed no such flag, so the one folder that matters went
 * through the full path. The reason written beside `firstRead` is MONEY, not tidiness: matching old
 * post onto accounts raises Annexure B item 6 at R13 a message against debtors for correspondence
 * dealt with months ago.
 *
 * THE SECOND HALF HAS A TRAP, and the numbers are why this file exists rather than a one-line
 * rule. Of the 105 colleague emails sitting in Needs matching, 42 carried an account reference, a
 * balance or a discount -- including two in the firm's own screenshot:
 *
 *     RE: Viva Elukwatini (Pty) Ltd // African Ziyebeja (VE0001)
 *     FW: Immediate Payment Notification // F20832
 *
 * Open mail means ON NOBODY'S FILE AND NOTHING CHARGED. Sending every internal address there would
 * have filed those 42 nowhere. So the reference is read first and only mail carrying none falls
 * through.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-mail-first-read.mjs
 */
import { readFileSync } from 'node:fs'
import { referencesIn, normaliseReference, isColleague } from '../../src/lib/mailReference.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

const sync = read('api/_lib/emailSync.ts')
const schema = read('supabase/schema.sql')
ok('the sync is readable at all', sync.length > 10000)

/* ---------------- what a subject line names ---------------- */

/*
 * THE FIRM'S OWN SUBJECT LINES, copied off their screenshot. These are the fixtures because they
 * are what the rule has to survive -- an invented set would be written to pass.
 */
check('a client reference in brackets is read',
  referencesIn('RE: Viva Elukwatini (Pty) Ltd // African Ziyebeja (VE0001)'), ['VE0001'])
check('...and one after a double slash',
  referencesIn('FW: Immediate Payment Notification // F20832'), ['F20832'])
check('...and Raptor’s own case number',
  referencesIn('Your account RAP-123829 is overdue'), ['RAP-123829'])

/*
 * AND THE ONES IT MUST REFUSE, which matter more. A false reference files a colleague's note onto
 * the WRONG debtor and charges them R13 under item 6 for receiving it.
 */
check('a rand amount is not a reference',
  referencesIn('RE: Debtor is asking for a discount. Balance: R76 156.62 Discount : R22 846,98'), [])
check('...nor is a month', referencesIn('Management Report | 2026 07'), [])
check('...nor is an ordinary subject', referencesIn('Re: Test'), [])
check('...and nothing is read out of nothing', referencesIn(null), [])
/* THE DIGIT FLOOR IS WHAT SEPARATES A REFERENCE FROM AN AMOUNT. Two digits is a rand figure. */
check('two digits is not enough to be a reference', referencesIn('owed R76 today'), [])

/* THE SAME ACCOUNT WRITTEN THREE WAYS IS ONE ANSWER, not three lookups. */
check('separators do not make a second reference',
  referencesIn('ABSTO/0041 and ABSTO-0041 and ABSTO0041').length, 1)
check('...and the normalised form is what gets compared',
  normaliseReference('RAP-123829'), 'RAP123829')
check('...however it was typed', normaliseReference('rap/123829'), 'RAP123829')

/* ---------------- one account or none ---------------- */

/*
 * THE GUARD THE WHOLE FEATURE RESTS ON. CLAUDE.md: `client_reference` is the client's own filing
 * and is NOT unique -- 5 013 of them sit on more than one account, 21% of the book. The lookup
 * asks for TWO and accepts the answer only when one comes back.
 */
const lookup = sync.slice(sync.indexOf('async function accountFromReference'),
  sync.indexOf('async function findAccount'))
ok('the reference lookup is in the sync', lookup.length > 400)
ok('...and asks for two so it can tell one from many', /\.limit\(2\)/.test(lookup))
ok('...matching only when exactly one account carries it',
  /data\.length === 1/.test(lookup))
ok('...and saying so in the log when more than one does',
  /data\.length > 1/.test(lookup))
/* ALL THREE NUMBERS, because a colleague quotes whichever one they have in front of them. */
for (const col of ['case_number', 'account_number', 'client_reference']) {
  ok(`...looking at ${col}`, new RegExp(`${col}\\.ilike`).test(lookup))
}
/* QUOTED INTO THE FILTER. A reference arrives in a subject line from outside the firm, and a bare
   separator in a PostgREST `or` is a syntax character. */
ok('...with the token quoted rather than pasted in',
  /ilike\."\$\{v\}"/.test(lookup))

/* ---------------- and it is the LAST route, not the first ---------------- */

/*
 * ORDER IS A DECISION HERE. Thread and sender are facts about the message; a reference is what
 * somebody typed, and a typo must not outrank the debtor's own address.
 */
const finder = sync.slice(sync.indexOf('async function findAccount'),
  sync.indexOf('async function findAccount') + 3500)
ok('the finder still matches by thread', /via: 'thread'/.test(finder))
ok('...and by the sender’s address', /via: 'address'/.test(finder))
ok('...and by a reference', /via: 'reference'/.test(finder))
ok('...with the reference last of the three',
  finder.indexOf("via: 'thread'") < finder.indexOf("via: 'address'")
  && finder.indexOf("via: 'address'") < finder.indexOf("via: 'reference'"))

/* ---------------- the inbox's first read is history ---------------- */

/*
 * THE ONE-LINE FIX, AND THE ONE THAT WAS MISSING FOR THE LONGEST. Asserted on the INBOX call
 * specifically: every other folder has had this since firstRead was written.
 */
const inboxCall = (sync.match(/const inboxResult = await syncMailbox\([\s\S]{0,300}?\)\n/) ?? [''])[0]
ok('the inbox call is where this check thinks it is', inboxCall.includes("'INBOX'"))
ok('...and its first read is treated as history',
  /conn\.last_seen_uid == null/.test(inboxCall))
/* AND HISTORY IS NOT WORK. The flag has to reach the row, or the messages are synced and still
   sitting in the queue -- which is exactly what the firm was looking at. */
ok('history lands in Open mail rather than Needs matching',
  /noRecordNeeded:[\s\S]{0,400}\|\| firstRead/.test(sync))

/* ---------------- a colleague is not a debtor ---------------- */

check('a colleague shares the mailbox’s domain',
  isColleague('anastasia@bredellferreira.co.za', 'nicole@bredellferreira.co.za'), true)
check('...and an outsider does not',
  isColleague('accounts@foh-cpd.co.za', 'nicole@bredellferreira.co.za'), false)
/* NEITHER HALF MISSING IS A COLLEAGUE. A null domain matching a null domain would make every
   malformed address internal. */
check('...nor does a missing address', isColleague(null, 'nicole@bredellferreira.co.za'), false)
check('...nor a missing mailbox', isColleague('x@y.co.za', null), false)
ok('the sync asks it of the mailbox being synced, not a hand-kept list',
  /isColleague\(normaliseAddress\(fromAddress\), conn\.email\)/.test(sync))

/*
 * AND IT IS LAST IN THAT EXPRESSION, which is the ordering the 42 depend on: a colleague's mail
 * starts in Open mail, and a reference match CLEARS it further down.
 */
const openMailRule = (sync.match(/noRecordNeeded:[\s\S]{0,400}?,\n/) ?? [''])[0]
ok('a standing rule still sends a supplier to Open mail', /isBlocked\(/.test(openMailRule))
ok('...and a colleague goes there too', /isColleague\(/.test(openMailRule))

/* ---------------- matching wins, and the database insists on it ---------------- */

/*
 * THE CONSTRAINT IS WHY THIS IS NOT OPTIONAL. schema.sql: "A message cannot be both on a record
 * and on nobody's file." A colleague's mail now starts in Open mail, so a row that then matches by
 * its subject reference would VIOLATE that check and the update would be refused -- the message
 * would stay in Open mail with nothing anywhere saying why.
 */
ok('the database refuses a message that is both',
  /user_emails_no_record_unmatched/.test(schema))
const linker = sync.slice(sync.indexOf('async function markUserEmailLinked'),
  sync.indexOf('async function markUserEmailLinked') + 1600)
ok('...so matching clears Open mail', /no_record_at: null/.test(linker))
ok('...while still only claiming an unmatched row',
  /\.is\('linked_account_id', null\)/.test(linker))

console.log(`\ncheck-mail-first-read: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)

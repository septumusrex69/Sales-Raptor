/**
 * WHAT THE BELL IS FOR, AND WHAT IT IS NOT FOR.
 *
 * THE FIRM, signed in as the liaison a request had just been handed to: "just check if it went to
 * the notifications... because all of the notifications are emails. An email is an email and it
 * goes to the mail thing at the top, but the mails didn't go to the notifications."
 *
 * CHECKED, AND IT HAD NOT. Nicole's bell held fourteen notifications and every one of them was an
 * email. Nothing anywhere told her a ticket was now hers to answer — the only signal was the
 * Disputes badge moving from nought to one, which is a number on a menu item and reaches nobody
 * who is looking at a different screen.
 *
 * TWO FAULTS, AND THEY MADE EACH OTHER WORSE. The thing worth a bell did not ring, and the thing
 * that is not worth one rang every time, so even if it had rung nobody would have found it.
 *
 * THE RULE THIS FILE HOLDS: a notification is WORK THAT HAS BECOME YOURS. A ticket handed to you.
 * A workflow step that could not go out. Not a copy of a badge that already exists — the Mail
 * badge counts unread mail and the mailbox files each message on the record it matched, so a
 * notification per email was the same fact told three times, and the only one of the three that
 * could not be cleared by doing your own work.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-the-bell.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
/* Comments stripped: most of what follows is about what is ABSENT, and every one of these files
   explains at length what it no longer does. The trap this codebase has walked into three times. */
const code = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^[ \t]*\/\/.*$/gm, ' ')

const queries = code('src/lib/accountQueries.ts')
const sync = code('api/_lib/emailSync.ts')
const schema = read('supabase/schema.sql')

/* ---------------- a ticket handed to somebody tells them ---------------- */

ok('a ticket that becomes somebody else s rings their bell', /async function tellTheOwner/.test(queries))
ok('...through the one RPC that writes a notification',
  /rpc\('notify_user'[\s\S]{0,200}p_type: 'query\.assigned'/.test(queries))
/*
 * STRAIGHT TO THE TICKET. A link to the board makes the reader find it again among everybody
 * else's, which on a board that opens scoped to them is a second search for a thing they were
 * just told about.
 */
ok('...linking to the ticket itself', /p_link: `\/queries\/\$\{input\.queryId\}`/.test(queries))

/*
 * BOTH PLACES AN OWNER CAN CHANGE. Raising it is the common one; handing it on — a liaison passing
 * a request to the liaison manager — moved it off one board and onto another and told nobody.
 */
/*
 * EACH FUNCTION'S OWN BODY, SLICED. Written first as `/raiseQuery[\s\S]*?tellTheOwner/`, which has
 * an UNBOUNDED gap in the middle — so it matched from the name of one function all the way to the
 * OTHER function's call, and passed with the raise's own notification deleted. Found by deleting
 * it. A lazy quantifier is not a boundary.
 */
const bodyOf = (name) => {
  const at = queries.indexOf(`export async function ${name}(`)
  if (at < 0) return ''
  const next = queries.indexOf('\nexport ', at + 1)
  return queries.slice(at, next < 0 ? queries.length : next)
}
const raise = bodyOf('raiseQuery')
const update = bodyOf('updateQuery')
ok('both functions were found', raise.length > 500 && update.length > 500)
ok('it rings when the ticket is raised', /await tellTheOwner\(\{/.test(raise))
ok('...and when it is handed on', /await tellTheOwner\(\{/.test(update))
ok('...and only where the owner actually moved',
  /patch\.ownerId !== undefined && patch\.ownerId[\s\S]{0,160}tellTheOwner/.test(update))
/*
 * AND NOT ON EVERY OTHER EDIT. `updateQuery` also saves a chase date, a stage and a description,
 * and a bell on each of those is how a bell stops being read — which is the whole complaint this
 * file exists for, arriving from the other direction.
 */
ok('...but not when only a chase date or a sentence changed',
  /patch\.ownerId !== undefined/.test(update))

/*
 * NEVER YOUR OWN PRESS. A liaison raising a ticket and keeping it would otherwise ring their own
 * bell for something they had just done, which teaches people the bell is noise.
 */
ok('nobody is told about their own press',
  /if \(!owner \|\| owner === input\.actorId\) return/.test(queries))
/* AND NOBODY IS TOLD WHEN IT WAS GIVEN TO NOBODY. "Nobody yet — leave it unassigned" is an option
   on the box, and a notification to null is an error on the way out of saving a dispute. */
ok('...and an unassigned ticket rings nothing', /if \(!owner \|\|/.test(queries))

/*
 * AND THE BELL CANNOT FAIL THE THING IT IS ANNOUNCING. A ticket that saved and did not ring is a
 * small problem; a ticket that failed to save because a bell did not ring is a debtor's dispute
 * lost. Same reasoning handOutWrite applies to its own notices, and the same swallow.
 */
ok('a bell that will not ring never undoes the work',
  /try \{[\s\S]{0,400}rpc\('notify_user'[\s\S]{0,300}\} catch \{/.test(queries))

/* THE MESSAGE SAYS WHAT IS WANTED, not merely that something happened. "Proof of communication on
   Ofentse Thema from Vusi Maringa is waiting for you" is a sentence somebody can act on; "You have
   a new query" is one they have to open something to understand. */
ok('the message names what is being asked for', /input\.requestFor\?\.trim\(\)/.test(queries))
ok('...and who it is about', /input\.debtorName\?\.trim\(\)/.test(queries))
ok('...and who is waiting', /input\.raisedByName\?\.trim\(\)/.test(queries))

/* ---------------- and an email is not one ---------------- */

/*
 * THE ABSENCE THIS FILE IS REALLY FOR. Putting it back reads like a kindness — somebody should
 * know a reply came in — and it is the thing that made the bell unreadable. The Mail badge counts
 * it, the mailbox files it on the record, and the record's own activity list shows it.
 */
ok('an inbound email no longer rings the bell', !/type: 'Email received'/.test(sync))
ok('...and the sync writes no notification at all',
  !/from\('notifications'\)\.insert/.test(sync))
/* THE MAIL BADGE STILL COUNTS IT, which is the half that makes the removal honest rather than a
   loss. nav_counts reads unread, unsent, non-junk mail — asserted here because the argument for
   taking it out of the bell is that it is already counted. */
const navCounts = schema.slice(
  Math.max(schema.lastIndexOf('create or replace function public.nav_counts('),
    schema.lastIndexOf('create function public.nav_counts(')))
ok('the nav badge was found', navCounts.includes('user_emails'))
const mail = navCounts.slice(navCounts.indexOf('from public.user_emails'),
  navCounts.indexOf('from public.user_emails') + 220)
ok('...and mail is still counted on the Mail badge', /read_at is null/.test(mail))

/*
 * AND THE SYNC STILL FILES THE MESSAGE. Removing the notification must not have removed the thing
 * the notification was about: the email still lands on the lead, deal, company or contact it
 * matched, and the mailbox row is still marked as filed.
 */
ok('the message is still filed on the record it matched', /markUserEmailOnRecord\(admin, mailboxRowId, filed\)/.test(sync))

/* ---------------- what the bell is left carrying ---------------- */

/*
 * TWO KINDS, AND BOTH ARE WORK THAT HAS BECOME YOURS. Listed by name so a third arriving is a
 * decision somebody made rather than a line that crept in: anything inserted here is something a
 * person is now expected to do.
 */
const held = code('api/_lib/workflow/notify.ts')
ok('a workflow step that could not go out still rings', /type: 'workflow\.held'/.test(held))
ok('...and a ticket handed to you', /p_type: 'query\.assigned'/.test(queries))

console.log(`\ncheck-the-bell: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)

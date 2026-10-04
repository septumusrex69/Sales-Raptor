/**
 * A MAILBOX AT THE BACK OF THE QUEUE IS NEVER READ AT ALL.
 *
 * THE FIRM: "I responded to an email where I said I dispute the account... Now I've synced the
 * email address and the whole company. Still the email doesn't appear."
 *
 * IT WAS NOT THE MATCHING AND IT WAS NOT THE SEND. The reply quoted the Message-ID of a notice
 * Raptor had stored and came from an address on the account's own contact list, so `findAccount`
 * would have filed it twice over. Nothing had READ the mailbox. `samuel@` -- the address the
 * section 129 went out from and the one the debtor replied to -- carried
 * `last_sync_attempt_at = null`: the sweep had never once opened it, while four other mailboxes
 * were read the same morning.
 *
 * THE CAUSE IS TWO LINES THAT ARE FINE APART. sync-all read the connections with no ORDER BY, and
 * Postgres hands back an order that is arbitrary but stable in practice; the press then stops at
 * PRESS_BUDGET_MS and the cron stops at Vercel's duration cap. Whatever sits at the tail of that
 * stable order is cut off by EVERY run. It does not sync late -- it never syncs.
 *
 * OLDEST FIRST IS SELF-CORRECTING, which is why it is the rule rather than merely an improvement:
 * going unread is exactly what promotes a mailbox to the front, and being read demotes it. No
 * mailbox can starve however short the budget.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-sync-starvation.mjs
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
const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')

const syncAll = read('api/_lib/email/sync-all.ts')

/* ---------------------------------------------------------------------------------------------
 * THE QUEUE
 * ------------------------------------------------------------------------------------------- */

ok('the connections are read in an order, not whichever order the table gives',
  /\.order\('last_synced_at'/.test(syncAll))
ok('...oldest first', /ascending: true/.test(syncAll))
/* A MAILBOX NEVER SYNCED AT ALL IS THE MOST OVERDUE THING THERE IS, and a null sorts last by
   default in Postgres -- which would put exactly the mailbox this bug was found on at the back. */
ok('...and one that has never been synced leads', /nullsFirst: true/.test(syncAll))

/*
 * AND THE SELECT IS NOT LEFT BARE. Asserted as the pair rather than on the order alone, so
 * deleting the select and leaving the order (or the reverse) fails here rather than at four in
 * the morning on somebody's unread mailbox.
 */
ok('the order is on the connections query itself',
  /from\('email_connections'\)\.select\('\*'\)\s*\n\s*\.order\('last_synced_at'/.test(syncAll))

/* ---------------------------------------------------------------------------------------------
 * THE BUDGET IS STILL THERE, BECAUSE THE ORDER IS NOT A SUBSTITUTE FOR IT
 * ------------------------------------------------------------------------------------------- */

/*
 * Ordering decides WHICH mailboxes a short run reaches; the budget is what stops Vercel killing
 * the function partway and losing the answer. Both, or a press still dies silently.
 */
ok('a press still stops itself before the platform does', /PRESS_BUDGET_MS/.test(syncAll))
ok('...and the cron still runs unbudgeted', /if \(pressed && Date\.now\(\) - started > PRESS_BUDGET_MS\)/.test(syncAll))

/*
 * AND A MAILBOX IS OPENED ABOUT ONCE A CYCLE, which is the cost of running every few minutes.
 * Fifty mailboxes, eighteen folders each, every five minutes is fourteen thousand mailbox opens a
 * day against a mail server that counts them -- so one read by the person sitting in front of it,
 * or by the previous sweep, is passed over by the next. The skip used to be press-only, which was
 * right while the sweep ran once a night and is the opposite of right now.
 */
ok('the sweep skips a mailbox somebody just read', /const SWEEP_RECENT_MS = /.test(syncAll))
ok('...whoever read it', /const freshFor = pressed \? RECENT_MS : SWEEP_RECENT_MS/.test(syncAll))
/* SHORTER THAN THE CYCLE, or a run that starts a little late skips the whole round. */
const sweepRecent = Number((syncAll.match(/const SWEEP_RECENT_MS = (\d+) \* 60_000/) ?? [])[1])
ok('the sweep freshness window was found', Number.isFinite(sweepRecent) && sweepRecent > 0)

/* ---------------------------------------------------------------------------------------------
 * AND HOW OFTEN THE SWEEP ACTUALLY RUNS, WHICH IS THE OTHER HALF OF THE SAME COMPLAINT
 * ------------------------------------------------------------------------------------------- */

/*
 * THE FIRM, ON THE ORDERING FIX ABOVE: "there's still possibilities that the company's got 50
 * people, so in 60 seconds it doesn't sync anything -- or it syncs two people and the third person
 * is not synced. So you still have a loophole in your method."
 *
 * THEY WERE RIGHT AND IT WAS WORSE THAN THEY THOUGHT. Ordering makes the sweep fair; it says
 * nothing about how long a full circuit takes, and the circuit was a DAY: the cron was
 * `0 5 * * *`, once a night, with the function capped at sixty seconds. Fifty mailboxes at a few
 * seconds each is several runs' worth of work, so a mailbox at the back was read every few DAYS.
 * That is how long a debtor's reply could sit in the inbox of somebody who was not signed in.
 *
 * SO THE CADENCE IS PART OF THE RULE, and it is held here rather than left as a line in a config
 * file nobody reads. Minutes, not days -- the firm chose Vercel Pro for exactly this, which is
 * what lifts both the cron limit and the sixty-second cap.
 */
const vercel = JSON.parse(read('vercel.json'))
const sweep = (vercel.crons ?? []).find((c) => c.path === '/api/email/sync-all')
ok('the whole-company sweep is scheduled at all', !!sweep)
/* NOT ONCE A DAY. `0 5 * * *` ran at five in the morning and not again until the next, which is
   the loophole in as many characters. */
ok('...and not once a day', !/^\d+ \d+ \* \* \*$/.test(sweep?.schedule ?? ''))
/* EVERY FEW MINUTES, read off the step in the minute field so the assertion says what it means
   rather than matching one exact string. */
const everyMinutes = /^\*\/(\d+) \* \* \* \*$/.exec(sweep?.schedule ?? '')?.[1]
ok(`...but every few minutes (${sweep?.schedule})`,
  !!everyMinutes && Number(everyMinutes) <= 15)
/*
 * AND THE FUNCTION HAS ROOM TO GET ROUND EVERYBODY. Fifty mailboxes do not fit in sixty seconds,
 * and a sweep killed partway is the thing the budget above exists to avoid -- more time is what
 * turns "press again" into a job that finishes.
 */
const cap = vercel.functions?.['api/**/*.ts']?.maxDuration
ok(`...with room for fifty mailboxes in one run (${cap}s)`, Number(cap) >= 300)
/* AND THE SKIP WINDOW IS SHORTER THAN THE CYCLE, read off both rather than written down twice:
   equal or longer and a sweep that starts a few seconds late passes over every mailbox. */
ok(`...and the freshness window sits inside the cycle (${sweepRecent}m < ${everyMinutes}m?)`,
  Number.isFinite(sweepRecent) && sweepRecent < Number(everyMinutes))

/* ---------------------------------------------------------------------------------------------
 * AND IT SAYS WHICH ONES IT DID NOT REACH
 * ------------------------------------------------------------------------------------------- */

/*
 * A COUNT CANNOT BE ACTED ON. "2 left -- press again" is what the firm was told while the message
 * they were waiting for sat in a mailbox they could have named. The address is the actionable
 * half, and it is collected at the one place a mailbox is passed over for want of time.
 */
ok('the mailboxes the budget did not reach are collected', /const notReached: string\[\] = \[\]/.test(syncAll))
ok('...where the budget passes one over', /if \(conn\.email\) notReached\.push\(conn\.email\)/.test(syncAll))
ok('...and returned', /\n\s*notReached,\n/.test(syncAll))
/* EVERY RESULT CARRIES ITS ADDRESS TOO, which is what makes the cron's own log readable: a row of
   user ids says nothing to the person reading it at eight in the morning. */
const rows = syncAll.match(/results\.push\(\{ userId: conn\.user_id, email: conn\.email/g) ?? []
check('every per-mailbox result names its address', rows.length, 4)
ok('...and none is pushed without one', !/results\.push\(\{ userId: conn\.user_id,(?! email)/.test(syncAll))

const settings = read('src/pages/settings/SettingsPage.tsx')
ok('the button names the mailboxes it did not reach', /Not reached: \$\{missed\.join\(', '\)\}/.test(settings))
/* SILENT WHERE THERE IS NOTHING TO SAY. A run that finished must not append an empty sentence. */
ok('...and says nothing where it reached them all', /missed\.length > 0 \?/.test(settings))

/* ---------------------------------------------------------------------------------------------
 * THE MATCHING WAS NEVER THE PROBLEM, AND STILL IS NOT
 * ------------------------------------------------------------------------------------------- */

/*
 * HELD HERE BECAUSE THIS IS WHERE SOMEBODY WILL LOOK NEXT TIME A REPLY GOES MISSING. Two routes
 * find the account and the order between them is deliberate: the thread is a fact about the
 * message, the subject reference is something a person typed.
 */
const sync = read('api/_lib/emailSync.ts')
ok('a reply is matched on the thread it answers',
  /from\('account_emails'\)\s*\n\s*\.select\('account_id, query_id'\)\s*\n\s*\.eq\('message_id', id\)/.test(sync))
ok('...then on the sender being a contact on the account',
  /\.eq\('kind', 'email'\)\s*\n\s*\.ilike\('value', address\)/.test(sync))
/* LAST, AND DELIBERATELY SO: a typo in a subject line must not outrank the debtor's own address. */
ok('...and the subject reference comes last of the three',
  sync.indexOf('accountFromReference(admin, parsed.subject)') > sync.indexOf(".ilike('value', address)"))

console.log(`\ncheck-sync-starvation: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)

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

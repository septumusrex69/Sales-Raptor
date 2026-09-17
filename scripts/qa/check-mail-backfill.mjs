/**
 * Mail that was never fetched, and the counter that has to agree with the list.
 *
 * THE BUG THE FIRM FOUND, and they found it the only way anybody could — two messages they could
 * see in another mail client and not in Raptor: "I don't see it in my message ... I don't know why
 * it's not mentioned in my inbox."
 *
 * Because the sync only ever read FORWARD. `last_seen_uid` is a high-water mark and every run asks
 * the server for UIDs above it; the very first run took the most recent 25 messages and set the
 * mark at the top of them. Everything older was then unreachable for ever — not filtered, not
 * hidden, simply never fetched, and nothing on the screen said so. A mailbox that silently stops
 * at an invisible line is worse than one that is plainly empty.
 *
 * So: a low-water mark per folder, and a way to walk down from it. This file checks that the walk
 * goes the right way, that a forward run can never move the floor UP (which would strand a band of
 * messages between the two marks — the same bug with an extra step), and that it did not cost a
 * thirteenth serverless function, which Vercel Hobby does not have.
 *
 * Also here: bumpUnread, which is the one place in the mailbox that states a tab's membership
 * rules outside scope(). That is a real risk and it is taken deliberately — see its own note —
 * so the rules are exercised rather than read.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-mail-backfill.mjs
 */
import { readFileSync } from 'node:fs'
import { bumpUnread } from '../../src/lib/emailRules.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const sync = read('../../api/_lib/emailSync.ts')
const endpoint = read('../../api/email/sync.ts')
const schema = read('../../supabase/schema.sql')
const page = read('../../src/pages/mail/MailPage.tsx')

function slice(src, from, to, label) {
  const a = src.indexOf(from)
  if (a === -1) { failures.push(`${label}: could not find its opening anchor -- ${from}`); return '' }
  const b = src.indexOf(to, a + from.length)
  if (b === -1) { failures.push(`${label}: could not find its closing anchor -- ${to}`); return '' }
  return src.slice(a, b)
}

/* ---------- 1. the low-water mark exists and means something ---------- */

for (const col of ['oldest_seen_uid', 'oldest_seen_uid_junk', 'oldest_seen_uid_sent']) {
  ok(`${col} is on email_connections`,
    new RegExp(`add column if not exists ${col} integer`).test(schema))
}
/* Said in the database, because the next person to read this column will wonder why there are two. */
ok('the schema says what the mark is for', /how far back/i.test(schema))

/* ---------- 2. the walk goes DOWN ---------- */

const backfill = slice(sync, 'async function backfillMailbox', '\n/**', 'backfillMailbox')

/* Below the floor, which is the whole difference from syncMailbox. */
ok('it searches below the floor', /uid: `1:\$\{floor - 1\}`/.test(backfill))
/*
 * NEWEST OF THE OLDER ONES FIRST. Somebody pressing this is looking for a message they remember
 * receiving, and history is wanted most-recent-first — slice(0, n) would hand back the oldest mail
 * in the account and take several presses to reach anything they were thinking of.
 */
ok('...and takes the newest of them', /below\.slice\(-BACKFILL_MESSAGE_LIMIT\)/.test(backfill))
/*
 * A FLOOR IT DOES NOT KNOW IS READ BACK, NOT GUESSED. The mark is new and the mailbox was synced
 * before it existed, so the oldest row already stored IS the floor. Guessing 1 would re-fetch the
 * entire mailbox on the first press.
 */
ok('an unknown floor comes from what is already stored', /order\('uid', \{ ascending: true \}\)/.test(backfill))
ok('...rather than being assumed to be the bottom', !/floor = 1/.test(backfill))
/* Nothing below 1, and a folder with nothing in it wants a forward sync, not this. */
ok('it stops at the bottom', /if \(floor === null \|\| floor <= 1\) return/.test(backfill))
ok('...and says when there is no more', /done: true/.test(backfill))

/*
 * BLOCKED SENDERS ARE STILL BLOCKED. Reaching back through a year of mail is exactly when a
 * blocklist earns its keep, and a backfill that ignored it would hand somebody the 300 newsletters
 * they blocked last month.
 */
ok('a blocked sender is still skipped', /if \(isBlocked\(normaliseAddress\(fromAddress\), blocks\)\) continue/.test(backfill))
/* And a sender ruled to Open mail still lands there rather than in the working queue. */
ok('...and a sender ruled to Open mail still lands there', /noRecordNeeded: isBlocked\(normaliseAddress\(fromAddress\), senderRules\)/.test(backfill))

/*
 * WHAT IT DELIBERATELY DOES NOT DO. syncMailbox files messages onto debtor accounts and raises
 * Annexure B item 6 for receiving them. Replaying that over a year of history would bill debtors,
 * today, for mail that arrived months ago and was dealt with on paper.
 */
ok('it raises no fees', !/chargeItem|fileAccountEmail/.test(backfill))
ok('...and files nothing onto an account', !/markUserEmailLinked/.test(backfill))

/* ---------- 3. a forward run must never move the floor up ---------- */

const forward = slice(sync, 'const patch: Record<string, unknown>', 'return { logged: inboxResult', 'the watermark patch')
/*
 * ONLY WHERE IT IS NOT ALREADY KNOWN. A forward run reaching UID 900 must not move the floor up
 * from 400: that would strand everything between them, which is the same bug this mark exists to
 * fix, with an extra step.
 */
ok('the floor is only ever set once', /conn\.oldest_seen_uid == null && inboxResult\.minUid != null/.test(forward))
ok('...for junk as well', /conn\.oldest_seen_uid_junk == null/.test(forward))
ok('...and for sent', /conn\.oldest_seen_uid_sent == null/.test(forward))
/* And a run that fetched nothing has no floor to report, so it must not write one. */
ok('a run that fetched nothing reports no floor', /minUid = uids\.length > 0 \? Math\.min\(\.\.\.uids\) : null/.test(sync))

/* ---------- 4. no thirteenth serverless function ---------- */

/*
 * Vercel Hobby caps serverless functions at 12 and api/ is at exactly 12, so this is a flag on the
 * sync that already exists rather than an endpoint of its own.
 */
ok('the existing sync takes the direction', /const \{ older \} = \(req\.body \?\? \{\}\) as \{ older\?: boolean \}/.test(endpoint))
ok('...and passes it on', /syncConnection\(admin, conn as EmailConnectionRow, \{ older: !!older \}\)/.test(endpoint))
ok('...and reports whether there is more', /done: result\.done \?\? false/.test(endpoint))

/* The screen asks for it, and says which way it is reading. */
ok('the mailbox can ask for older mail', /body: JSON\.stringify\(\{ older: true \}\)/.test(page))
ok('...and says how much came back', /older \$\{got === 1 \? 'message' : 'messages'\} fetched/.test(page))
/*
 * AND SAYS WHEN THERE IS NO MORE. The one thing worse than mail you cannot reach is a button that
 * may or may not have done anything.
 */
ok('...and when there is nothing older left', /Nothing older/.test(page))
ok('...without leaving the button pressable for ever', /disabled=\{fetchingOlder \|\| noOlder\}/.test(page))

/* ---------- 5. bumpUnread agrees with the tabs ---------- */

/*
 * The badges are adjusted in the browser rather than re-counted, because re-counting meant a
 * reload and a reload threw the reader to the top of the list. That makes this the one place
 * outside scope() that states which tabs a message is on — so it is exercised, not read.
 */
const zero = { all: 0, 'needs-filing': 0, filed: 0, 'no-record': 0, junk: 0, sent: 0 }
const mail = (over) => ({
  isSent: false, isJunk: false, isFiled: false, isSettled: false, noRecordAt: null, ...over,
})

/* An ordinary unmatched message: in the mailbox, and in the work queue. */
const plain = bumpUnread(zero, mail({}), 1)
check('an unmatched message counts on All', plain.all, 1)
check('...and on Needs matching', plain['needs-filing'], 1)
check('...and nowhere else', plain.junk + plain.filed + plain['no-record'] + plain.sent, 0)

/*
 * JUNK IS NOT IN ALL, at the firm's instruction: "normal mailbox goes to all, junk still goes to
 * junk, junk doesn't go to all." A badge that put junk on All would have the working list claiming
 * work it does not contain.
 */
const junk = bumpUnread(zero, mail({ isJunk: true }), 1)
check('junk counts on Junk', junk.junk, 1)
check('...and not on All', junk.all, 0)
check('...nor on Needs matching', junk['needs-filing'], 0)

/* Sent mail is its own tab and no other: it is not waiting to be matched and it is not junk. */
const sent = bumpUnread(zero, mail({ isSent: true, isFiled: false }), 1)
check('sent mail counts on Sent', sent.sent, 1)
check('...and on nothing else', sent.all + sent['needs-filing'] + sent.junk, 0)

/* Matched mail is still in the mailbox, and is no longer waiting. */
const filed = bumpUnread(zero, mail({ isFiled: true, isSettled: true }), 1)
check('matched mail counts on Matched', filed.filed, 1)
check('...and on All, because it is still in the mailbox', filed.all, 1)
check('...but not on Needs matching', filed['needs-filing'], 0)

/* Open mail has been dealt with deliberately, so it is settled and out of the queue. */
const open = bumpUnread(zero, mail({ isSettled: true, noRecordAt: '2026-09-01T00:00:00Z' }), 1)
check('open mail counts on Open mail', open['no-record'], 1)
check('...and on All', open.all, 1)
check('...and not in the queue', open['needs-filing'], 0)

/* It goes down as well as up, and never below nothing — a count of -1 is a badge reading "-1". */
const down = bumpUnread({ ...zero, all: 1, 'needs-filing': 1 }, mail({}), -1)
check('reading one takes it off All', down.all, 0)
check('...and off Needs matching', down['needs-filing'], 0)
check('and nothing goes below zero', bumpUnread(zero, mail({}), -1).all, 0)

/* The original is left alone: React state that is mutated in place does not re-render. */
const before = { ...zero }
bumpUnread(before, mail({}), 1)
check('the counts it was given are not mutated', before.all, 0)

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
Mail older than the first sync can be reached instead of being invisible, a forward run cannot
strand a band of messages behind it, no thirteenth serverless function was needed, and the tab
badges move the same way the tabs themselves do.`)

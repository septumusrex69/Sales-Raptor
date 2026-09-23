/**
 * The folders the sync could not see, and the counter that has to agree with the list.
 *
 * THE BUG THE FIRM FOUND, and they found it the only way anybody could -- two messages that were
 * in their mail client and not in Raptor.
 *
 * My first answer was wrong: I said the sync only ever read forward and those messages predated
 * the first run. They pointed out the mail had arrived that afternoon, and they were right -- my
 * query had run three hours before it existed. The sync's own log gave the real answer. That
 * server has EIGHTEEN folders and the sync read three of them, so anything a server-side rule or
 * another mail client filed into Archive, Blocked or "Spam Emails 2" was invisible here,
 * permanently, with nothing on screen saying so. A mailbox that stops at an invisible line is
 * worse than one that is plainly empty: the empty one looks broken, and this looked complete.
 *
 * This file checks which folders are read, that reading one for the first time files history
 * without billing anybody for it, and that one unreadable folder cannot cost the run.
 *
 * ("Fetch older mail" was built for my wrong answer and removed at the firm's request -- "a
 * nightmare importing thousands of messages from years ago until now." Its checks went with it.)
 *
 * Also here: bumpUnread, which is the one place in the mailbox that states a tab's membership
 * rules outside scope(). That is a real risk and it is taken deliberately -- see its own note --
 * so the rules are exercised rather than read.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-mail-folders.mjs
 */
import { readFileSync } from 'node:fs'
import { bumpUnread } from '../../src/lib/emailRules.ts'
import { looksLikeJunk, otherFolders } from '../../api/_lib/emailSync.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const sync = read('../../api/_lib/emailSync.ts')
const endpoint = read('../../api/_lib/email/sync.ts')
const schema = read('../../supabase/schema.sql')
const page = read('../../src/pages/mail/MailPage.tsx')

function slice(src, from, to, label) {
  const a = src.indexOf(from)
  if (a === -1) { failures.push(`${label}: could not find its opening anchor -- ${from}`); return '' }
  const b = src.indexOf(to, a + from.length)
  if (b === -1) { failures.push(`${label}: could not find its closing anchor -- ${to}`); return '' }
  return src.slice(a, b)
}

/* ---------- 1. no trace of the backfill is left behind ---------- */

/*
 * REMOVED, NOT HIDDEN. A button taken off the screen while its endpoint, its column and its
 * five hundred lines of fetching stay behind is how a codebase acquires a feature nobody can
 * find and nobody dares delete. The firm asked for it gone; it is gone.
 */
ok('the sync has no backfill in it', !/backfillMailbox|BACKFILL_MESSAGE_LIMIT/.test(sync))
ok('...and no low-water marks to drive one', !/oldest_seen_uid/.test(sync))
/*
 * NO INPUT AT ALL, which is the real guard. This read `!/older/` -- the word anywhere in the file
 * -- and an ordinary comment about a stale sync claim tripped it. What must stay true is that the
 * sync endpoint takes no request body: a direction, a window or a message count would all have to
 * arrive through one, and the backfill is what that would grow back into.
 */
ok('the endpoint takes no request body at all', !/req\.body/.test(endpoint))
ok('...and no direction to fetch in', !/\bdirection\b|fetchOlder|backfill/i.test(endpoint))
ok('the mailbox does not ask for older mail', !/Fetch older mail/.test(page))
/* And the columns went with the code, rather than sitting unused for somebody to wonder about. */
ok('the columns are dropped', /drop column if exists oldest_seen_uid,/.test(schema))

/* ---------- 4. bumpUnread agrees with the tabs ---------- */

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

/* ---------- 2. the folders the sync could not see ---------- */

/*
 * THE BUG THE FIRM FOUND, AND MY FIRST ANSWER TO IT WAS WRONG.
 *
 * They reported two messages that were in their mail client and not in Raptor. I said the sync had
 * only ever read forward and those messages predated the first run. They then pointed out the mail
 * had arrived that afternoon — and they were right. My query had run three hours before it.
 *
 * The sync's own log gave the real answer. That server has EIGHTEEN folders and the sync read
 * three. Anything a server-side rule or another mail client filed into Archive, Blocked or one of
 * the "Spam Emails" folders was invisible here, permanently, with nothing on screen saying so.
 *
 * The list below is the real one out of that log, which is why it is ugly.
 */
const REAL_FOLDERS = [
  'INBOX', 'INBOX.Sent', 'INBOX.Drafts', 'INBOX.Archive', 'INBOX.spambucket', 'INBOX.Trash',
  'INBOX.Archive.Deleted Items', 'INBOX.Blocked', 'INBOX.Sent.Trash', 'INBOX.Sent Items',
  'INBOX.Spam Emails', 'INBOX.Spam Emails 1', 'INBOX.Spam Emails 2', 'INBOX.Spam Emails 3',
  'INBOX.Trash.Untitled Folder', 'INBOX.Trash.Untitled Folder 1',
  'INBOX.Trash.Untitled Folder 1 1', 'INBOX.Trash.Untitled Folder 2',
]

const rest = otherFolders(REAL_FOLDERS, ['INBOX.spambucket', 'INBOX.Sent'])

/* The ones that were being missed, and the reason the firm could not find their mail. */
for (const wanted of ['INBOX.Archive', 'INBOX.Blocked', 'INBOX.Spam Emails', 'INBOX.Spam Emails 3',
  'INBOX.Sent Items']) {
  ok(`${wanted} is read now`, rest.includes(wanted))
}

/*
 * TRASH IS NOT. Deleted mail is deleted, and pulling it into a working queue would put everything
 * somebody has already thrown away back in front of them.
 */
for (const skipped of ['INBOX.Trash', 'INBOX.Trash.Untitled Folder', 'INBOX.Trash.Untitled Folder 1 1']) {
  ok(`${skipped} is left alone`, !rest.includes(skipped))
}
/*
 * AND NEITHER IS "Archive.Deleted Items" -- a nested folder that contains the word "Archive" and
 * is deleted mail. The pattern's leading (^|\.) matches the separator, so this falls out of the
 * whole-path test without a second one on the last segment.
 */
ok('deleted mail under an archive is still deleted mail', !rest.includes('INBOX.Archive.Deleted Items'))
/* A draft is half-written and never sent. It is not correspondence with anybody. */
ok('drafts are left alone', !rest.includes('INBOX.Drafts'))
/* And the three already handled by name are not read a second time. */
ok('the inbox is not read twice', !rest.includes('INBOX'))
ok('...nor the junk folder', !rest.includes('INBOX.spambucket'))
ok('...nor the sent folder', !rest.includes('INBOX.Sent'))
/* Case is the server's business, not ours. */
ok('a differently-cased path still counts as handled',
  !otherFolders(['INBOX.SENT'], ['INBOX.Sent']).includes('INBOX.SENT'))

/*
 * SPAM BY NAME, because a server has exactly one \\Junk special-use folder and this mailbox has
 * five things that are plainly spam. It only changes how the row is labelled -- the message is
 * still fetched and still visible, which is the whole point of reading these folders.
 */
ok('"Spam Emails 2" is treated as junk', looksLikeJunk('INBOX.Spam Emails 2'))
ok('...and Blocked with it', looksLikeJunk('INBOX.Blocked'))
ok('...but an archive is not junk', !looksLikeJunk('INBOX.Archive'))
ok('...nor is "Sent Items"', !looksLikeJunk('INBOX.Sent Items'))

/* ---------- 3. and reading them must not bill anybody ---------- */

/*
 * A FOLDER'S FIRST READ IS HISTORY, NOT POST. Fifteen folders came into view at once, and running
 * a year of old mail through the ordinary path would raise Annexure B item 6 -- today -- against
 * debtors for correspondence dealt with months ago.
 */
ok('a first read files the row and stops', /if \(isSent \|\| firstRead\) \{/.test(sync))
ok('...and the folder loop says which reads are first', /known == null,\s*\n\s*\)/.test(sync))

/*
 * ONE NEW FOLDER PER RUN. Reading a folder for the first time fetches and parses every message in
 * its window; fifteen of those in one serverless request is a timeout, which saves no watermark
 * and does the whole thing again next run, for ever.
 */
ok('the backlog is worked off one folder at a time', /let firstReadsLeft = 1/.test(sync))
ok('...and a known folder is never held back by that', /if \(known == null && firstReadsLeft <= 0\) continue/.test(sync))

/*
 * ONE UNREADABLE FOLDER MUST NOT COST THE RUN. A server can refuse a SELECT on a folder that
 * exists, and throwing there would lose the watermarks of every folder already read -- including
 * the INBOX, which would then re-read its window on the next run.
 */
ok('a folder that will not open is skipped, not fatal', /\$\{path\}: skipped --/.test(sync))
/* And every mark is written in ONE update, or a failure between two writes strands one of them. */
ok('the watermarks are saved together', /patch\.folder_uids = marks/.test(sync))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
Every folder on the server is read rather than three of them, Trash and Drafts are left alone, a
folder's first read files history without billing anybody for it, one unreadable folder cannot cost
the run, and the tab badges move the same way the tabs themselves do.`)

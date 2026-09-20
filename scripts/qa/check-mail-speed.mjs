/**
 * The three places the mailbox was waiting on itself.
 *
 * FOUND IN THE RUNTIME LOGS, NOT BY READING THE CODE, which is why each one is pinned here: none
 * of them is a bug you would notice in a diff, and all three read as ordinary sensible code.
 * The firm: "If I want to send a mail, it just like loads and loads and loads and then send. If I
 * click on a mail, it loads and loads and loads and loads and then just then opens."
 *
 *   1. THREE SYNCS AT ONCE. Three identical POSTs to /api/email/sync landed in the same second —
 *      the mail screen, the messages menu and the cron — each opening its own IMAP connection and
 *      walking eighteen folders down one mailbox. Mail servers cap concurrent connections per
 *      account, so they queued, and everything else the person did queued behind them.
 *   2. ONE MESSAGE FETCHED FIVE TIMES. Opening a message pulls its body from the mailbox, and the
 *      only guard was on fetches that had already come back. Clicking again because nothing had
 *      happened yet fired another. Impatience made it slower, which is the worst possible shape.
 *   3. FIVE WAITS BEFORE A MESSAGE WENT OUT. Two database lookups one after the other, then the
 *      signature image, then SMTP, then a whole second IMAP connection for the Sent copy.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-mail-speed.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
function check(name, actual, expected) {
  if (Object.is(actual, expected)) { pass += 1; return }
  failures.push(`${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`)
}
const ok = (name, actual) => check(name, actual, true)

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const sync = read('../../api/email/sync.ts')
const syncAll = read('../../api/email/sync-all.ts')
const lib = read('../../api/_lib/emailSync.ts')
const send = read('../../api/email/send.ts')
const page = read('../../src/pages/mail/MailPage.tsx')
const schema = read('../../supabase/schema.sql')

/* ---------- 1. one sync per mailbox at a time ---------- */

ok('there is somewhere to record that a sync is running',
  /sync_started_at timestamptz/.test(schema))

/*
 * ONE CLAIM, SHARED BY BOTH CALLERS. Written twice they drift — the cron grows its own idea of
 * how long a stale claim lives — and the two stop excluding each other on exactly the mailbox
 * that is busiest. The same rule as applyAccountFilters.
 */
ok('the claim lives in one place', /export async function claimSync/.test(lib))
ok('...and it is released in one place', /export async function releaseSync/.test(lib))
ok('the on-demand sync claims before it opens the mailbox', /await claimSync\(admin, caller\.id\)/.test(sync))
ok('...and the cron does too', /await claimSync\(admin, conn\.user_id\)/.test(syncAll))
ok('the on-demand sync releases when it is done', /await releaseSync\(admin, caller\.id\)/.test(sync))
ok('...and the cron does too', /await releaseSync\(admin, conn\.user_id\)/.test(syncAll))

/*
 * CLAIMED BEFORE THE WORK, or two requests both read "nobody is syncing" and both start. The
 * claim is the conditional UPDATE itself, which is atomic; a read-then-write would not be.
 */
const claim = lib.slice(lib.indexOf('export async function claimSync'), lib.indexOf('export async function releaseSync'))
ok('the claim function exists to read', claim.length > 200)
ok('the claim is an update, not a read then a write', /\.update\(\{ sync_started_at/.test(claim))
ok('...conditional on nobody else holding it', /sync_started_at\.is\.null,sync_started_at\.lt\./.test(claim))
ok('...and it reports whether it got it', /return Boolean\(data\)/.test(claim))

/*
 * A STALE CLAIM IS TAKEN, NOT WAITED ON FOR EVER. A function killed mid-sync never releases, and
 * a mailbox that could never be synced again is a far worse bug than a duplicated connection.
 */
ok('a stale claim expires', /SYNC_CLAIM_SECONDS = \d+/.test(lib))
const seconds = Number(/SYNC_CLAIM_SECONDS = (\d+)/.exec(lib)?.[1])
ok(`...within a minute or two, not an hour (${seconds}s)`, seconds > 0 && seconds <= 300)

/*
 * A SKIPPED SYNC IS NOT AN ERROR. Somebody else asked for the same mailbox a moment ago and the
 * answer is already on its way; the caller reloads its list either way. Reported as a failure it
 * would put a red banner over a mailbox where nothing is wrong.
 */
ok('being second in the queue is not an error', /alreadyRunning: true/.test(sync))
/*
 * BOUNDED BY ITS OWN CLOSING BRACE, not by a character count.
 *
 * This read `+ 500` and the block ends 358 characters in, so the window ran 142 characters into
 * the `try` that follows -- whose SUCCESS path has its own res.status(200). Changing the skip
 * branch to answer 503 left this passing, which is exactly the red banner over a healthy mailbox
 * that the comment above says it exists to prevent. The next section of this file already bounds
 * its slice this way and says why; this one had been left as a guess.
 */
const skipAt = sync.indexOf('if (!claimed)')
const skip = sync.slice(skipAt, sync.indexOf('\n  }', skipAt))
ok(`...and it answers 200 (${skip.length} chars, not a fixed window)`,
  /res\.status\(200\)/.test(skip))
/* And it is not reported as a failure, which is the thing that would surface as the banner. */
ok('...rather than an error status', !/res\.status\((4|5)\d\d\)/.test(skip))

/* ---------- 2. one body fetch per message ---------- */

/*
 * THE FUNCTION, BOUNDED BY ITS OWN CLOSING BRACE — not by a character count.
 *
 * This read 2 500 characters from the top of toggleTo, and the day the function grew by one
 * setState the window stopped reaching the `finally` block. The check then reported that the
 * in-flight mark is never cleared, which was not true of the code at any point: it was true of
 * the slice. A count of characters is a guess about how long a function is allowed to be, and it
 * fails as a false alarm, which is the worst way for a check to fail.
 *
 * `\n  }` at two spaces of indentation is this file's function-level closing brace; everything
 * inside toggleTo closes at four or more.
 */
const toggleAt = page.indexOf('async function toggleTo(')
const toggle = page.slice(toggleAt, page.indexOf('\n  }\n', toggleAt) + 4)
ok('the open handler exists to read', toggle.length > 500)
ok('a body already in hand is not fetched again', /if \(bodies\[mail\.id\] !== undefined\) return/.test(toggle))
/*
 * AND ONE ALREADY IN FLIGHT IS NOT EITHER. This is the half that was missing: the line above only
 * knows about fetches that have come back, so a second click during a slow fetch started a second
 * identical one. The logs showed five for one message inside five seconds.
 */
ok('...nor is one already on its way', /if \(fetchingBody\.current\.has\(mail\.id\)\) return/.test(toggle))
/*
 * PRESENCE BEFORE ORDER, and this is the second time this codebase has been bitten by it.
 * `indexOf` returns -1 when the thing is absent, and -1 is less than every real position — so an
 * order-only assertion passes vacuously the moment the guard it orders is deleted. Found by
 * break-testing this very line: removing the mark left the check green.
 */
ok('the message is marked as being fetched', toggle.includes('fetchingBody.current.add(mail.id)'))
ok('...before the await, not after',
  toggle.indexOf('fetchingBody.current.add') < toggle.indexOf('await fetchMailBody'))
ok('...and cleared however it ends', /finally \{\s*\n\s*fetchingBody\.current\.delete\(mail\.id\)/.test(toggle))
/*
 * A REF, NOT STATE. State is true after the next render; the second click lands inside exactly
 * that window, which is the whole reason this bug exists.
 */
ok('the guard is a ref, so it is true at once', /const fetchingBody = useRef<Set<string>>/.test(page))

/* ---------- 3. the send does its waiting in parallel ---------- */

ok('the two lookups happen at once', /const \[\{ data: conn \}, \{ data: profile \}\] = await Promise\.all\(/.test(send))

/*
 * THE SENT FOLDER IS OPENED WHILE THE MESSAGE IS GOING OUT. Connecting, negotiating TLS, logging
 * in and listing mailboxes is four round trips to a server in another country, and done after the
 * send it is time the person watching the spinner pays for twice.
 */
ok('the Sent connection is opened before the send', /const appenderSoon = openSentAppender\(/.test(send))
ok('...and it is a split connect-then-append', /export async function openSentAppender/.test(lib))
/* Presence before order, for the same reason as above. */
ok('SMTP is still what sends the message', send.includes('transporter.sendMail'))
ok('...started before SMTP, not after',
  send.indexOf('const appenderSoon') < send.indexOf('transporter.sendMail'))
/*
 * BUT THE BYTES ONLY GO IN AFTER SMTP HAS CONFIRMED. A message filed in Sent that then failed to
 * send is a message somebody believes they have sent.
 */
ok('the copy is filed at all', send.includes('appender.append(raw)'))
ok('...only once the message has gone',
  send.indexOf('transporter.sendMail') < send.indexOf('appender.append(raw)'))
/*
 * AND THE CONNECTION IS CLOSED WHEN THE SEND FAILS. Left open it holds one of the mailbox's few
 * concurrent slots until it times out — the exact contention this file exists to remove.
 */
ok('a failed send does not leak the connection',
  /void appenderSoon\.then\(\(a\) => a\?\.close\(\)\)/.test(send))
ok('...and a successful one closes it too', /finally \{ await appender\.close\(\) \}/.test(send))

/* Opening a message is still one IMAP round trip and always will be — the snippet is all Raptor
   stores. What must not come back is a second route doing the same thing. */
ok('reading a message still rides on the existing route',
  /\/api\/email\/attachment/.test(read('../../src/lib/userMail.ts')))

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n`)
  for (const f of failures) console.log('  ✗ ' + f + '\n')
  process.exit(1)
}
console.log(`${pass} passed, 0 failed`)
console.log(`
One sync per mailbox rather than three, one fetch per message however many times it is clicked,
and a send that opens its Sent folder while the message is already on its way.`)

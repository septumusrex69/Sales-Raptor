/**
 * THE WIRE THE WORKFLOW ACTUALLY SENDS DOWN.
 *
 * `planSend` decides whether a due step may go; this is everything between that decision and a
 * debtor's inbox, and none of it can be exercised in a browser check -- there is no mailbox, no
 * provider and no cron in a test. So what is held here is the shape: that the route exists, that
 * it is on a timer, that the deployment can still be deployed, and that the handful of decisions
 * which are easy to get silently wrong are the ones that were made.
 *
 * WHAT THIS GUARDS, and every one of them is a live-site failure rather than a wrong number:
 *
 *   - THE TWELVE-FUNCTION CEILING. Vercel's Hobby plan refuses the whole deployment, not the new
 *     route. `api/` sat at exactly twelve with seven of them email files; the runner had nowhere
 *     to live until those collapsed into one dispatcher.
 *   - TWO SENDERS. The runner sends the same templates through the same mailboxes with nobody
 *     watching, so it and the compose box must be one path. Written twice, the copy that drifts
 *     is the unattended one, and the firm finds out from a debtor.
 *   - THE FEE AFTER THE PROVIDER, never before. A fee for a message that never left is a charge
 *     the firm cannot justify; a message with no fee is a bookkeeping gap.
 *   - THE FIRM'S TODAY. The function runs in Paris and the firm is in Johannesburg.
 *   - AND A CRON SECRET, because /api/workflow/run sends statutory demands to real people.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-workflow-transport.mjs
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'
import { todayInJohannesburg, moneyZa } from '../../api/_lib/workflow/locale.ts'

let pass = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
/**
 * A file's contents, or '' where it is not there.
 *
 * DEFENSIVE BECAUSE ABSENCE IS ONE OF THE THINGS THIS CHECKS. Breaking "the email handlers are
 * behind a dispatcher" means deleting the dispatcher, and readFileSync then threw ENOENT before
 * any assertion ran -- so the break-test produced a stack trace instead of a failure. A missing
 * file must fail the assertion that wanted it, not the whole check.
 */
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')

/* ------------------------------------------------ the deployment still fits */

/**
 * What Vercel deploys as a function: every .ts under api/ EXCEPT api/_lib, which it never does.
 * That exemption is the whole trick behind the three dispatchers.
 */
function deployedFunctions(dir = 'api', out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (path.basename(full) !== '_lib') deployedFunctions(full, out)
    } else if (entry.endsWith('.ts')) out.push(full)
  }
  return out
}
const functions = deployedFunctions()
ok(`the deployment is inside Vercel's Hobby ceiling (${functions.length} of 12)`, functions.length <= 12)
/* Asserted PRESENT before anything about the count, or deleting every route would pass this. */
ok('...and the runner is one of them', functions.includes(path.join('api', 'workflow', '[action].ts')))
/*
 * THE SEVEN EMAIL FILES ARE ONE. They were seven of the twelve, which is why there was no room.
 * Asserted as "the handlers are not deployed" rather than by counting, because a count passes
 * again the moment somebody adds a file somewhere else and removes one here.
 */
ok('the email handlers are behind a dispatcher, not seven functions',
  existsSync(path.join('api', 'email', '[action].ts'))
  && !existsSync(path.join('api', 'email', 'send.ts')))
ok('...and they still live somewhere', existsSync(path.join('api', '_lib', 'email', 'send.ts')))

/* ------------------------------------------------ every URL still answers */

const emailDispatcher = read('api/email/[action].ts')
/*
 * EVERY HANDLER IS ROUTED. A file moved under _lib and then left out of the table is a URL that
 * answers 404 on a site that was working -- and nothing else would notice, because the file is
 * still there and still compiles.
 */
const emailHandlers = existsSync('api/_lib/email')
  ? readdirSync('api/_lib/email').filter((f) => f.endsWith('.ts'))
  : []
ok('the email handlers are somewhere to be routed', emailHandlers.length > 0)
for (const f of emailHandlers) {
  const action = f.replace(/\.ts$/, '')
  if (action === 'sendAsUser') continue // not a route; the sender the routes share
  ok(`/api/email/${action} is still routed`,
    new RegExp(`(^|[\\s{,])'?${action.replace('-', '\\-')}'?\\s*[,:]`, 'm').test(emailDispatcher))
}
/*
 * AND THE CRON'S OWN URL SURVIVED THE MOVE. vercel.json calls /api/email/sync-all; the hyphen is
 * part of the action, so the key has to be the quoted string 'sync-all' and not the identifier
 * syncAll. Get that wrong and the nightly mail sync silently 404s for ever.
 */
ok("the mail sync's hyphenated action is quoted, not camel-cased",
  /'sync-all':\s*syncAll/.test(emailDispatcher))

const vercel = JSON.parse(read('vercel.json'))
const paths = (vercel.crons ?? []).map((c) => c.path)
ok('the mail sync is still on a timer', paths.includes('/api/email/sync-all'))
ok('the workflow runner is on a timer at all', paths.includes('/api/workflow/run'))
/* Every cron path must be one the dispatchers actually answer, or it 404s once a day in silence. */
for (const p of paths) {
  const [, , group, action] = p.split('/')
  ok(`${p} points at a route that exists`,
    existsSync(path.join('api', group, '[action].ts')) && Boolean(action))
}
/*
 * ONCE A DAY, AND AFTER THE MAIL SYNC. Every step is dated to a DAY, so nothing in the firm's
 * sequence is finer than daily. Running before the sync would decide the morning's sends against
 * yesterday's inbox -- and a debtor's reply is one of the things that takes an account out of a
 * workflow.
 */
const runCron = (vercel.crons ?? []).find((c) => c.path === '/api/workflow/run')
const syncCron = (vercel.crons ?? []).find((c) => c.path === '/api/email/sync-all')
ok('...daily, not on a tighter loop', /^0 \d+ \* \* \*$/.test(runCron?.schedule ?? ''))
/*
 * READ DEFENSIVELY. Written as `Number(runCron.schedule.split(' ')[1])`, removing the cron threw
 * a TypeError two lines BELOW the check that should have reported it -- so the break-test for
 * "the runner is on a timer" produced a stack trace instead of a failure, and a check that
 * crashes is a check nobody can read. CLAUDE.md names this exact trap.
 */
const hourOf = (cron) => {
  const field = cron?.schedule?.split(' ')[1]
  return field === undefined ? null : Number(field)
}
ok('...and after the mail has come in',
  hourOf(runCron) !== null && hourOf(syncCron) !== null && hourOf(runCron) > hourOf(syncCron))

/* ------------------------------------------------ one sender, not two */

const runner = read('api/_lib/workflow/run.ts')
const sender = read('api/_lib/email/sendAsUser.ts')
const route = read('api/_lib/email/send.ts')

ok('the shared sender exists', /export async function sendAsUser/.test(sender))
ok('the compose box sends through it', /sendAsUser\(admin, caller\.id,/.test(route))
ok('...and so does the runner, unattended', /sendAsUser\(admin, collector!?\.id,/.test(runner))
/*
 * AND NEITHER BUILDS ITS OWN TRANSPORT. Two nodemailer calls is two senders however they are
 * named -- a signature block, a Sent copy or the firm's font added to one and not the other is
 * the drift this exists to prevent.
 */
check('nodemailer is reached from exactly one place',
  [runner, route, sender].filter((f) => /createTransport/.test(f)).length, 1)

/* The runner is the one that has to choose a mailbox, and the choice is the collector's. */
ok('the runner sends from the collector the account is assigned to',
  /assigned_to/.test(runner) && /collector/.test(runner))
ok('...and holds rather than sending from somebody else’s name',
  /no mailbox for the notice to go out from/.test(runner))

/* ------------------------------------------------ the order money happens in */

/*
 * THE FEE COMES AFTER THE SEND. api/_lib/sms/send.ts says why: a fee for a message that never
 * left is worse than a message with no fee. Asserted as an ORDER, and both halves are asserted
 * PRESENT first -- indexOf returns -1, so an order-only test passes vacuously the moment the
 * thing it orders is deleted.
 */
const feeAt = runner.indexOf("from('account_fees').insert")
const sendAt = runner.indexOf('sendAsUser(admin,')
const smsAt = runner.indexOf('await sendSms(')
ok('a fee is raised at all', feeAt > 0)
ok('...and something is actually sent', sendAt > 0 && smsAt > 0)
ok('the fee is raised after the email has gone', feeAt > sendAt)
ok('...and after the SMS has gone', feeAt > smsAt)
/*
 * PRICED ON THE ACTION, NOT ON THE CRON. `incurred_at` carries the moment the step was sent, and
 * planSend priced the charge on the step's own due date. A fee stamped with whenever the runner
 * happened to wake would eventually be priced on one schedule and dated into another.
 */
ok('the fee is stamped with the action, not with the run', /incurred_at: sentAt/.test(runner))
/* segments is NOT NULL with a default, and an explicit null overrides a default. Probed against
   staging: the email fee insert was refused outright. */
ok('an email fee omits segments rather than passing null',
  /plan\.charge\.segments === null \? \{\} : \{ segments/.test(runner))

/* ------------------------------------------------ the firm's day */

check('today is read in the firm’s timezone, not the server’s',
  todayInJohannesburg(new Date('2026-09-23T23:30:00Z')), '2026-09-24')
/* The same instant is still the 23rd in Paris, where the function runs. If these ever agree the
   timezone stopped being applied. */
ok('...which differs from the server’s own day at the boundary',
  todayInJohannesburg(new Date('2026-09-23T23:30:00Z'))
  !== new Date('2026-09-23T23:30:00Z').toISOString().slice(0, 10))
ok('the runner uses it rather than a clock', /todayInJohannesburg\(\)/.test(runner))
ok('...and never reads the date off the server',
  !/new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/.test(runner))

/* en-ZA groups thousands with a non-breaking space. That is the point on a letter and it costs
   money in an SMS, which is planSend's business and not this one's. */
ok('money is written the way the rest of Raptor writes it', /^R/.test(moneyZa(1000)))
ok('...grouped with the non-breaking space en-ZA uses', / /.test(moneyZa(180000)))

/* ------------------------------------------------ what the route will not do */

const dispatcher = read('api/workflow/[action].ts')
ok('the runner is behind a cron secret', /CRON_SECRET/.test(runner))
ok('...checked against the Authorization header', /Bearer \$\{cronSecret\}/.test(runner))
/*
 * A BARE LOOKUP ON A ROUTE TABLE FINDS Object.prototype. `?action=constructor` would otherwise
 * resolve to a function and be called with a request and a response.
 */
for (const [name, src] of [['workflow', dispatcher], ['email', emailDispatcher]]) {
  ok(`the ${name} dispatcher cannot be walked onto Object.prototype`,
    /hasOwnProperty\.call\(ROUTES, action\)/.test(src))
}

/*
 * A STEP THAT CANNOT GO IS HELD, NOT FAILED, AND NOT RETRIED BLINDLY. Held is "waiting on a
 * person" and is what every planSend refusal produces; failed is "the provider refused", which
 * is not something a collector fixes by filling in a field.
 */
ok('a refusal from planSend holds the step', /state: 'held', note/.test(runner))
ok('...with the reason planSend gave, in the firm’s words', /hold\(plan\.note/.test(runner))
ok('a provider refusal fails it instead', /state: 'failed'/.test(runner))
/*
 * AND ONE BAD ROW DOES NOT STOP THE MORNING. Two hundred accounts are worked in one pass; an
 * unreadable one must not cost the other hundred and ninety-nine their notices.
 */
ok('one step throwing does not stop the run', /for \(const step of steps\)[\s\S]{0,200}?try \{/.test(runner))

/* ------------------------------------------------ one merge assembly */

const shared = read('src/lib/accountMergeValues.ts')
const page = read('src/pages/accounts/AccountDetail.tsx')
ok('the merge values are assembled in one place', /export function accountMergeValues/.test(shared))
ok('the account screen uses it', /accountMergeValues\(\{/.test(page))
ok('...and so does the runner', /accountMergeValues\(\{/.test(runner))
/* The assembly moved out of the page; a second copy there is the drift this prevents. */
ok('the page no longer assembles its own', !/mergeValuesFor\(\{/.test(page))
/*
 * NULLS DROPPED, NEVER BLANKED. renderTemplate treats a missing key and an empty string
 * differently, and only the first leaves "{{respond_by}}" standing where planSend can see it. An
 * empty string would make an unanswerable notice sendable.
 */
ok('a value nothing can fill is dropped rather than blanked',
  /entry\[1\] !== null/.test(shared))

/* ------------------------------------------------ */

for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-workflow-transport: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)

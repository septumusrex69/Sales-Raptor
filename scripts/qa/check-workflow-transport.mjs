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

/*
 * THE CRON HANDLER AND THE STEP MACHINERY, READ TOGETHER, because together they are what the
 * morning run is. The per-step work was lifted into step.ts when the release button needed to
 * take exactly the same path -- one runOneStep, so the wording, the fee, the Sent copy and the
 * record are identical whether a notice went out at six in the morning or because somebody
 * pressed a button. The rules below are unchanged; only which file holds them moved.
 */
const runner = read('api/_lib/workflow/run.ts')
  + read('api/_lib/workflow/step.ts')
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
const feeAt = runner.indexOf('chargeItemWith(')
const sendAt = runner.indexOf('sendAsUser(admin,')
const smsAt = runner.indexOf('await sendSms(')
ok('a fee is raised at all', feeAt > 0)
ok('...and something is actually sent', sendAt > 0 && smsAt > 0)
ok('the fee is raised after the email has gone', feeAt > sendAt)
ok('...and after the SMS has gone', feeAt > smsAt)

/*
 * AND IT GOES THROUGH THE CHARGE ENGINE, WHICH IS THE POINT OF THIS BLOCK NOW.
 *
 * THE FIRM: "I also sent the section 129 number. It doesn't record the fees associated." The fee
 * WAS recorded -- and it was recorded wrong, because the runner wrote the row by hand. Four rules
 * every other fee in Raptor obeys were simply absent:
 *
 *   VAT              never set, so it took the column default of nought while vat_rate said 15.
 *                    R25.00 charged where the same email sent by hand charges R28.75. The firm's
 *                    own money, on every message the runner has ever sent.
 *   IN DUPLUM        recoverableFee trims the fee that crosses the s103(5) line and writes what
 *                    follows at nought, not billed. Ignored.
 *   THE MONTHLY CAP  item 1(c) is ten SMSs a month. Ignored.
 *   THE TARIFF DATE  tariff_effective_from was null, so a fee could not be read back against the
 *                    schedule it was priced on.
 *
 * ASSERTED AS AN ABSENCE TOO. A hand-written insert alongside the engine would raise the fee
 * twice, and the one table nobody can correct afterwards is this one.
 */
ok('the fee goes through the same engine as every other fee',
  /chargeItemWith\(admin as unknown as ChargeDb, \{/.test(runner))
ok('...and the runner no longer writes a fee row itself',
  !/from\('account_fees'\)\.insert/.test(runner))
/*
 * PRICED ON THE ACTION, NOT ON THE CRON. The engine prices on scheduleFor(at), so `at` carries the
 * moment the step was sent. A fee stamped with whenever the runner happened to wake would
 * eventually be priced on one schedule and dated into another.
 */
ok('the fee is stamped with the action, not with the run', /at: new Date\(sentAt\)/.test(runner))
/* SEGMENTS ARE THE QUANTITY -- one row at the segment rate, not one row per segment, because a
   statement is read by a debtor. An email is priced per message, so one. */
ok('an SMS is charged by its segments', /quantity: plan\.charge\.segments \?\? 1/.test(runner))
/* AND THE TIMELINE REPORTS WHAT WAS ACTUALLY CHARGED, not the quote the step drawer shows: on an
   account at the ceiling the note said "R25.00 raised" beside a fee row of nought. */
ok('the note reads the engine\u2019s answer, not the quote',
  /fee\.exclVat \+ fee\.vat/.test(runner))
ok('...and says so when a notice earned nothing', /No charge: \$\{CHARGE_REFUSED/.test(runner))

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

/* ------------------------------------------------ the firm's own details */

/*
 * MAPPED, NEVER CAST — and this one shipped.
 *
 * The runner read firm_settings with select('*') and handed the RAW ROW to mergeValuesFor through
 * `as never`. The row is snake_case and FirmSettings is camelCase, so `firmName` and
 * `officeHours` were undefined on every notice: the handover held on "it needs {{firm_name}} and
 * {{firm_hours}}" while both sat correctly in the table. The firm found it on their first test
 * import and reasonably assumed their own details were wrong.
 *
 * The cast is what did it. `as never` silences the compiler on precisely the mismatch it could
 * have caught, and CLAUDE.md already names firmSettings' five hand-kept lists as the hazard.
 */
/* `runner` is the handler and the step machinery read together -- see the note above it. */
ok('the runner maps the firm row rather than casting it',
  /firm: toFirmSettings\(/.test(runner))
ok('...through firmSettings\u2019 own mapper, not a second list',
  /from '\.\.\/\.\.\/\.\.\/src\/lib\/firmSettingsRow\.js'/.test(runner))
/*
 * AND THE MAPPER IS SOMEWHERE THE SERVER CAN REACH. firmSettings.ts pulls in the browser's
 * Supabase client, which throws at import in Node -- the same reason emailStyle.ts is held apart
 * from it. A mapper that cannot be imported is a mapper that gets retyped.
 */
const firmRow = read('src/lib/firmSettingsRow.ts')
ok('the mapper is held where a serverless function can import it', firmRow.length > 0)
ok('...with no Supabase client in it', !/from '\.\/supabase'/.test(firmRow))
/* The two fields the firm's first test held on, named, because those are the ones that were
   undefined and the ones a reader will look for here. */
for (const field of ['firmName', 'officeHours']) {
  ok(`the mapper still names ${field}`, new RegExp(`${field}:`).test(firmRow))
}

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

/* ------------------------------------------------ the notice is the account's correspondence */

/*
 * The firm asked whether an account's emails survive a reallocation: "if Itumeleng sends an email
 * it shows in that section ... but if the account is reallocated to someone else, Itumeleng's
 * emails are still in there as a record ... will the other person also be able to send from
 * there, and it should also keep the records of those mails. Am I correct?"
 *
 * They are, for a by-hand send: account_emails is keyed by the ACCOUNT and readable by anyone
 * signed in, so it outlives whoever was holding the file. The WORKFLOW was the exception -- it
 * charged R25 under item 1(a) and filed nothing, so the Emails tab read "No email with this
 * debtor yet" on an account that had been emailed and billed for it.
 */
ok('a workflow email is filed as the account’s own correspondence',
  /from\('account_emails'\)\.insert\(\{/.test(runner))
ok('...against the account, which is what survives a reallocation',
  /account_id: account\.id,\s*\n\s*direction: 'out'/.test(runner))
/* The reply has to thread onto it rather than arriving as an unrelated message. */
ok('...carrying the message id the reply will quote', /message_id: sent\.messageId/.test(runner))
/* Which mailbox it left by decides where the reply lands -- sendAsUser returns it for that. */
ok('...and the mailbox it actually left by', /our_address: sent\.from/.test(runner))
/* A notice nobody typed must not read as somebody's own words. */
ok('...named as the workflow rather than as the collector', /sent_by_name: 'Workflow'/.test(runner))
ok('...with what it cost on it', /charged_excl_vat: plan\.charge\?\.rand \?\? 0/.test(runner))
/*
 * AND FILING NEVER FAILS THE SEND. The message has gone and the fee is about to be raised; a red
 * error after a debtor has in fact been written to would be false.
 */
ok('...and a filing failure does not undo a sent notice',
  /the notice went but was not filed/.test(runner))

/* ------------------------------------------------ a send leaves a record somebody reads */

/*
 * The firm, looking at an account whose handover had gone out: "I don't see that there's any
 * charges for any SMS nor any notes for the workflow that has gone out ... the status is not
 * correct, it says no contact attempt has been made yet, however the handover messages already
 * went out."
 *
 * The charges WERE raised -- items 1(a) and 1(c), correctly -- and the only trace of any of it
 * was a fee row and a tick inside the workflow panel. The collector's timeline, which is what
 * somebody reads before picking up the telephone, said nothing had happened at all.
 */
ok('a sent step goes on the account timeline', /from\('account_notes'\)\.insert\(/.test(runner))
ok('...named as the workflow rather than as a person', /author_name: 'Workflow'/.test(runner))
/* One timeline, not two -- the same table and source the by-hand debtor note uses. */
ok('...on the same table everything else is on', /source: 'workflow',/.test(runner))
/*
 * AND IT NAMES THE CHARGE. A fee the debtor will be asked to pay should be legible where the
 * action is, not only inside a total on the position panel.
 */
ok('the note says what it cost',
  /raised under item \$\{plan\.charge\?\.item \?\? ''\}/.test(runner))
ok('...and says who it went to', /sent\$\{toWhom \? ` to \$\{toWhom\}` : ''\}/.test(runner))
/* The same fallback the SMS send uses, or the note names a number the message did not go to. */
ok('...falling back the way the SMS send does',
  /pickContact\(contacts, 'mobile'\) \?\? pickContact\(contacts, 'phone'\)[\s\S]{0,60}?: pickContact\(contacts, 'email'\)/.test(runner))

/*
 * AND THE ACCOUNT COUNTS AS WORKED. last_action_at is what the client-facing narrative reads to
 * decide whether anybody has been in touch, and what "Gone quiet" and "never worked" filter on.
 * Two notices to a debtor is a contact attempt by any reading.
 */
ok('a sent step marks the account as worked', /\.update\(\{ last_action_at: today \}\)/.test(runner))
/*
 * THE FIRM'S DATE, NOT THE SERVER'S. It is a DATE column and sentAt is a UTC timestamp, so an
 * action at one in the morning in Johannesburg would be filed under the previous day.
 */
ok('...dated in the firm’s own day', !/last_action_at: sentAt/.test(runner))


/* ---------------- the notice and its SMS go out together ---------------- */

/*
 * THE FIRM: "SMSs and emails should go out at the same time, because the one refers to the other
 * one. You're just putting more manual work in for the person. This is supposed to be set and go."
 *
 * THE SWEEP ORDERED ONLY BY due_on, and the two steps of a pair share it -- so the database was
 * free to hand the SMS over first. Attempted in that order the SMS says "we have emailed you"
 * about an email that has not gone, planSend refuses it on `afterStepSent`, and it is marked HELD.
 * The email then sends a moment later in the SAME sweep and nothing goes back for the SMS: it sits
 * waiting for a person until somebody presses it. A debtor with the letter and no text, and a
 * collector with a press to make that nobody asked for.
 *
 * THE ORDINAL IS THE KEY, the same one accountRun was missing -- one bug in the screen and one in
 * the runner, the same shape, found in the same week.
 */
ok('the sweep asks for the node ordinal', /workflow_nodes!inner\(ordinal\)/.test(runner))
ok('...and attempts the notice before the SMS behind it',
  /a\.due_on\.localeCompare\(b\.due_on\)[\s\S]{0,120}workflow_nodes\?\.ordinal/.test(runner))
/*
 * AND THE MINUTES ARE NOT A WAIT ANYWHERE, which is what makes "at the same time" true rather than
 * aspirational. after_minutes is read in exactly one way -- is it null -- and the number is never
 * compared to a clock. Asserted as an absence, because the failure would be somebody implementing
 * the delay the column's name suggests and splitting every pair across a gap the firm does not
 * want.
 */
ok('the runner never waits out the minutes on the column',
  !/afterMinutes\s*[*><]|setTimeout|after_minutes\s*[*><]/.test(runner))
/* ONE PRESS SENDS BOTH, and the companion is run AS THE CALLER -- without that it would hit its own
   waits-for-a-person refusal and hold, which is the two presses the firm is complaining about. */
ok('a release sends the SMS behind the notice as the same person',
  /runOneStep\(admin, s, today, caller\.id\)/.test(read('api/_lib/workflow/release.ts')))

/* ---------------- the arrangement confirmation carries the schedule ---------------- */

/*
 * THE FIRM: "put it in the emails for this payment arrangement schedule... maybe it just goes out
 * automatically once the payment has been recorded."
 *
 * IT CANNOT BE A STORED LETTER, which is why none of this looks like the other attachment. A merge
 * field is a scalar and the body of that document is a comparison whose ROWS are the answer -- so it
 * is BUILT, per account, from the live arrangement, and message_templates.attaches_schedule is what
 * says which wording carries one.
 */
/*
 * ASSERTED ON THE USE AND ON THE SELECT, not on the word.
 *
 * A bare /attaches_schedule/ passed with the column dropped from the select AND the branch turned
 * off, because the row TYPE still declares the field and its comment still names it -- a check
 * satisfied by a type declaration and a comment about the thing it guards. That is the same trap
 * the seed's own guard fell into, in a new place.
 */
ok('the runner asks the library which wording carries a schedule',
  /select\('id, kind, subject, body, audience, name, attachment_id, attaches_schedule'\)/.test(runner))
ok('...and branches on it when the attachment is chosen',
  /attachment: r\.attaches_schedule && scheduleDoc/.test(runner))
ok('...and builds it from the live arrangement', /const scheduleDoc = \(\(\) => \{/.test(runner))
/*
 * THE SAME POSITION THE NOTICE'S OWN BALANCE COMES FROM. Written out twice, the balance quoted in
 * the email and the projection on the page attached to it would eventually disagree -- and the two
 * people who would compare them are the debtor holding the schedule and the collector reading the
 * email.
 */
ok('...off the same position the balance is', /const balance = computeBalance\(\{ \.\.\.position, accrueTo: today \}\)/.test(runner))
ok('...and the ladder from the same position too',
  /settlementLadder\(\{ account: position, schedule: recurring \}, plan\)/.test(runner))
/*
 * AND IT DOES NOT HOLD THE STEP WHERE IT CANNOT BE BUILT. Three honest cases -- no arrangement, an
 * offer that never clears the account, one that outruns the horizon -- and in all three the
 * confirmation itself is still true. Holding would stop a debtor being told their arrangement is
 * confirmed because an illustration of it could not be drawn.
 */
ok('...returning nothing rather than holding the step',
  /if \(repaymentLetterRefusal\(plan\) !== null\) return null/.test(runner))
/* THE SAME REFUSAL THE COLLECTOR'S PANEL SHOWS, so a schedule the screen would not offer is not one
   the runner quietly posts. */
ok('...by the same rule the collector\u2019s own panel uses',
  /repaymentLetterRefusal/.test(runner))
/* HANDED OVER AS A DOCUMENT, not as bytes, so everything downstream is unchanged: planSend reads
   its merge fields, letterProblems refuses it if the account cannot fill them, one code path draws
   the PDF. */
ok('...and handed over as a document, like any other attachment',
  /\{ key: 'Payment arrangement schedule', doc: scheduleDoc \}/.test(runner))

/* ---------------- the runner can answer a dispute message ---------------- */

/*
 * THE FOUR {{dispute_*}} FIELDS ARE ANSWERED BY THE RUNNER, OR THE DISPUTE WORKFLOW HOLDS ON EVERY
 * STEP -- silently, and in the safe direction, which is why nothing would report it. An unresolved
 * field leaves its braces standing and planSend refuses to send, so a dispute sequence with none of
 * this wired would look exactly like a workflow waiting on a collector.
 */
ok('the runner reads the account’s open dispute', /from\('account_queries'\)/.test(runner))
ok('...the newest one, by the day the debtor alleged it',
  /order\('alleged_on', \{ ascending: false/.test(runner))
/* A closed dispute is a finding already given, and a message about it would quote a window that ran
   out weeks ago. */
ok('...and never a closed one', /neq\('status', 'closed'\)/.test(runner))
/* 'help' is an agent asking a team leader and 'litigation' is the firm deciding whether to sue.
   Merging either into a notice would tell a debtor their account is disputed because a collector
   asked for supervision. */
ok('...and only a dispute, not the other two escalations',
  /eq\('kind', 'dispute'\)/.test(runner))
/*
 * AND THE WINDOW IS MEASURED AGAINST THE STATUTORY NOTICES ONLY. Two failures sit either side of
 * this one line. Without the filter, the dispute REQUEST -- which declares a ten-business-day period
 * of its own -- becomes the notice the next window is measured against, so every dispute resets its
 * own clock. Without the query at all, disputeWindow sees no notice and hands a debtor a fresh ten
 * days in the middle of a running section 129, extending a period the Act fixed.
 */
ok('...and the statutory notices already sent, for the window',
  /eq\('workflow_nodes\.statutory', true\)/.test(runner))
ok('...only the ones that actually went', /eq\('state', 'sent'\)/.test(runner))
ok('...across every run on the account, not only this one',
  /eq\('workflow_runs\.account_id', account\.id\)/.test(runner))
/*
 * ONE CALL, BOTH FIELDS. The count and the date come out of the same disputeWindow result, so they
 * cannot disagree -- and disagreeing is the failure that matters: "you have 6 business days, that is
 * by [a date ten days out]" is an ambiguity a debtor is entitled to resolve in their own favour.
 */
ok('the window is worked out once', /const window = disputeWindow\(/.test(runner))
ok('...and the count and the date both come off it',
  /daysLeft: disputeDaysPhrase\(window\.days\)/.test(runner)
  && /respondByOverride: disputeRes\.data \? window\.respondBy : null/.test(runner))
/* THE PHRASE IS NOT BUILT HERE. disputeDaysPhrase owns how a period reads, singular included; a
   second place deciding it is a template that says "6 business days days". */
ok('...with the phrasing left to the one place that decides it',
  /*
   * COMMENTS STRIPPED FIRST, which is the trap CLAUDE.md names in reverse: the comment ABOVE the
   * call explains the rule in the very words this looks for, so read raw it fails on correct code.
   */
  !/business day/.test(runner.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')))
/* AND THE OVERRIDE IS OFFERED ONLY WHERE THERE IS A DISPUTE, or the 'fresh' ten days of an account
   with no demand would leak onto the respond-by of a notice that is not about a dispute at all. */
ok('...and offered only on an account that has one',
  /dispute: disputeRes\.data[\s\S]{0,12}\? \{/.test(runner))


for (const f of failures) console.error(`  ✗ ${f}`)
console.log(`check-workflow-transport: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)

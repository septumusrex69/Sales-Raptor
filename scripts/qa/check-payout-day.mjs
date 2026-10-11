/**
 * A PAYOVER GOES OUT ON ITS PAYOUT DAY, AND A CHARGE TO SET OFF ALWAYS HAS A RUN TO COME OFF.
 *
 * THE FIRM, 11 Oct, on the simulation: the 2606 runs were approved and their advice emailed on
 * 10 Jul, the day before they were due to be paid -- "I shouldn't be able to email all the
 * payovers because [they] should only be going out on the next month ... when we do the payment",
 * and it "should not be in a ready state before, unless you override it somehow".
 *
 * WHAT THIS HOLDS:
 *   1. THE DATABASE REFUSES. The first send of an approved run (record_payover_send), marking it sent
 *      and marking it paid all call assert_payover_run_due BEFORE they write anything; the override is
 *      release_payover_run_early, Administrator only, with a reason of ten characters or more.
 *   2. THE BROWSER ASKS FIRST. sendRemittanceAdvice asks before it builds the PDF or sends -- the
 *      database's own refusal comes at the record step, after the email has gone.
 *   3. THE QUEUE NEVER OFFERS WHAT WOULD BE REFUSED: bulk email and bulk pay take due runs only.
 *   4. EVERY BULK PRESS ENDS: the busy flag is cleared in a `finally`, not on the last line.
 *   5. A SET-OFF CHARGE IS A REASON FOR A RUN ON ITS OWN (the SBB/2006 withdrawal had nothing to
 *      come off when its client's debtors paid nothing that cycle).
 *   6. AN ACCOUNT RAPTOR CLOSED READS CLOSED, whatever its Swordfish status says.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-payout-day.mjs
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
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
const sql = read('supabase/schema.sql')
/* The LAST definition is the live one (CLAUDE.md: schema.sql is append-only). */
const liveFn = (name) => {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  const m = /\bas \$(\w*)\$([\s\S]*?)\$\1\$/.exec(sql.slice(at))
  return m ? strip(m[2]) : ''
}
/* Present first, THEN ordered: an absent guard's indexOf is -1, which is "before" everything. */
const guardedBeforeWrite = (body) => {
  const g = body.indexOf('assert_payover_run_due(')
  const w = body.search(/\b(update|insert into) public\./)
  return g >= 0 && w >= 0 && g < w
}

/* ---------------- 1. the database ---------------- */
const due = liveFn('assert_payover_run_due')
ok('the due check compares the firm’s day with the payout day', /raptor_today\(\) < public\.payover_pays_on\(v_run\.period_end\)/.test(due))
ok('...and a release lets it through', /v_run\.released_at is null/.test(due))
ok('...and it raises rather than returning a flag', /raise exception/.test(due))

for (const fn of ['mark_payover_run_sent', 'mark_payover_run_paid', 'record_payover_send']) {
  ok(`${fn} asks before it writes`, guardedBeforeWrite(liveFn(fn)))
}
ok('a revision of an advice already sent is not held again', /if v_run\.status = 'approved' then perform public\.assert_payover_run_due/.test(liveFn('record_payover_send')))
ok('nor is paying a run whose advice already went', /= 'approved' then\s*perform public\.assert_payover_run_due/.test(liveFn('mark_payover_run_paid')))

const release = liveFn('release_payover_run_early')
ok('releasing early is Administrator only', /current_user_role\(\) is distinct from 'Administrator'/.test(release))
ok('...needs a reason of ten characters', /length\(coalesce\(v_why, ''\)\) < 10/.test(release))
ok('...and keeps who and why', /released_by = auth\.uid\(\), released_reason = v_why/.test(release))
ok('payments to make lists a run before its day as scheduled', /then 'scheduled' else r\.status end/.test(liveFn('payments_to_make')))

/* AND APPROVED ON THE PAYOUT DAY (the firm, 11 Oct: "you only approve it by the time that you pay it
   out"), so a withdrawal raised before it comes off it instead of sending an approved run back. */
const approve = liveFn('approve_payover_run')
const dayAt = approve.indexOf('raptor_today() < public.payover_pays_on(v_end)')
ok('approval refuses before the payout day without a reason', dayAt >= 0 && dayAt < approve.indexOf('update public.payover_runs'))
ok('approving early releases the payout too', /released_at = coalesce\(released_at, public\.raptor_now\(\)\)/.test(liveFn('approve_payover_run_early')))
ok('the queue holds a ready run until its day', /const waitsForDay = \(r: WorkQueueRow\) => r\.status === 'ready'/.test(strip(read('src/pages/finance/FinanceWorkQueue.tsx'))))

/* FINALISED (the firm, 11 Oct): a run below nil whose advice went is finished, not "Due today" for ever. */
const q11 = strip(read('src/pages/finance/FinanceWorkQueue.tsx'))
ok('a sent run below nil is finalised, beside the paid ones',
  /const isFinal = \(r: WorkQueueRow\) => r\.status === 'paid'\s*\|\| \(r\.netPayover <= 0 && \(r\.status === 'sent'/.test(q11)
  && /const paid = rows\.filter\(isFinal\)/.test(q11) && /!isFinal\(r\) && !isRunning\(r\)/.test(q11))
ok('...under a tab that says Finalised', /: 'Finalised'\}/.test(q11))

/* ---------------- 2. the browser asks first ---------------- */
const mail = strip(read('src/lib/remittanceEmail.ts'))
const send = mail.slice(mail.indexOf('export async function sendRemittanceAdvice'))
const ask = send.indexOf('assertRunDue(run.id)')
ok('the advice asks whether the run is due before it builds anything', ask >= 0 && ask < send.indexOf('remittancePdf(adv)'))
ok('...and before it sends', ask >= 0 && ask < send.indexOf("fetch('/api/email/send'"))

/* ---------------- 3 and 4. the queue ---------------- */
const queue = strip(read('src/pages/finance/FinanceWorkQueue.tsx'))
ok('bulk email takes due runs only', /toEmail = pickedRows\.filter\(\(r\) => r\.status === 'approved' && isDue\(r\)\)/.test(queue))
ok('bulk pay takes due runs only', /toPay = statementOnly \? \[\] : pickedRows\.filter\(\(r\) => \(r\.status === 'approved' \|\| r\.status === 'sent'\) && isDue\(r\)/.test(queue))
ok('a run before its day says when it pays instead of offering a button', /data-testid="scheduled"/.test(queue))
const bulk = queue.slice(queue.indexOf('async function bulk('), queue.indexOf('async function bulkApprove'))
ok('every bulk press clears its spinner in a finally', /finally \{[\s\S]*setBusy\(null\)/.test(bulk))
ok('...and every bulk action goes through it', ['bulkApprove', 'bulkEmail', 'payRuns'].every((f) => {
  const at = queue.indexOf(`async function ${f}(`)
  return at >= 0 && /await bulk\(/.test(queue.slice(at, at + 400))
}))
const run = strip(read('src/pages/finance/RunDetail.tsx'))
ok('the run page offers release early, not the email, before its day', /\{scheduled && \(/.test(run) && /run\.status === 'approved' && !scheduled && \(/.test(run))

/* The staging clock ends in a reload or a sentence, never a spinner over a clock that moved. */
const bar = strip(read('src/components/layout/StagingClockBar.tsx'))
ok('the clock jump cannot leave its line turning', /try \{\s*done = await jumpStagingClock/.test(bar))
const load = strip(read('src/lib/clockLoad.ts'))
ok('a dropped call asks the clock where it is', /catch \{[\s\S]*?loadClock\(\)/.test(load))
ok('...and every call is given up on in the end', /fetchWithin\('\/api\/workflow\/clock'/.test(load))

/* ---------------- 5. a set-off charge has a run ---------------- */
const refresh = liveFn('refresh_payover_runs')
ok('a set-off charge nothing has claimed builds its client a run', /from public\.client_charges c\s*where c\.settlement = 'set_off'\s*and c\.payover_run_id is null/.test(refresh))

/* ---------------- 6. an account Raptor closed reads closed ---------------- */
const acct = strip(read('src/pages/accounts/AccountDetail.tsx'))
ok('the desk position is told the account ended', /deskPosition\(\{\s*closed: ended,/.test(acct))
ok('...and so is what the client sees', /positionReport\(\{\s*closed: ended,/.test(acct))
ok('the hero says how it ended rather than the imported status', /account\.endedAs\s*\?\s*<span data-testid="account-ended-pill"/.test(acct))

if (failures.length) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-payout-day: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)

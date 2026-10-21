/**
 * WHAT WAS SENT TO A CLIENT IS KEPT EXACTLY AS IT WAS SENT.
 *
 * THE FIRM, 8 Oct: "whatever is paid and what has been sent to a client should always stick there
 * ... It couldn't change ... you can revise one and then send it again, but if something was sent,
 * there should be ... a record of ... the data that was sent."
 *
 * WHAT THIS HOLDS:
 *   1. THE RECORD CANNOT BE CHANGED. payover_run_sends has a select policy and nothing else, and a
 *      trigger refuses update and removal outright -- RLS alone would let the owner through.
 *   2. THE FILES CANNOT BE CHANGED. The payover-advice bucket is private, readable and insertable
 *      behind finance.view, with no update or removal policy, and uploaded with upsert off.
 *   3. THE ORDER: copies stored, then the email, then the record, then the status. A record with no
 *      copy behind it, or a record of an email that never went, is the failure this prevents.
 *   4. SENDING AGAIN IS A NEW VERSION: the next number, and a sent or paid run keeps its status.
 *   5. THE CLIENT'S FOLDER: a run marked paid by hand is waiting for the statement, not done, and
 *      only paid runs count as paid out.
 *
 * Proved on staging in a rolled-back probe: two sends gave versions 1 and 2; an update was refused
 * with "kept exactly as it was sent"; a send with no PDF path was refused.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-payover-sends.mjs
 */
import { readFileSync } from 'node:fs'
import { adviceCopyPaths } from '../../src/lib/remittanceAdvice.ts'
import { payoverStage, payoverTotals } from '../../src/lib/clientPayovers.ts'

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
const sql = strip(read('supabase/schema.sql'))
const liveFn = (name) => {
  const at = Math.max(sql.lastIndexOf(`create or replace function public.${name}(`), sql.lastIndexOf(`create function public.${name}(`))
  if (at < 0) return ''
  const m = /\bas \$(\w*)\$([\s\S]*?)\$\1\$/.exec(sql.slice(at))
  return m?.[2] ?? ''
}

/* ---- 1. the record ---- */
ok('the table exists', /create table if not exists public\.payover_run_sends \(/.test(sql))
const policies = [...sql.matchAll(/create policy "[^"]+" on public\.payover_run_sends\s+for (\w+)/g)].map((m) => m[1])
check('...with a select policy and no other', policies, ['select'])
ok('a trigger refuses update and removal', /create or replace trigger payover_run_sends_frozen\s+before update or delete on public\.payover_run_sends/.test(sql))
ok('...and it raises, not reverts', /raise exception 'A payover advice that was sent is kept exactly as it was sent/.test(liveFn('protect_payover_run_sends')))

const rec = liveFn('record_payover_send')
ok('recording needs finance.view', /if not public\.has_capability\('finance\.view'\) then\s+raise/.test(rec))
ok('...only an approved, sent or paid run', /status not in \('approved', 'sent', 'paid'\)/.test(rec))
ok('...never without its copies', /p_pdf_path[\s\S]*p_xlsx_path[\s\S]*has to be kept with it/.test(rec))
ok('...and the next version, never an overwrite', /coalesce\(max\(version\), 0\) \+ 1/.test(rec) && !/\bupdate\b|on conflict/i.test(rec))
ok('unique per run and version', /unique \(run_id, version\)/.test(sql))
ok('no public execute', /revoke all on function public\.record_payover_send\([^)]*\) from public, anon/.test(sql))

/* ---- 2. the files ---- */
ok('the bucket is private', /values \('payover-advice', 'payover-advice', false\)/.test(sql))
const bucketPolicies = [...sql.matchAll(/create policy "(payover_advice_\w+)" on storage\.objects\s+for (\w+)/g)].map((m) => m[2]).sort()
check('...read and add, nothing else', bucketPolicies, ['insert', 'select'])
const email = strip(read('src/lib/remittanceEmail.ts'))
const ups = email.split('\n').filter((l) => l.includes('.upload('))
check('both copies are uploaded', ups.length, 2)
ok('...each with upsert off', ups.every((l) => l.includes('{ upsert: false })')))
ok('no update or remove on the bucket anywhere in src', !/from\('payover-advice'\)\.(update|remove|move)\(/.test(email))
const p = adviceCopyPaths('c1', 'PO-BPM/2610', 'S')
check('a copy lives in the client\'s folder, under the invoice', p, { pdf: 'c1/PO-BPM_2610/S.pdf', xlsx: 'c1/PO-BPM_2610/S.xlsx' })

/* ---- 3. the order ---- */
const iUp = email.indexOf('.upload(')
const iMail = email.indexOf("fetch('/api/email/send'")
const iRec = email.indexOf("rpc('record_payover_send'")
const iSent = email.indexOf('markRunSent(run.id)')
ok('all four steps are there', iUp > 0 && iMail > 0 && iRec > 0 && iSent > 0)
ok('copies, then the email, then the record, then sent', iUp < iMail && iMail < iRec && iRec < iSent)

/* ---- 4. sending again ---- */
ok('only an approved run is moved to sent', /if \(run\.status === 'approved'\) await markRunSent\(run\.id\)/.test(email))
const detail = strip(read('src/pages/finance/RunDetail.tsx'))
ok('a sent or paid run offers Send again', /\(run\.status === 'sent' \|\| run\.status === 'paid'\) && \([\s\S]{0,400}Send again/.test(detail))
ok('the run shows what went', /<SentCopies sends=\{sends\}/.test(detail) && /fetchAdviceSends\(\{ runId: id \}\)/.test(detail))

/* ---- 5. the client's folder ---- */
const run = (status, statementDate = null) => ({ id: 'r', invoiceNumber: 'PO-X', status, periodStart: '2026-08-11',
  periodEnd: '2026-09-10', netPayover: 100, paidAt: null, eftReference: null, statementDate })
check('paid by hand is not done', payoverStage(run('paid')), { label: 'Paid, waiting for the statement', tone: 'todo' })
check('...on the statement is', payoverStage(run('paid', '2026-09-16')), { label: 'Paid, on the statement 16 Sep 2026', tone: 'done' })
check('sent is still owed', payoverStage(run('sent')).label, 'Advice sent, not paid yet')
check('paid out counts paid runs; still to pay counts approved and sent; review and void count nowhere',
  payoverTotals([run('paid'), run('paid', '2026-09-16'), run('sent'), run('approved'), run('ready'), run('void')]), { paid: 200, owed: 200 })
const company = strip(read('src/pages/companies/CompanyDetail.tsx'))
ok('the client record has a Payovers tab, for who may see trust only',
  /canViewTrust\(currentUser\) \? \[\{ id: 'Payovers' as const, label: 'Payovers' \}\] : \[\]/.test(company)
  && /<ClientPayoversPanel companyId=\{company\.id\} \/>/.test(company))
/* The firm, 10 Oct: the Payovers tab is the last one. */
ok('...and it is the last tab', company.indexOf("id: 'Payovers' as const") > company.indexOf("{ id: 'Tasks', label: 'Tasks'")
  && company.indexOf("{ id: 'Tasks', label: 'Tasks'") > 0)

if (failures.length) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-payover-sends: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)

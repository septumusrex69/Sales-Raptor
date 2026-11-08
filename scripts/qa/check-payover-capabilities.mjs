/**
 * TRUST GUARDS ARE CAPABILITIES, NOT "IS AN ADMINISTRATOR" (Raptor H19 / S20; Stephan, 8 Nov).
 *
 * Reads -> finance.view. Approving a payover run (with approve early, release early, issuing the advice, resetting
 * and voiding) -> payover.approve with finance. Marking a run or a refund paid, by hand or off the statement ->
 * payover.pay with finance. Moving a receipt to another debtor -> payment.move. Both new ticks are in the
 * Administrator's template and the finance set, so nothing changed for anybody on the day and only an Administrator
 * with finance gives or takes them. No maker-checker: Stephan, "unnecessary".
 *
 * Held against the LAST definition of each function and policy in schema.sql (append-only), and against the
 * screens, so a button is drawn only where the database will honour it.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-payover-capabilities.mjs
 */
import { readFileSync } from 'node:fs'
import { CAPABILITIES, FINANCE_CAPABILITIES, ROLE_CAPABILITIES } from '../../src/lib/capabilities.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const schema = read('supabase/schema.sql')

function lastFn(name) {
  const re = new RegExp(`create (or replace )?function public\\.${name}\\(`, 'gi')
  let m; let at = -1
  while ((m = re.exec(schema))) at = m.index
  if (at < 0) return ''
  const tag = /\bas\s+(\$[a-z_]*\$)/i.exec(schema.slice(at))
  if (!tag) return ''
  const start = at + tag.index + tag[0].length
  return schema.slice(at, schema.indexOf(tag[1], start))
}
const ROLE = /current_user_role\(\)\s*(=|is distinct from|<>)\s*'Administrator'/

const READS = ['bank_import_history', 'client_account', 'finance_exception_jobs', 'money_position', 'payment_audit',
  'payments_posted', 'payover_buildable', 'payover_cycle_tiles', 'payover_run_payments', 'payover_work_queue',
  'suspended_bank_lines', 'unallocated_receipts', 'account_ledger', 'expected_from_promises', 'preview_allocation',
  'payover_cycle_now', 'refresh_payover_runs', 'build_payover_run']
const APPROVE = ['approve_payover_run', 'approve_payover_run_early', 'release_payover_run_early', 'mark_payover_run_sent',
  'reset_payover_run', 'void_payover_run']
const PAY = ['mark_payover_run_paid', 'mark_refund_paid', 'reconcile_bank_debit']

for (const fn of READS) {
  const b = lastFn(fn)
  ok(`${fn} is defined`, b.length > 0)
  ok(`...asks finance.view`, /has_capability\('finance\.view'\)/.test(b))
  ok(`...and not the Administrator role`, !ROLE.test(b))
}
for (const fn of APPROVE) {
  const b = lastFn(fn)
  ok(`${fn} asks payover.approve with finance`,
    /not \(public\.has_capability\('finance\.view'\) and public\.has_capability\('payover\.approve'\)\)/.test(b))
  ok(`...and not the Administrator role`, !ROLE.test(b))
}
for (const fn of PAY) {
  const b = lastFn(fn)
  ok(`${fn} asks payover.pay with finance`,
    /not \(public\.has_capability\('finance\.view'\) and public\.has_capability\('payover\.pay'\)\)/.test(b))
  ok(`...and not the Administrator role`, !ROLE.test(b))
}
const alloc = lastFn('allocate_bank_line')
const refundAt = alloc.indexOf("elsif p_kind = 'refund' then")
ok('allocate_bank_line has a refund branch', refundAt > 0)
ok('...which asks payover.pay before it marks the refund paid',
  refundAt > 0 && /has_capability\('payover\.pay'\)/.test(alloc.slice(refundAt, alloc.indexOf('elsif', refundAt + 10))))
ok('...and its payover branch goes through reconcile_bank_debit (payover.pay)',
  /if p_kind = 'payover' then[\s\S]{0,400}perform public\.reconcile_bank_debit\(/.test(alloc))

const move = lastFn('set_payment_account')
ok('set_payment_account (move a receipt to another debtor) asks payment.move', /has_capability\('payment\.move'\)/.test(move))
ok('...not payment.approve', !/may_approve_payment\(\)|has_capability\('payment\.approve'\)/.test(move))
const cyc = lastFn('move_payment_to_cycle')
ok('move_payment_to_cycle has its own check: finance and staging', /has_capability\('finance\.view'\)/.test(cyc) && /is_staging_database\(\)/.test(cyc))
ok('...and no longer borrows payment.move', !/has_capability\('payment\.move'\)/.test(cyc))

/* ---- policies ---- */
function lastPolicy(name) {
  const re = new RegExp(`(create|alter) policy ${name}\\b[^;]*;`, 'g')
  let m; let last = ''
  while ((m = re.exec(schema))) last = m[0]
  return last
}
for (const p of ['bank_statement_lines_read', 'client_charges_select', 'payover_run_lines_read', 'payover_runs_read',
  'trust_creditor_entries_select', 'trust_payments_out_select', 'finance_setting_changes_read']) {
  const pol = lastPolicy(p)
  ok(`${p} reads on finance.view`, /has_capability\('finance\.view'\)/.test(pol) && !ROLE.test(pol))
}
for (const p of ['payover_runs_write', 'payover_run_lines_insert']) {
  const pol = lastPolicy(p)
  ok(`${p} writes on payover.approve with finance`, /payover\.approve/.test(pol) && /finance\.view/.test(pol) && !ROLE.test(pol))
}

/* ---- the template and the finance set ---- */
const roleCaps = lastFn('role_capabilities')
const adminLine = roleCaps.slice(roleCaps.indexOf("when 'Administrator'"), roleCaps.indexOf("when 'Sales Manager'"))
ok('the Administrator\'s template carries payover.approve and payover.pay (nothing changes for anybody today)',
  /'payover\.approve'/.test(adminLine) && /'payover\.pay'/.test(adminLine))
ok('...and no other role does', !/payover\./.test(roleCaps.slice(roleCaps.indexOf("when 'Sales Manager'"))))
const finSet = lastFn('finance_capabilities')
ok('both are in the finance set, so only an Administrator with finance gives or takes them',
  /'payover\.approve'/.test(finSet) && /'payover\.pay'/.test(finSet))
ok('the screen\'s finance set says the same', FINANCE_CAPABILITIES.includes('payover.approve') && FINANCE_CAPABILITIES.includes('payover.pay'))
ok('the screen\'s Administrator template says the same',
  ROLE_CAPABILITIES.Administrator.includes('payover.approve') && ROLE_CAPABILITIES.Administrator.includes('payover.pay'))
for (const c of ['payover.approve', 'payover.pay']) {
  ok(`${c} has a firm-style label`, typeof CAPABILITIES[c]?.label === 'string' && /payover|refund/i.test(CAPABILITIES[c].label))
  ok(`...is in Money and marked as enforced`, CAPABILITIES[c]?.group === 'Money' && CAPABILITIES[c]?.inDatabase === true)
}

/* ---- the screens ---- */
const perms = read('src/lib/permissions.ts')
ok('canApprovePayover asks finance and payover.approve', /canApprovePayover[\s\S]{0,200}can\(user, 'finance\.view'\) && can\(user, 'payover\.approve'\)/.test(perms))
ok('canMarkPaidOut asks finance and payover.pay', /canMarkPaidOut[\s\S]{0,200}can\(user, 'finance\.view'\) && can\(user, 'payover\.pay'\)/.test(perms))
ok('canMoveReceipt asks payment.move', /canMoveReceipt[\s\S]{0,200}can\(user, 'payment\.move'\)/.test(perms))
const run = read('src/pages/finance/RunDetail.tsx')
ok('the run page draws Approve only for payover.approve', /\{mayApprove && run\.status === 'ready' && !beforeDay && \(/.test(run))
ok('...Approve early too', /\{mayApprove && run\.status === 'ready' && beforeDay && \(\s*<button/.test(run))
ok('...Release early too', /\{mayApprove && <button[\s\S]{0,80}setReleaseModal\(true\)/.test(run))
ok('...Email advice too (issuing is mark_payover_run_sent)', /\{mayApprove && run\.status === 'approved' && !scheduled && \(/.test(run))
ok('...and Mark paid only for payover.pay', /\{mayPay && \(run\.status === 'approved' \|\| run\.status === 'sent'\)/.test(run))
const queue = read('src/pages/finance/FinanceWorkQueue.tsx')
ok('the queue approves in bulk only for payover.approve', /const toApprove = !mayApprove \? \[\]/.test(queue))
ok('...and pays in bulk only for payover.pay', /const toPay = statementOnly \|\| !mayPay \? \[\]/.test(queue))
ok('Payments out offers Mark paid only for payover.pay', /const mayPay = canMarkPaidOut\(currentUser\)/.test(read('src/pages/trust/TrustPaymentsOut.tsx')))
ok('Overpayments offers Mark paid only for payover.pay', /statementOnly \|\| !mayPay \?/.test(read('src/pages/trust/TrustOverpayments.tsx')))
ok('the approval queue offers Move only for payment.move', /\{mayMove && <button type="button" onClick=\{\(\) => setMoving\(r\)\}/.test(read('src/pages/finance/AwaitingApproval.tsx')))
ok('placing a parked receipt (set_payment_account) is payment.move too', /\{mayMove && <button type="button" onClick=\{\(\) => setPlacingParked\(r\)\}/.test(read('src/pages/finance/UnallocatedReceipts.tsx')))

console.log(`\ncheck-payover-capabilities: ${pass} passed, ${failures.length} failed`)
for (const f of failures) console.log(`  ✗ ${f}`)
process.exit(failures.length ? 1 : 0)

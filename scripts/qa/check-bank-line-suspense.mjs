/**
 * MOVE TO SUSPENSE FROM "NEEDS AN ACCOUNT" (S10, prompt 13 item 13). Probed on staging (S10): a blank
 * note was refused, a noted line left Needs an account and appeared In suspense with its author.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-bank-line-suspense.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const ok = (name, v) => { if (v === true) pass += 1; else failures.push(name) }
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const sql = read('supabase/schema.sql')
const lastFn = (name) => {
  const at = sql.lastIndexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  const m = /\bas\s+\$(\w*)\$([\s\S]*?)\$\1\$/i.exec(sql.slice(at))
  return (m?.[2] ?? '').replace(/--[^\n]*/g, '')
}

const suspend = lastFn('suspend_bank_line')
ok('the note is required by the database', /if v_note is null then\s+raise exception/.test(suspend))
ok('...by the people who work the queue', /if not public\.may_approve_payment\(\) then/.test(suspend))
ok('...only an unplaced receipt', /v_line\.direction <> 'credit' or v_line\.status <> 'unallocated'/.test(suspend))
ok('...stamped who and when on the business clock, the line left unallocated',
  /set suspended_at = public\.raptor_now\(\), suspended_by = auth\.uid\(\)/.test(suspend) && !/status\s*=/.test(suspend.split('update public.bank_statement_lines')[1] ?? ''))
ok('Needs an account no longer lists it', /and l\.suspended_at is null/.test(lastFn('unallocated_receipts')))
ok('In suspense does', /and l\.suspended_at is not null/.test(lastFn('suspended_bank_lines')))
ok('...and it can go back', /set suspended_at = null/.test(lastFn('release_bank_line_from_suspense')))

const page = read('src/pages/finance/UnallocatedReceipts.tsx')
ok('each unplaced receipt offers Move to suspense', /data-testid="move-to-suspense"/.test(page))
ok('...asking what was looked for, refusing a blank', /if \(!note\.trim\(\)\) \{ setErr\('Say what you looked for\.'\); return \}/.test(page))
ok('In suspense can be placed and split like Needs an account',
  /data-testid="suspended-bank-lines"/.test(page) && (page.match(/onClick=\{\(\) => setPlacing\(r\)\}/g) ?? []).length >= 2
  && (page.match(/onClick=\{\(\) => setSplitting\(r\)\}/g) ?? []).length >= 2)
ok('the money in suspense still counts in the tile', /sl\.reduce\(\(n, x\) => n \+ x\.amount, 0\)/.test(page))

if (failures.length) {
  console.error(`check-bank-line-suspense: ${failures.length} failed, ${pass} passed\n  ✗ ${failures.join('\n  ✗ ')}`)
  process.exit(1)
}
console.log(`check-bank-line-suspense: ${pass} passed, 0 failed`)

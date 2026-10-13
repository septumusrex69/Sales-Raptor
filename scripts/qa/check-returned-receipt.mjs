/**
 * A PAYMENT THAT BOUNCES (prompt 12, part A).
 *
 * +R1 000 FNB APP PAYMENT FROM SBB/2003 ZULU on 15 Aug, -R1 000 RETURNED DEBIT SBB/2003 ZULU
 * INSUFFICIENT FUNDS on 20 Aug, and Raptor had no way to say so. Proved on staging 13 Oct on that very
 * pair (rolled back): SBB/2003 capital 2 981.05 -> 3 692.38, both lines closed, no copy left in the
 * queue, no live receipt fee, nothing put back unplaced. What this holds is the SQL as written:
 * one transaction through the EXISTING reversal; the queue copy rejected; both lines closed, the debit
 * naming the receipt; whole amounts, a receipt before the debit; candidates offered (same amount, before,
 * 60 days, the named account first), never paired silently; and the screens offer it where the line is.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-returned-receipt.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const ok = (name, v) => { if (v) pass += 1; else failures.push(name) }
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const sql = read('supabase/schema.sql')
const lastFn = (name) => {
  const i = sql.lastIndexOf(`create or replace function public.${name}(`)
  return i < 0 ? '' : sql.slice(i, sql.indexOf('$$;', sql.indexOf('$$', i) + 2))
}
const ret = lastFn('return_bounced_receipt')
ok('return_bounced_receipt is in schema.sql', ret.length > 500)
ok('it reverses through the existing reversal (receipt fee cancelled, capital back, paid-run rule)', /v_copy := public\.reverse_payment\(p_payment, v_reason\);/.test(ret))
ok('...with the reason in the firm\'s words', /v_reason := 'Returned unpaid - '/.test(ret))
ok('nothing goes back to the queue: the copy is rejected at once', /perform public\.reject_payment\(v_copy, v_reason, false\);/.test(ret))
ok('...and the receipt\'s line is put back on the reversed payment, not unplaced',
  /set status = 'allocated', payment_id = p_payment, account_id = v_pay\.account_id/.test(ret)
  && ret.indexOf('reject_payment(v_copy') < ret.indexOf("set status = 'allocated', payment_id = p_payment"))
ok('the debit is closed naming the receipt', /returned_payment_id = p_payment/.test(ret) && /allocation_kind = 'other'/.test(ret))
ok('...without writing a trust entry of its own (the reversal takes the money back)', !/insert into public\.trust_creditor_entries/.test(ret))
ok('whole amounts only', /round\(v_pay\.amount, 2\) <> round\(-v_line\.amount, 2\) then\s+raise exception/.test(ret))
ok('the receipt must be before the debit', /> v_line\.txn_date then\s+raise exception 'That receipt arrived after the debit/.test(ret))
ok('only a debit line still open', /if v_line\.status in \('allocated', 'reconciled'\) or v_line\.allocation_kind is not null then/.test(ret))
ok('needs the trust tick and the right to reverse', /has_capability\('finance\.view'\) and public\.has_capability\('payment\.reverse'\)/.test(ret))
ok('the account remembers the day it came back', /set returned_unpaid_on = v_line\.txn_date/.test(ret))
const cand = lastFn('bounced_receipt_candidates')
ok('candidates: exactly the amount', /round\(p\.amount, 2\) = round\(-l\.amount, 2\)/.test(cand))
ok('...received on or before the debit, within 60 days', /<= l\.txn_date/.test(cand) && />= l\.txn_date - 60/.test(cand))
ok('...still standing, not a PTC, not Swordfish history', /p\.reversed_at is null and p\.rejected_at is null/.test(cand) && /not p\.paid_to_client and not p\.paid_over_in_swordfish/.test(cand))
ok('...the one whose account number the bank quotes first', /order by 9 desc/.test(cand) && /position\(upper\(d\.account_number\)/.test(cand))

const picker = read('src/components/finance/ReturnedReceiptPicker.tsx')
ok('the picker suggests, a person confirms -- never silently', /Looks like the \{label\(best\)\} bounced/.test(picker)
  && /onClick=\{\(\) => void go\(\)\}/.test(picker) && !/useEffect\([^)]*returnBouncedReceipt/.test(picker))
ok('Payments in offers it on a returned debit', /lineNature\(p\.description, 'debit'\) === 'returned_debit' \? \(/.test(read('src/pages/finance/UnallocatedReceipts.tsx'))
  && /<ReturnedReceiptPicker lineId=\{p\.id\}/.test(read('src/pages/finance/UnallocatedReceipts.tsx')))
const exc = read('src/components/finance/BankLinesToAllocate.tsx')
ok('Exceptions has "Returned / unpaid receipt" for a debit', /<option value="returned">Returned \/ unpaid receipt<\/option>/.test(exc))
ok('...chosen for the line when the bank says RETURNED', /lineNature\(line\.description, line\.direction\) === 'returned_debit' \? 'returned'/.test(exc))
ok('the account says Returned unpaid, not Reversed', /'Returned unpaid' : 'Reversed'/.test(read('src/components/accounts/AccountPaymentsList.tsx'))
  && /Returned unpaid \$\{displayDay/.test(read('src/lib/accountTimeline.ts')))

if (failures.length) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-returned-receipt: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)

/**
 * PROMPT 11: A HANDOVER SHEET'S DATE OF DEFAULT IS NOT THE HANDOVER DATE.
 *
 * The sheet's "Date of default" was saved as handover_date, and interest runs from handover_date --
 * so an account handed over today opened with months of interest, and the Accounts list called the
 * default date "Handed over". The firm (Stephan, 7 Oct 2026): "interest runs from the date of
 * handover, never from the date of default."
 *
 * check-handover-draft holds the conversion itself (toDebtorInput / toAccountRow). This holds the
 * rest of the path: the day is SAST at every door, the default is kept as a record and shown as
 * one, the runner's {{handover_date}} is the handed-over day, accrual still starts at the handover
 * and only there, and the Swordfish import is untouched.
 *
 * Run: node --import ./scripts/qa/tsresolve.mjs scripts/qa/check-handover-date.mjs
 */
import { readFileSync } from 'node:fs'
import { validateNewDebtor } from '../../src/lib/newDebtor.ts'

let pass = 0
const failures = []
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual); const b = JSON.stringify(expected)
  if (a === b) { pass += 1; return }
  failures.push(`${name}\n    expected ${b}\n    got      ${a}`)
}
const ok = (name, actual) => check(name, actual, true)
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

/* ---------------- the day is the firm's, at every door ---------------- */

ok('the import screen approves on the SAST day', /const today = \(\) => firmToday\(\)/.test(code('src/components/settings/HandoverImportCard.tsx')))
ok('...and so does a follow-up approved from a ticket', /const TODAY = \(\) => firmToday\(\)/.test(code('src/pages/queries/QueryDetail.tsx')))
const add = code('src/components/companies/AddDebtorModal.tsx')
ok('Add debtor hands over today, SAST', /const today = firmToday\(\)/.test(add) && /handoverDate: today,/.test(add))
/* THE BOX THAT INVITED THE DEFAULT DATE IS GONE: nobody types the handover date any more. */
check('...with no box to type a handover date into', /value=\{form\.handoverDate\}/.test(add), false)
ok('...and asks for the date of default as a record', /value=\{form\.defaultDate \?\? ''\}/.test(add))

/* ---------------- the default is a record, and a checked one ---------------- */

const base = {
  accountNumber: 'X1', clientReference: '', firstName: 'A', surname: 'B', idNumber: '', capital: '100',
  handoverDate: '2026-10-07', interestRateAnnual: '24', mobile: '', workPhone: '', altNumber: '',
  email: '', address: '', employer: '',
}
const problems = (extra) => validateNewDebtor({ ...base, ...extra }, '2026-10-07').filter((p) => p.field === 'defaultDate')
check('no date of default is fine -- it is a record, not a clock', problems({}).length, 0)
check('...a bad one is refused', problems({ defaultDate: '15/03/2026' }).length, 1)
check('...and so is one in the future', problems({ defaultDate: '2026-12-01' }).length, 1)

/* ---------------- what the account shows ---------------- */

const page = code('src/pages/accounts/AccountDetail.tsx')
ok('the account page shows the date of default', /<Field label="Date of default"/.test(page))
ok('...beside "Handed over"', /<Field label="Handed over" value=\{handedOver\}/.test(page))
ok('...and hands it to the timeline', /defaultDate: account\.defaultDate,/.test(page))
const timeline = code('src/lib/accountTimeline.ts')
ok('the timeline says interest runs from the handover', /Handed over on \$\{displayDay\(opening\.handoverDate\)\}; interest runs from that day\./.test(timeline))
check('...and no longer calls the handover the day the debt fell due', /The debt fell due on \$\{displayDay\(opening\.handoverDate\)\}/.test(timeline), false)
ok('default_date reaches the account', /defaultDate: r\.default_date \?\? null/.test(code('src/lib/accountBook.ts')))

/* ---------------- the letters and the interest ---------------- */

const step = code('api/_lib/workflow/step.ts')
check('the runner merges {{handover_date}} from the handed-over day, both places',
  (step.match(/handoverDate: account\.handover_date \?\? account\.opening_as_at \?\? null/g) ?? []).length, 2)
/* ACCRUAL STILL STARTS AT THE HANDOVER AND ONLY THERE -- the fix was the date written, not the
   engine. Asserted so nobody "fixes" the engine to read the default instead. */
const balance = code('src/lib/accountBalance.ts')
ok('the browser accrues from the handover', /\?\? \(input\.handoverDate \? dayBefore\(input\.handoverDate\) : null\)/.test(balance))
check('...and never from the default', /defaultDate/.test(balance), false)
const sql = read('supabase/schema.sql')
const openInterest = sql.slice(sql.lastIndexOf('create or replace function public.open_interest('))
ok('the database accrues from the handover', /v_covered := v_acct\.handover_date - 1/.test(openInterest.slice(0, 6000)))
ok('default_date is a column, kept on the account', /add column if not exists default_date date/.test(sql))

/* ---------------- Swordfish unchanged ---------------- */

const sf = code('src/lib/swordfishImport.ts')
ok('the Swordfish import keeps its load date', /handover_date: loadDate,/.test(sf))
check('...and writes no default_date', /default_date/.test(sf), false)

if (failures.length > 0) console.error(failures.map((f) => `  ✗ ${f}`).join('\n'))
console.log(`check-handover-date: ${pass} passed, ${failures.length} failed`)
process.exit(failures.length > 0 ? 1 : 0)

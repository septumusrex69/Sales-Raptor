/**
 * Run the Debtors Per Client reader over a real export and report what it made of it.
 *
 * The point is not that it parses. It is what the numbers come out as: a reader that silently
 * finds 40 phone numbers in a file holding 691 looks exactly like one that works.
 *
 *   node --experimental-strip-types scripts/qa/check-debtors.mjs <file.csv>
 */
import fs from 'node:fs'
import { parseCsv } from '../../src/lib/csv.ts'
import { readDebtorsPerClient } from '../../src/lib/swordfishDebtors.ts'
import { buildImportPlan, planRows } from '../../src/lib/swordfishImport.ts'
import { planEnrichment } from '../../src/lib/swordfishDebtors.ts'

const file = process.argv[2]
if (!file) {
  console.error('Usage: node --experimental-strip-types scripts/qa/check-debtors.mjs <file.csv>')
  process.exit(2)
}

const rows = parseCsv(fs.readFileSync(file, 'utf8'))
const d = readDebtorsPerClient(rows)
const s = d.stats

console.log(`\nRead ${rows.length} rows.\n`)
for (const [k, v] of Object.entries(s)) console.log(`  ${String(v).padStart(6)}  ${k}`)

console.log('\nProblems:')
console.log(d.problems.length ? d.problems.map((p) => `  ! ${p}`).join('\n') : '  none')
console.log('\nNotes:')
console.log(d.notes.map((n) => `  - ${n}`).join('\n'))

/* A worked example, so the shape of what lands in the database is visible rather than counted. */
const ref = [...d.contactsByRef.keys()].find((k) => (d.promisesByRef.get(k) ?? []).length)
  ?? [...d.contactsByRef.keys()][0]
if (ref) {
  console.log(`\nExample — ${ref}`)
  console.log('  patch:', JSON.stringify(d.patches.get(ref), null, 2).replace(/\n/g, '\n  '))
  console.log('  contacts:')
  for (const c of d.contactsByRef.get(ref) ?? []) {
    console.log(`    ${c.kind.padEnd(8)} ${c.value}${c.is_primary ? '  (primary)' : ''}${c.label ? `  [${c.label}]` : ''}`)
  }
  for (const p of d.promisesByRef.get(ref) ?? []) {
    console.log(`  promise: R${p.amount} due ${p.due_on} — ${p.status}${p.origin ? ` via ${p.origin}` : ''}`)
  }
  for (const n of d.notesByRef.get(ref) ?? []) {
    console.log(`  note (${n.created_at.slice(0, 10)}): ${n.body.slice(0, 90)}`)
  }
}

/* Guards. These are the ways this reader could be wrong while still looking busy. */
let failed = 0
const check = (name, ok, detail) => {
  if (!ok) failed++
  console.log(`\n${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n        ${detail}` : ''}`)
}

const allContacts = [...d.contactsByRef.values()].flat()
check('every stored ID number is 13 digits',
  [...d.patches.values()].every((p) => !p.debtor_id_number || /^\d{13}$/.test(p.debtor_id_number)))
check('no contact value is empty', allContacts.every((c) => c.value.trim().length > 0))
check('every email contact contains @', allContacts.filter((c) => c.kind === 'email').every((c) => c.value.includes('@')))
check('every phone contact has 7+ digits',
  allContacts.filter((c) => ['mobile', 'phone', 'work'].includes(c.kind)).every((c) => c.value.replace(/\D/g, '').length >= 7))
check('at most one primary contact per debtor',
  [...d.contactsByRef.values()].every((cs) => cs.filter((c) => c.is_primary && c.kind !== 'address' && c.kind !== 'email').length <= 1))
check('no duplicate value within one debtor',
  [...d.contactsByRef.values()].every((cs) => new Set(cs.map((c) => `${c.kind}:${c.value.toLowerCase()}`)).size === cs.length))
const promises = [...d.promisesByRef.values()].flat()
check('every promise has a positive amount and a due date',
  promises.every((p) => p.amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(p.due_on)))
check('no promise was imported as kept',
  promises.every((p) => p.status !== 'kept'),
  'Swordfish only reports the CURRENT promise; a kept one would be an invention.')

/*
 * End to end through buildImportPlan.
 *
 * The wiring is the part that fails quietly: this file can parse perfectly and still never reach
 * the database if the plan builder is not handed it. This export happens to carry enough columns
 * to stand in as the Client Account Summary as well, so the same rows can play both parts and
 * prove the merge actually lands on the accounts.
 */
const plan = buildImportPlan(
  { accounts: rows, payments: [], actions: [], interest: [], debtors: rows },
  { ownerId: '00000000-0000-4000-8000-000000000000' },
)
const tables = planRows(plan)

console.log('\nThrough buildImportPlan:')
for (const [t, r] of Object.entries(tables)) console.log(`  ${String(r.length).padStart(6)}  ${t}`)

check('the plan carries the contacts', tables.account_contacts.length === s.contacts,
  `plan has ${tables.account_contacts.length}, reader found ${s.contacts}`)
check('the plan carries the promises', tables.promises_to_pay.length === s.promises,
  `plan has ${tables.promises_to_pay.length}, reader found ${s.promises}`)
check('the plan carries the comments', tables.account_notes.length === s.importedNotes,
  `plan has ${tables.account_notes.length}, reader found ${s.importedNotes}`)
check('every contact points at a real account',
  tables.account_contacts.every((c) => tables.debtor_accounts.some((a) => a.id === c.account_id)))
check('main comments reached the account rows',
  tables.debtor_accounts.filter((a) => a.main_comment).length === s.mainComments,
  `${tables.debtor_accounts.filter((a) => a.main_comment).length} accounts carry one, reader found ${s.mainComments}`)
check('nothing was reported unmatched', !plan.problems.some((p) => /no matching account/.test(p)),
  plan.problems.filter((p) => /no matching account/.test(p)).join(' '))

/*
 * The enrich-only path: this same file applied to a book that is already loaded, without any of
 * the other exports and without clearing anything.
 */
const refs = rows.map((r, i) => ({
  id: `acct-${i}`, swordfishReference: String(r['Swordfish Reference']).trim(), accountNumber: null,
}))
const e = planEnrichment(rows, refs)

console.log('\nEnrich-only against a loaded book:')
console.log(`  ${String(e.matched).padStart(6)}  accounts matched`)
console.log(`  ${String(e.patches.length).padStart(6)}  account patches`)
console.log(`  ${String(e.contacts.length).padStart(6)}  contacts`)
console.log(`  ${String(e.promises.length).padStart(6)}  promises`)
console.log(`  ${String(e.notes.length).padStart(6)}  comments`)
console.log(`  ${String(e.unmatched.length).padStart(6)}  unmatched`)

check('enrich matches every row when the book holds them all', e.matched === rows.length && e.unmatched.length === 0)
check('enrich produces the same contacts as the full import', e.contacts.length === s.contacts)
check('every patch names an account and at least one field',
  e.patches.every((p) => p.id && Object.keys(p).length > 1))
check('a patch never carries a null', e.patches.every((p) => Object.values(p).every((v) => v !== null && v !== undefined)),
  'a null would erase a value the other exports supplied')
check('every written row is marked as ours',
  [...e.contacts, ...e.promises, ...e.notes].every((r) => r.source === 'swordfish'),
  'source is what makes a re-run replace instead of duplicate')

/* Half a book: the other half must be reported, not silently skipped. */
const half = planEnrichment(rows, refs.slice(0, 400))
check('accounts missing from the book are reported', half.unmatched.length === rows.length - 400)
check('a partial match still applies to what it found', half.matched === 400)
check('untouched accounts are counted', planEnrichment(rows.slice(0, 100), refs).untouched === refs.length - 100)

console.log(failed === 0 ? '\nAll checks passed.\n' : `\n${failed} check(s) failed.\n`)
process.exit(failed ? 1 : 0)

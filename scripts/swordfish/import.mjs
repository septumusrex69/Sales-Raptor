/**
 * The Swordfish import, at the terminal.
 *
 * A thin shell around `src/lib/swordfishImport.ts`, which the Data Import screen in Settings uses
 * too. The transform lives there rather than here on purpose: two copies would mean the run you
 * check and the run you perform are different programs.
 *
 * What this adds over the screen is the reconciliation gate and a SQL file. Prefer the screen for
 * the real import — it writes as the signed-in administrator, so no service-role key has to exist
 * anywhere. Use this to check a set of exports before anyone touches the database.
 *
 *   node --experimental-strip-types scripts/swordfish/import.mjs \
 *     --summary <accounts.csv> --payments <payments.csv> \
 *     --actions <actions.csv> --interest <interest.csv> \
 *     --owner <profile uuid> --out ./out
 *
 * Add --wipe to have the generated SQL clear the book first. `--only <client>` restricts to one
 * client, for a trial on real data — and refuses to combine with --wipe, which would clear the
 * whole book to insert a fragment of it.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { parseCsv } from '../../src/lib/csv.ts'
import { buildImportPlan, planRows, IMPORT_TABLES, WIPE_TABLES } from '../../src/lib/swordfishImport.ts'

const HERE = path.dirname(new URL(import.meta.url).pathname)

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}
const flag = (name) => process.argv.includes(`--${name}`)
const money = (n) => `R${(n ?? 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const count = (n) => n.toLocaleString('en-ZA')

const paths = {
  summary: arg('summary'), payments: arg('payments'), actions: arg('actions'), interest: arg('interest'),
  // Optional: the client register. Without it clients come from swordfishClients.ts instead.
  clients: arg('clients'),
}
const ownerId = arg('owner')
const outDir = arg('out') ?? path.join(HERE, 'out')
const only = arg('only')
const doWipe = flag('wipe')

if (!paths.summary || !paths.payments || !paths.actions || !paths.interest) {
  console.error('All four exports are required: --summary --payments --actions --interest')
  process.exit(2)
}
if (!/^[0-9a-f-]{36}$/i.test(ownerId ?? '')) {
  // Deliberately not defaulted. Every client lands on somebody's desk, and a wrong default is
  // invisible: the import succeeds and 735 accounts quietly belong to the wrong person.
  console.error('--owner <profile uuid> is required — the Raptor user who owns the imported clients.')
  process.exit(2)
}
if (only && doWipe) {
  console.error('--wipe with --only would clear the whole book to insert a fragment of it. Refusing.')
  process.exit(2)
}

/* ------------------------------------------ gate: the dry run has to pass first */

console.log('Running reconcile.mjs as a gate...\n')
try {
  execFileSync(
    process.execPath,
    ['--experimental-strip-types', path.join(HERE, 'reconcile.mjs'),
      '--summary', paths.summary, '--payments', paths.payments,
      '--actions', paths.actions, '--interest', paths.interest],
    { stdio: 'inherit' },
  )
} catch {
  console.error('\nReconciliation failed. Nothing has been imported.')
  console.error('Fix the disagreement first — it means our model and Swordfish disagree about money.\n')
  process.exit(1)
}

/* ------------------------------------------------------------------ the plan */

const read = (p) => parseCsv(fs.readFileSync(p, 'utf8'))
const plan = buildImportPlan(
  {
    accounts: read(paths.summary), payments: read(paths.payments),
    actions: read(paths.actions), interest: read(paths.interest),
    clients: paths.clients ? read(paths.clients) : undefined,
  },
  { ownerId, only },
)
const rows = planRows(plan)
const { stats } = plan

if (only) console.log(`\n--only "${only}": ${count(plan.debtorAccounts.length)} accounts. This is a slice, not the book.`)

console.log('\nWHAT WOULD BE WRITTEN')
console.log(`  clients            ${count(plan.companies.length)}  (${plan.companies.filter((c) => c.parent_company_id).length} as children)`)
console.log(`  handover batches   ${count(plan.handovers.length)}`)
console.log(`  debtor accounts    ${count(plan.debtorAccounts.length)}   capital ${money(stats.capital)}`)
console.log(`  payments           ${count(plan.payments.length)}   ${money(stats.paid)}${stats.paidToClient ? `  (${stats.paidToClient} paid to client)` : ''}`)
console.log(`  fees               ${count(plan.fees.length)}   ${money(stats.feesInclVat)} incl VAT`)
console.log(`  interest accruals  ${count(plan.accruals.length)}   ${money(stats.interest)}`)
console.log()

console.log('COMMISSION')
console.log(`  ${stats.commissionDrift} accounts are billed at a rate their client's signed mandate does not allow.`)
console.log('  Imported at the billed rate, with the mandate rate beside it. Correcting them is a')
console.log('  business decision about accounts that have already been invoiced, not an import step.')
if (stats.commissionUnknown) console.log(`  ${stats.commissionUnknown} accounts have no rate at all — see the problems below.`)
console.log()

console.log('FEE CEILING')
console.log(`  ${count(stats.freeBillableActions)} billable actions carry no charge because the account had reached its`)
console.log('  Annexure B ceiling — items 1 to 7 may not exceed the capital or R1,225, whichever is')
console.log('  the lesser. They import as history, not as revenue that went missing.')
console.log()

if (plan.notes.length) { console.log('NOTES'); for (const n of plan.notes) console.log(`  - ${n}`); console.log() }
if (plan.problems.length) {
  console.log(`PROBLEMS (${plan.problems.length})`)
  for (const p of plan.problems.slice(0, 25)) console.log(`  ! ${p}`)
  if (plan.problems.length > 25) console.log(`  ... and ${plan.problems.length - 25} more, in ${path.join(outDir, 'problems.txt')}`)
  console.log()
}

/* ------------------------------------------------------------------ not-null */

/*
 * A null in a not-null column fails at write time, thousands of rows in, with a partial import to
 * unpick. It cost one trial run to learn that; this catches it here instead.
 *
 * Written out rather than read from the database because this has to work with no connection at
 * all — and because a column becoming not-null is exactly the change that should bring someone
 * to this list.
 */
const NOT_NULL = {
  companies: ['id', 'name', 'account_owner_id'],
  handovers: ['id', 'company_id', 'received_at', 'capital_amount'],
  debtor_accounts: ['id', 'company_id', 'capital_handed_over', 'capital_outstanding',
    'in_duplum_ceiling', 'interest_rate_annual', 'prescribed', 'status', 'in_duplum', 'source'],
  account_payments: ['id', 'account_id', 'received_at', 'amount', 'paid_to_client', 'source'],
  account_fees: ['id', 'account_id', 'description', 'amount_excl_vat', 'vat_rate', 'vat_amount',
    'counts_toward_fee_cap', 'incurred_at', 'source', 'segments', 'billed'],
  account_interest_accruals: ['id', 'account_id', 'accrued_on', 'days', 'opening_balance',
    'daily_rate', 'amount_accrued', 'amount_recoverable', 'capitalised', 'source'],
}

let violations = 0
for (const table of IMPORT_TABLES) {
  for (const col of NOT_NULL[table] ?? []) {
    const bad = rows[table].filter((r) => r[col] === null || r[col] === undefined).length
    if (!bad) continue
    violations++
    console.error(`  ${table}.${col} is null on ${bad} of ${rows[table].length} rows, and the column does not allow it.`)
  }
}
if (violations) {
  console.error('\nRefusing to write. Fix the mapping above; nothing has been imported.\n')
  process.exit(1)
}

/* ------------------------------------------------------------------- output */

fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'problems.txt'), plan.problems.join('\n') + '\n')

const q = (name) => `"${name.replace(/"/g, '""')}"`
const str = (s) => `'${s.replace(/'/g, "''")}'`
/** A SQL literal. Postgres, not JavaScript: undefined and NaN are both null, never 'undefined'. */
const lit = (v) => {
  if (v === undefined || v === null || (typeof v === 'number' && !Number.isFinite(v))) return 'null'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'object') return `${str(JSON.stringify(v))}::jsonb`
  return str(String(v))
}

const sql = ['-- Generated by scripts/swordfish/import.mjs. Do not edit by hand.',
  `-- ${new Date().toISOString()}`, 'begin;']
if (doWipe) {
  sql.push('', '-- Authorised wipe. profiles, teams and targets are configuration and are kept.')
  for (const t of WIPE_TABLES) sql.push(`delete from public.${t};`)
}
for (const table of IMPORT_TABLES) {
  const all = rows[table]
  if (!all.length) continue
  const cols = Object.keys(all[0])
  sql.push('', `-- ${table}: ${all.length} rows`)
  for (let i = 0; i < all.length; i += 500) {
    sql.push(`insert into public.${table} (${cols.map(q).join(', ')}) values`)
    sql.push(all.slice(i, i + 500).map((r) => `  (${cols.map((c) => lit(r[c])).join(', ')})`).join(',\n') + ';')
  }
}
sql.push('', 'commit;')

const sqlPath = path.join(outDir, 'import.sql')
fs.writeFileSync(sqlPath, sql.join('\n') + '\n')
console.log(`SQL written to ${sqlPath} (${(fs.statSync(sqlPath).size / 1e6).toFixed(1)} MB)`)
console.log('\nNothing was written to the database. To import, use Settings -> Data Import,')
console.log('which writes as the signed-in administrator and needs no service-role key.\n')
process.exit(plan.problems.length ? 3 : 0)

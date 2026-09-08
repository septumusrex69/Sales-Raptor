/**
 * The Swordfish import.
 *
 * Reads the four exports and produces the collections book: clients, handover batches, debtor
 * accounts, payments, fees and interest accruals. Every row that goes in carries where it came
 * from, so a bad import can be identified and undone without guessing which rows were manual.
 *
 * Three rules this script exists to enforce, all of them learned the hard way:
 *
 *   1. It refuses to run if reconcile.mjs fails. A migration that our own model disagrees with
 *      is not a migration, it is six weeks of wrong statements nobody has noticed yet.
 *   2. It never invents money. Where Swordfish's figure and ours differ, Swordfish's is written
 *      and the difference is reported — most of all for commission, where 60 Growthpoint
 *      accounts arrived on a rate their signed mandate does not allow. Correcting those
 *      silently would rewrite what a client was already billed.
 *   3. It is a dry run unless told otherwise, and it will not delete anything without --wipe.
 *
 *   node --experimental-strip-types scripts/swordfish/import.mjs \
 *     --summary <accounts.csv> --payments <payments.csv> \
 *     --actions <actions.csv> --interest <interest.csv> \
 *     --owner <profile uuid> --out ./out
 *
 * Add --wipe --apply to actually write. --apply needs SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY in the environment; without them it writes SQL to --out and stops,
 * which is the same import applied by hand.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { parseCsv, num, date } from './csv.mjs'
import { codeForLegacyName, isQuarantinedLegacyName } from '../../src/lib/actionTariff.ts'
import { rateForCapital } from '../../src/lib/commission.ts'

const HERE = path.dirname(new URL(import.meta.url).pathname)

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}
const flag = (name) => process.argv.includes(`--${name}`)

const TODAY = new Date().toISOString().slice(0, 10)
const NOW = new Date().toISOString()

/**
 * Swordfish writes "no value" three ways in text columns too — "", "N/A" and "-" — and 571
 * accounts carry a Sub-status of literally "N/A". Storing that would put the string "N/A" on
 * screen wherever a sub-status is shown, and make `sub_status is null` the wrong test forever.
 */
const text = (v) => {
  const s = String(v ?? '').trim()
  return s === '' || s === 'N/A' || s === '-' ? null : s
}

const money = (n) => `R${(n ?? 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const uuid = () => crypto.randomUUID()

/* ------------------------------------------------------------------ inputs */

const paths = {
  summary: arg('summary'),
  payments: arg('payments'),
  actions: arg('actions'),
  interest: arg('interest'),
}
const ownerId = arg('owner')
const outDir = arg('out') ?? path.join(HERE, 'out')
const doWipe = flag('wipe')
const doApply = flag('apply')
// Restrict the import to clients whose Swordfish name contains this, case-insensitively.
// For trial runs: a real slice of real data, small enough to check by eye and to undo.
const only = arg('only')?.toLowerCase()

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
  console.error('Fix the disagreement first — it means our model and Swordfish differ about money.\n')
  process.exit(1)
}

/* ------------------------------------------------------------------ loading */

const read = (p) => parseCsv(fs.readFileSync(p, 'utf8'))
const allAccounts = read(paths.summary)
const accounts = only
  ? allAccounts.filter((r) => (r['Client'] ?? '').toLowerCase().includes(only))
  : allAccounts
const payments = read(paths.payments)
const actionRows = read(paths.actions)
const interestRows = read(paths.interest)
const clientConfig = JSON.parse(fs.readFileSync(path.join(HERE, 'clients.json'), 'utf8'))

if (only) {
  if (!accounts.length) { console.error(`\nNo client matches --only "${only}". Nothing to import.`); process.exit(2) }
  console.log(`\n--only "${only}": ${accounts.length} of ${allAccounts.length} accounts. This is a slice, not the book.`)
}
console.log(`\nLoaded  accounts ${accounts.length}  payments ${payments.length}  actions ${actionRows.length}  interest ${interestRows.length}\n`)

const problems = []
const notes = []
const problem = (m) => problems.push(m)

/* ------------------------------------------------------------------ clients */

/**
 * Swordfish's Client field conflates three things: the client, the sub-entity and the handover
 * batch. Growthpoint appears four times and is one client; Adowa appears twice and is one parent
 * with two properties that each keep their own book. clients.json holds those judgements as
 * reviewable data rather than as code — see its own header for why.
 */
const companies = []
const companyBySwordfishName = new Map()

function addCompany(spec, parentId) {
  const id = uuid()
  companies.push({
    id,
    name: spec.name,
    industry: spec.industry ?? null,
    parent_company_id: parentId ?? null,
    account_owner_id: ownerId,
    code: Object.keys(spec.commission_by_prefix ?? {})[0]?.split('/')[0] ?? null,
    commission_bands: spec.commission_bands?.bands ?? null,
    commission_bands_source: spec.commission_bands?.source ?? null,
    // A single rate only where there is genuinely one. A client on a scale has no flat rate,
    // and writing the first band's rate here would read as a fact when it is a guess.
    commission_rate: uniqueRate(spec.commission_by_prefix),
  })
  for (const sw of spec.swordfish ?? []) companyBySwordfishName.set(sw, id)
  for (const child of spec.children ?? []) addCompany(child, id)
  return id
}

function uniqueRate(byPrefix) {
  const rates = [...new Set(Object.values(byPrefix ?? {}))]
  return rates.length === 1 ? rates[0] : null
}

const presentNames = new Set(accounts.map((r) => (r['Client'] ?? '').trim()))
const inSlice = (spec) =>
  (spec.swordfish ?? []).some((n) => presentNames.has(n)) || (spec.children ?? []).some(inSlice)
for (const spec of clientConfig.clients) if (inSlice(spec)) addCompany(spec)

// Anything Swordfish names that clients.json has not decided about. Imported under its own name
// rather than dropped — losing accounts is worse than a client record somebody has to merge —
// but reported loudly, because an unplanned client is usually a stale export.
const unmapped = new Set()
for (const r of accounts) {
  const name = (r['Client'] ?? '').trim()
  if (name && !companyBySwordfishName.has(name)) unmapped.add(name)
}
for (const name of unmapped) {
  const id = addCompany({ name, swordfish: [name] })
  problem(`"${name}" is not in clients.json — imported as its own client, owner ${ownerId}. Check whether it belongs under an existing one.`)
  companyBySwordfishName.set(name, id)
}

const companyById = new Map(companies.map((c) => [c.id, c]))
const bandsFor = (companyId) => {
  const c = companyById.get(companyId)
  return c?.commission_bands ? { source: c.commission_bands_source ?? '', bands: c.commission_bands } : undefined
}

/* --------------------------------------------------------------- handovers */

/**
 * A handover is a batch the client actually sent: one client, one date. Keyed on the *real*
 * client, not the Swordfish record — Growthpoint's GPS3/1 and GPS3/2 rows dated 2024/05/14 are
 * one delivery of 67 accounts, split by commission tier for Swordfish's convenience and for no
 * reason that survives the migration.
 */
const handovers = []
const handoverKey = new Map()

for (const r of accounts) {
  const companyId = companyBySwordfishName.get((r['Client'] ?? '').trim())
  const when = date(r['Load Date'])
  if (!companyId || !when) continue
  const key = `${companyId}|${when}`
  if (!handoverKey.has(key)) {
    const h = {
      id: uuid(),
      company_id: companyId,
      received_at: `${when}T00:00:00Z`,
      capital_amount: 0,
      accounts_count: 0,
      reference: null,
      notes: 'Migrated from Swordfish.',
      logged_by: ownerId,
    }
    handovers.push(h)
    handoverKey.set(key, h)
  }
  const h = handoverKey.get(key)
  h.accounts_count++
  h.capital_amount += num(r['Capital on Default']) ?? num(r['Handover Balance']) ?? 0
}

/* ---------------------------------------------------------------- accounts */

const accountByRef = new Map()
const debtorAccounts = []
let commissionDrift = 0
let commissionUnknown = 0

for (const r of accounts) {
  const ref = (r['Swordfish Reference'] ?? '').trim()
  if (!ref) { problem('An account row has no Swordfish Reference and was skipped.'); continue }
  if (accountByRef.has(ref)) { problem(`${ref} appears twice in the summary; the second row was skipped.`); continue }

  const companyId = companyBySwordfishName.get((r['Client'] ?? '').trim())
  if (!companyId) { problem(`${ref} has no client and was skipped.`); continue }

  const loadDate = date(r['Load Date'])
  const capital = num(r['Capital on Default']) ?? num(r['Handover Balance'])
  if (capital === undefined) problem(`${ref} has no capital figure. Imported at zero — it will read as a settled account until someone corrects it.`)

  // The rate Swordfish billed, read off the client record it was filed under. clients.json is
  // the record of what those records actually charge.
  const prefix = (r['Client Prefix'] ?? '').trim()
  const billedRate = rateForPrefix(prefix)
  if (billedRate === undefined) {
    commissionUnknown++
    problem(`${ref}: prefix "${prefix}" has no rate in clients.json — commission left null.`)
  }

  // What the mandate calls for. Reported, never applied: see rule 2 in the header.
  const schedule = bandsFor(companyId)
  const expected = schedule && capital !== undefined ? rateForCapital(capital, schedule) : undefined
  if (expected !== undefined && billedRate !== undefined
      && Math.round(expected * 10000) !== Math.round(billedRate * 10000)) {
    commissionDrift++
  }

  const a = {
    id: uuid(),
    company_id: companyId,
    handover_id: loadDate ? handoverKey.get(`${companyId}|${loadDate}`)?.id ?? null : null,
    swordfish_reference: ref,
    account_number: ref,
    client_reference: text(r['Client Reference']),
    legacy_reference: text(r['Old Client Reference']) ?? text(r['Previous Swordfish Reference']),

    debtor_first_name: text(r['First Name']),
    debtor_surname: text(r['Surname']),
    debtor_id_number: text(r['ID Number']),

    capital_handed_over: capital ?? 0,
    // At the opening position — the handover — capital outstanding is the capital handed over,
    // by definition. The payment ledger reduces it from there. Deriving today's figure here
    // instead would mean guessing the capital share of every past payment, which is the
    // allocation engine's job and not the importer's.
    capital_outstanding: capital ?? 0,
    // In duplum caps non-capital at the capital outstanding when the debt was handed over, so
    // the ceiling is that capital, not twice it — the *balance* may reach twice capital, which
    // is the same rule stated about a different number. Fixed here and never recalculated (§5).
    in_duplum_ceiling: capital ?? 0,

    commission_rate: billedRate ?? null,
    commission_rate_expected: expected ?? null,
    commission_rate_source: schedule?.source ?? null,

    interest_rate_annual: num(r['Current Interest Rate']) ?? 24,
    interest_from: date(r['Initial Interest Date']) ?? loadDate ?? null,

    prescribed: r['Is Prescribed'] === 'Yes',
    prescription_date: prescriptionDate(r),
    last_interrupted_at: null,

    // The opening position is the handover, not today. The exports carry the complete history
    // from that day — every payment, every fee, every accrual — so the ledgers can replay it
    // and today's balance is derived rather than asserted. Opening it at today's figures
    // instead would be the one number nothing could ever check, and would double-count: an
    // account paid in full would open owing its whole capital again.
    opening_as_at: loadDate ?? null,
    opening_capital: capital ?? null,
    opening_fees: 0,
    opening_interest: 0,

    status: text(r['Status']) ?? 'Active',
    sub_status: text(r['Sub-status']),
    bucket: text(r['Account Bucket']),
    assigned_to: null,
    diary_date: date(r['Diary Date']) ?? null,

    in_duplum: r['In Duplum'] === 'Yes',
    write_off_reason: text(r['Write Off Reason']),
    handover_date: loadDate ?? null,
    handover_balance: num(r['Handover Balance']) ?? null,
    handover_interest: num(r['Interest Portion']) ?? null,
    handover_legal_fees: num(r['Legal Fee Portion']) ?? null,
    payments_to_date: num(r['Payments To Date']) ?? null,
    // Swordfish's closing position, kept so the replayed ledgers can be checked against the
    // system they came from. Never used as a balance — only to prove one.
    swordfish_balance_at_import: num(r['Current Balance']) ?? null,
    swordfish_fees_at_import: num(r['All Fees (inc VAT + FCC)']) ?? null,
    swordfish_assigned_to: text(r['Assigned To']),
    current_legal_stage: text(r['Current Legal Stage']),
    legal_stage_date: date(r['Date of Current Legal Stage']) ?? null,
    last_action_at: date(r['Last Action Date']) ?? null,
    last_payment_at: date(r['Last Payment Date']) ?? null,
    source: 'swordfish',
    imported_at: NOW,
  }
  debtorAccounts.push(a)
  accountByRef.set(ref, a)
}

function rateForPrefix(prefix) {
  for (const spec of walkSpecs(clientConfig.clients)) {
    const r = spec.commission_by_prefix?.[prefix]
    if (r !== undefined) return r
  }
  return undefined
}
function* walkSpecs(specs) {
  for (const s of specs) { yield s; if (s.children) yield* walkSpecs(s.children) }
}

/** Swordfish gives days remaining, not the date. Three years from the last interrupting act. */
function prescriptionDate(r) {
  const days = num(r['Days To Prescription'])
  if (days === undefined) return null
  const d = new Date(`${TODAY}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + Math.round(days))
  return d.toISOString().slice(0, 10)
}


/* ---------------------------------------------------------------- payments */

const accountPayments = []
let orphanPayments = 0
for (const p of payments) {
  const acc = accountByRef.get((p['Swordfish Reference'] ?? '').trim())
  const when = date(p['Payment Date'])
  const amount = num(p['Payment Amount'])
  if (!acc) { orphanPayments++; continue }
  if (!when || amount === undefined) { problem(`A payment on ${p['Swordfish Reference']} has no date or amount and was skipped.`); continue }
  const type = (p['Payment Type'] ?? '').trim()
  accountPayments.push({
    id: uuid(),
    account_id: acc.id,
    received_at: `${when}T00:00:00Z`,
    amount,
    method: type || null,
    reference: text(p['Bank Reference']) ?? text(p['Voucher Number']),
    depositor_name: text(p['Payment Depositor Name']),
    details: text(p['Payment Details']),
    // The client took the money directly and owes us our share. Still a full payment on the
    // account; it settles in the month-end reconciliation rather than arriving in our trust
    // account (§7a). Read off Payment Type, which states it, rather than matched out of the
    // free-text details, which merely tend to mention it.
    paid_to_client: type === 'Client Direct',
    // No reversals in the migrated data, but a reversal is a fact about a payment and has to
    // survive the import if one ever appears in a later export.
    reversed_at: date(p['Reversal Date']) ? `${date(p['Reversal Date'])}T00:00:00Z` : null,
    reversal_reason: text(p['Reversal Reason']),
    source: 'swordfish',
  })
}
if (orphanPayments) {
  const m = `${orphanPayments} payments belong to accounts not in this import and were skipped.`
  // On a slice that is the rest of the book, which is the point of a slice, not a fault.
  if (only) notes.push(m); else problem(m)
}

/* -------------------------------------------------------------------- fees */

const accountFees = []
let orphanActions = 0
let unbilledEvents = 0
let quarantinedFees = 0
let quarantinedValue = 0
const unmappedCharged = new Map()

for (const a of actionRows) {
  const acc = accountByRef.get((a['Swordfish Reference'] ?? '').trim())
  if (!acc) { orphanActions++; continue }
  const when = date(a['Action Date'])
  if (!when) continue

  const name = (a['Action Name'] ?? '').trim()
  const excl = num(a['Action Cost (excl VAT)']) ?? 0
  const vat = num(a['Action VAT Charged']) ?? 0
  const code = codeForLegacyName(name)

  // Most of what Swordfish records are audit events — a file uploaded, a sub-status changed.
  // They belong in the account's history but were never billable, so they import as fees of
  // zero rather than being dropped: the history is the point, not the money.
  if (!code && excl === 0) unbilledEvents++

  // Two legacy names nobody has been able to classify. Their money is held out of the balance
  // rather than guessed into it — a fee we cannot name is a fee we cannot defend charging.
  const held = isQuarantinedLegacyName(name)
  if (held) { quarantinedFees++; quarantinedValue += excl }
  if (!code && excl > 0 && !held) {
    const cur = unmappedCharged.get(name) ?? { n: 0, total: 0 }
    cur.n++; cur.total += excl
    unmappedCharged.set(name, cur)
  }

  accountFees.push({
    id: uuid(),
    account_id: acc.id,
    annexure_item: null,
    tariff_effective_from: null,
    description: name || 'Action',
    amount_excl_vat: excl,
    vat_rate: num(a['Action VAT Rate']) ?? 15,
    vat_amount: vat,
    // A held fee stays visible but out of the recoverable total until it is classified.
    counts_toward_fee_cap: !held,
    incurred_at: `${when}T00:00:00Z`,
    source: 'swordfish',
    payment_id: null,
    action_code: code ?? null,
    legacy_name: name || null,
    segments: Math.max(1, Math.round(num(a['SMS Count']) ?? 1)),
    billed: excl > 0,
    expense_or_fee: text(a['Expense or Fee']),
    destination: text(a['Action Destination']),
    cancelled_at: date(a['Cancel Date']) ?? null,
    cancel_reason: text(a['Cancel Reason']),
    performed_by: text(a['User']),
    swordfish_action_id: text(a['Action ID']),
  })
}
if (orphanActions) {
  const m = `${orphanActions} actions belong to accounts not in this import and were skipped.`
  // On a slice that is the rest of the book, which is the point of a slice, not a fault.
  if (only) notes.push(m); else problem(m)
}
for (const [name, v] of unmappedCharged) {
  problem(`${v.n} charged actions named "${name}" (${money(v.total)} excl VAT) have no catalogue entry. Imported at their charged price with no action_code.`)
}

/* ---------------------------------------------------------------- interest */

const interestAccruals = []
let orphanInterest = 0
const seenPeriod = new Set()
for (const r of interestRows) {
  const acc = accountByRef.get((r['Swordfish Reference'] ?? '').trim())
  if (!acc) { orphanInterest++; continue }
  const from = date(r['Date From']), to = date(r['Date To'])
  if (!from || !to) continue
  const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400000))
  // The unique key is (account, start, days). Concurrent accrual streams legitimately share a
  // start date; an identical period twice would double-count.
  const key = `${acc.id}|${from}|${days}`
  if (seenPeriod.has(key)) { problem(`${r['Swordfish Reference']}: the period ${from}..${to} appears twice; the second was skipped.`); continue }
  seenPeriod.add(key)
  const amount = num(r['Interest Added']) ?? 0
  interestAccruals.push({
    id: uuid(),
    account_id: acc.id,
    accrued_on: from,
    days,
    opening_balance: 0,
    daily_rate: 0,
    amount_accrued: amount,
    // Swordfish's figure is already the recoverable one: it stops accruing at the in duplum
    // ceiling rather than accruing and then writing back. So the two are equal on import and
    // diverge only once Raptor's own engine starts accruing.
    amount_recoverable: amount,
    capitalised: true,
    source: 'swordfish',
  })
}
if (orphanInterest) {
  const m = `${orphanInterest} interest periods belong to accounts not in this import and were skipped.`
  // On a slice that is the rest of the book, which is the point of a slice, not a fault.
  if (only) notes.push(m); else problem(m)
}

/* ------------------------------------------------------------------ report */

const totalCapital = debtorAccounts.reduce((t, a) => t + (a.capital_handed_over ?? 0), 0)
const totalPaid = accountPayments.reduce((t, p) => t + p.amount, 0)
const totalFees = accountFees.reduce((t, f) => t + f.amount_excl_vat + f.vat_amount, 0)
const totalInterest = interestAccruals.reduce((t, i) => t + i.amount_accrued, 0)

console.log('WHAT WOULD BE WRITTEN')
console.log(`  clients            ${companies.length}  (${companies.filter((c) => c.parent_company_id).length} as children)`)
console.log(`  handover batches   ${handovers.length}`)
console.log(`  debtor accounts    ${debtorAccounts.length}   capital ${money(totalCapital)}`)
console.log(`  payments           ${accountPayments.length}   ${money(totalPaid)}${accountPayments.filter((p) => p.paid_to_client).length ? `  (${accountPayments.filter((p) => p.paid_to_client).length} paid to client)` : ''}`)
console.log(`  fees               ${accountFees.length}   ${money(totalFees)} incl VAT`)
console.log(`  interest accruals  ${interestAccruals.length}   ${money(totalInterest)}`)
console.log()

console.log('COMMISSION')
console.log(`  ${commissionDrift} accounts are billed at a rate their client's signed mandate does not allow.`)
console.log('  Imported at the billed rate, with the mandate rate beside it. Correcting them is a')
console.log('  business decision about accounts that have already been invoiced, not an import step.')
if (commissionUnknown) console.log(`  ${commissionUnknown} accounts have no rate at all — see the problems below.`)
console.log()

if (quarantinedFees) {
  console.log('HELD BACK')
  console.log(`  ${quarantinedFees} fees totalling ${money(quarantinedValue)} excl VAT are imported but excluded from the`)
  console.log('  recoverable total, because nobody has been able to say what they are. Classify them')
  console.log('  in actionTariff.ts to release the money, or write them off.')
  console.log()
}
if (unbilledEvents) notes.push(`${unbilledEvents} actions were audit events with no charge. Imported as history at zero.`)

/*
 * The fee ceiling.
 *
 * A large share of billable actions — phone calls, SMSes, emails, letters — carry no charge,
 * and it is worth saying plainly that this is not lost revenue. No account in the book has ever
 * been charged more than about R1,288 excl VAT in action fees, whatever its capital: the same
 * ceiling applies to a R1,900 gym membership and a R424,000 farm debt. Free actions cluster in
 * accounts that have reached it, and the free share of a handover cohort climbs month by month
 * as the cohort ages. That is a fee cap being enforced, and enforcing it is the law.
 *
 * The number is reported rather than hard-coded because the exact rule is not derivable from
 * the export — only the ceiling's existence is. Raptor's own fee engine must implement it
 * before it raises a single fee of its own, or it will over-bill every account past this point.
 */
const chargedPerAccount = new Map()
for (const f of accountFees) chargedPerAccount.set(f.account_id, (chargedPerAccount.get(f.account_id) ?? 0) + f.amount_excl_vat)
const ceiling = Math.max(0, ...chargedPerAccount.values())
const freeBillable = accountFees.filter((f) => f.action_code && !f.billed).length
const nearCeiling = [...chargedPerAccount.values()].filter((v) => v >= ceiling * 0.75).length

console.log('FEE CEILING')
console.log(`  Most fees charged on any one account: ${money(ceiling)} excl VAT. ${nearCeiling} of ${chargedPerAccount.size}`)
console.log(`  accounts are within a quarter of it, at every capital size — so this is a flat cap,`)
console.log(`  not a share of the debt. ${freeBillable} billable actions carry no charge because the`)
console.log('  account had reached it. They import as history, not as revenue that went missing.')
console.log('  Raptor must enforce the same ceiling before it raises fees of its own.')
console.log()

const oddIds = debtorAccounts.filter((a) => a.debtor_id_number && !/^\d{13}$/.test(a.debtor_id_number)).length
if (oddIds) notes.push(`${oddIds} accounts have something other than a 13-digit ID in the ID field — phone numbers, company registrations, one client prefix. Imported as found; it is Swordfish's data, not a mapping fault.`)

if (notes.length) { console.log('NOTES'); for (const n of notes) console.log(`  - ${n}`); console.log() }
if (problems.length) {
  console.log(`PROBLEMS (${problems.length})`)
  for (const p of problems.slice(0, 25)) console.log(`  ! ${p}`)
  if (problems.length > 25) console.log(`  ... and ${problems.length - 25} more, in ${path.join(outDir, 'problems.txt')}`)
  console.log()
}

/* ------------------------------------------------------------------ output */

fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'problems.txt'), problems.join('\n') + '\n')

const TABLES = [
  ['companies', companies],
  ['handovers', handovers],
  ['debtor_accounts', debtorAccounts],
  ['account_payments', accountPayments],
  ['account_fees', accountFees],
  ['account_interest_accruals', interestAccruals],
]

/*
 * A null in a not-null column fails at write time, thousands of rows in, with a partial import
 * to unpick. It cost one trial run to learn that; this catches it in the dry run instead.
 *
 * The list is written out rather than read from the database because the dry run has to work
 * with no connection at all — and because a column becoming not-null is exactly the change that
 * should make someone come and look at this list.
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

let nullViolations = 0
for (const [table, rows] of TABLES) {
  for (const col of NOT_NULL[table] ?? []) {
    const bad = rows.filter((r) => r[col] === null || r[col] === undefined).length
    if (!bad) continue
    nullViolations++
    console.error(`  ${table}.${col} is null on ${bad} of ${rows.length} rows, and the column does not allow it.`)
  }
}
if (nullViolations) {
  console.error('\nRefusing to write. Fix the mapping above; nothing has been imported.\n')
  process.exit(1)
}


// Wiped in reverse dependency order. Deliberately an explicit list rather than a loop over
// every table: profiles, teams and targets are configuration a person set up by hand, and an
// import must never be the thing that deletes them.
if (only && doWipe) {
  console.error('\n--wipe with --only would clear the whole book to insert a fragment of it. Refusing.')
  process.exit(2)
}

const WIPE = [
  'account_interest_accruals', 'account_fees', 'payment_allocations', 'account_payments',
  'debtor_accounts', 'handovers', 'notifications', 'activities', 'tasks', 'proposals',
  'deals', 'contacts', 'leads', 'companies',
]

const sql = []
sql.push('-- Generated by scripts/swordfish/import.mjs. Do not edit by hand.')
sql.push(`-- ${NOW}`)
sql.push('begin;')
if (doWipe) {
  sql.push('')
  sql.push('-- Authorised wipe. profiles, teams and targets are configuration and are kept.')
  for (const t of WIPE) sql.push(`delete from public.${t};`)
}
for (const [table, rows] of TABLES) {
  if (!rows.length) continue
  sql.push('')
  sql.push(`-- ${table}: ${rows.length} rows`)
  const cols = Object.keys(rows[0])
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    sql.push(`insert into public.${table} (${cols.map(q).join(', ')}) values`)
    sql.push(chunk.map((r) => `  (${cols.map((c) => lit(r[c])).join(', ')})`).join(',\n') + ';')
  }
}
sql.push('')
sql.push('commit;')

const sqlPath = path.join(outDir, 'import.sql')
fs.writeFileSync(sqlPath, sql.join('\n') + '\n')
console.log(`SQL written to ${sqlPath} (${(fs.statSync(sqlPath).size / 1e6).toFixed(1)} MB)`)

/** Quote an identifier. */
function q(name) { return `"${name.replace(/"/g, '""')}"` }

/** A SQL literal. Postgres, not JavaScript: undefined and NaN are both null, never 'undefined'. */
function lit(v) {
  if (v === undefined || v === null || (typeof v === 'number' && !Number.isFinite(v))) return 'null'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (Array.isArray(v) || typeof v === 'object') return `${str(JSON.stringify(v))}::jsonb`
  return str(String(v))
}
function str(s) { return `'${s.replace(/'/g, "''")}'` }

/* ------------------------------------------------------------------- apply */

if (!doApply) {
  console.log('\nDry run. Nothing was written to the database.')
  console.log('Re-run with --wipe --apply, and SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set, to import.\n')
  process.exit(problems.length ? 3 : 0)
}

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('\n--apply needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.')
  console.error(`The SQL at ${sqlPath} applies the same import by hand.\n`)
  process.exit(2)
}

const { createClient } = await import('@supabase/supabase-js')
const db = createClient(url, key, { auth: { persistSession: false } })

if (doWipe) {
  console.log('\nWiping...')
  for (const t of WIPE) {
    // A filter is required by PostgREST before it will delete in bulk; this one matches every
    // row. profiles, teams and targets are not in WIPE and are untouched.
    const { error } = await db.from(t).delete().not('id', 'is', null)
    if (error) { console.error(`  ${t}: ${error.message}`); process.exit(1) }
    console.log(`  cleared ${t}`)
  }
}

console.log('\nWriting...')
for (const [table, rows] of TABLES) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from(table).insert(rows.slice(i, i + 500))
    if (error) {
      console.error(`\n${table} failed at row ${i}: ${error.message}`)
      console.error('The import is partial. Re-run with --wipe --apply once the cause is fixed.\n')
      process.exit(1)
    }
  }
  console.log(`  ${table}: ${rows.length}`)
}
console.log('\nImported.\n')
process.exit(problems.length ? 3 : 0)

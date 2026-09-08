/**
 * The Swordfish migration, as a pure transform.
 *
 * Lives here rather than in the migration script because it has two callers that must never
 * disagree: `scripts/swordfish/import.mjs` for a dry run at the terminal, and the Data Import
 * screen in Settings for the real thing. Two copies of this logic would mean the run you check
 * and the run you perform are different programs.
 *
 * Nothing here touches a network, a file or a clock beyond `now` — the whole thing is exports
 * in, rows out, so it can be checked without a database.
 *
 * Three rules it exists to enforce:
 *
 *   1. **It never invents money.** Where Swordfish's figure and ours differ, Swordfish's is
 *      written and the difference is reported — most of all for commission, where 60 Growthpoint
 *      accounts arrived on a rate their signed mandate does not allow. Correcting those silently
 *      would rewrite what a client has already been invoiced.
 *   2. **The opening position is the handover, not today.** The exports carry complete history
 *      from the day each account arrived, so the ledgers replay it and today's balance is
 *      derived. Opening at today's figures would be the one number nothing could ever check —
 *      and would double-count: an account paid in full would open owing its whole capital again.
 *   3. **Nothing is dropped silently.** An action nobody can price still imports as history; a
 *      client not in the configuration still imports, under its own name, loudly.
 */
import { num, isoDate, text, type CsvRow } from './csv.ts'
import { codeForLegacyName, isQuarantinedLegacyName } from './actionTariff.ts'
import { rateForCapital, type CommissionSchedule } from './commission.ts'
import { SWORDFISH_CLIENTS, type SwordfishClientSpec } from './swordfishClients.ts'

export interface SwordfishExports {
  accounts: CsvRow[]
  payments: CsvRow[]
  actions: CsvRow[]
  interest: CsvRow[]
}

export interface CompanyRow {
  id: string
  name: string
  industry: string | null
  parent_company_id: string | null
  account_owner_id: string
  code: string | null
  commission_bands: { upTo: number | null; rate: number }[] | null
  commission_bands_source: string | null
  commission_rate: number | null
}

export interface HandoverRow {
  id: string
  company_id: string
  received_at: string
  capital_amount: number
  accounts_count: number
  reference: string | null
  notes: string
  logged_by: string
}

export interface DebtorAccountRow {
  id: string
  company_id: string
  handover_id: string | null
  swordfish_reference: string
  account_number: string
  client_reference: string | null
  legacy_reference: string | null
  debtor_first_name: string | null
  debtor_surname: string | null
  debtor_id_number: string | null
  capital_handed_over: number
  capital_outstanding: number
  in_duplum_ceiling: number
  commission_rate: number | null
  commission_rate_expected: number | null
  commission_rate_source: string | null
  interest_rate_annual: number
  interest_from: string | null
  prescribed: boolean
  prescription_date: string | null
  last_interrupted_at: string | null
  opening_as_at: string | null
  opening_capital: number
  opening_fees: number
  opening_interest: number
  status: string
  sub_status: string | null
  bucket: string | null
  assigned_to: string | null
  diary_date: string | null
  in_duplum: boolean
  write_off_reason: string | null
  handover_date: string | null
  handover_balance: number | null
  handover_interest: number | null
  handover_legal_fees: number | null
  payments_to_date: number | null
  swordfish_balance_at_import: number | null
  swordfish_fees_at_import: number | null
  swordfish_assigned_to: string | null
  current_legal_stage: string | null
  legal_stage_date: string | null
  last_action_at: string | null
  last_payment_at: string | null
  source: string
  imported_at: string
}

export interface PaymentRow {
  id: string
  account_id: string
  received_at: string
  amount: number
  method: string | null
  reference: string | null
  depositor_name: string | null
  details: string | null
  paid_to_client: boolean
  reversed_at: string | null
  reversal_reason: string | null
  source: string
}

export interface FeeRow {
  id: string
  account_id: string
  annexure_item: string | null
  tariff_effective_from: string | null
  description: string
  amount_excl_vat: number
  vat_rate: number
  vat_amount: number
  counts_toward_fee_cap: boolean
  incurred_at: string
  source: string
  payment_id: string | null
  action_code: string | null
  legacy_name: string | null
  segments: number
  billed: boolean
  expense_or_fee: string | null
  destination: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  performed_by: string | null
  swordfish_action_id: string | null
}

export interface AccrualRow {
  id: string
  account_id: string
  accrued_on: string
  days: number
  opening_balance: number
  daily_rate: number
  amount_accrued: number
  amount_recoverable: number
  capitalised: boolean
  source: string
}

export interface ImportPlan {
  companies: CompanyRow[]
  handovers: HandoverRow[]
  debtorAccounts: DebtorAccountRow[]
  payments: PaymentRow[]
  fees: FeeRow[]
  accruals: AccrualRow[]
  /** Things that need a person's attention. A plan with problems still imports; it just says so. */
  problems: string[]
  /** Things worth knowing that are not faults. */
  notes: string[]
  stats: {
    capital: number
    paid: number
    paidToClient: number
    feesInclVat: number
    interest: number
    commissionDrift: number
    commissionUnknown: number
    feeCeilingHit: number
    freeBillableActions: number
    unbilledEvents: number
  }
}

export interface BuildOptions {
  /** The Raptor user who will own every imported client. Never defaulted — see the UI. */
  ownerId: string
  /** Restrict to clients whose Swordfish name contains this. For a trial run on real data. */
  only?: string
  now?: Date
}

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : // Node 18 and jsdom both have randomUUID; this is only a guard so the module never throws.
      `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 14)}`

function* walk(specs: SwordfishClientSpec[]): Generator<SwordfishClientSpec> {
  for (const s of specs) { yield s; if (s.children) yield* walk(s.children) }
}

export function buildImportPlan(exports: SwordfishExports, options: BuildOptions): ImportPlan {
  const { ownerId, only: onlyRaw, now = new Date() } = options
  const only = onlyRaw?.toLowerCase()
  const nowIso = now.toISOString()
  const today = nowIso.slice(0, 10)

  const problems: string[] = []
  const notes: string[] = []
  const problem = (m: string) => problems.push(m)

  const specs = SWORDFISH_CLIENTS
  const accounts = only
    ? exports.accounts.filter((r) => (r['Client'] ?? '').toLowerCase().includes(only))
    : exports.accounts

  /* ---------------------------------------------------------------- clients */

  /*
   * Swordfish's Client field conflates three things: the client, the sub-entity and the handover
   * batch. Growthpoint appears four times and is one client; Adowa appears twice and is one
   * parent with two properties that each keep their own book. swordfishClients.json holds those
   * judgements as reviewable data rather than as code — see its own header for why.
   */
  const companies: CompanyRow[] = []
  const companyBySwordfishName = new Map<string, string>()

  const uniqueRate = (byPrefix?: Record<string, number>) => {
    const rates = [...new Set(Object.values(byPrefix ?? {}))]
    return rates.length === 1 ? rates[0] : null
  }

  function addCompany(spec: SwordfishClientSpec, parentId?: string): string {
    const id = newId()
    companies.push({
      id,
      name: spec.name,
      industry: spec.industry ?? null,
      parent_company_id: parentId ?? null,
      account_owner_id: ownerId,
      code: Object.keys(spec.commissionByPrefix ?? {})[0]?.split('/')[0] ?? null,
      commission_bands: spec.commissionBands?.bands ?? null,
      commission_bands_source: spec.commissionBands?.source ?? null,
      // A single rate only where there is genuinely one. A client on a scale has no flat rate,
      // and writing the first band's rate here would read as a fact when it is a guess.
      commission_rate: uniqueRate(spec.commissionByPrefix),
    })
    for (const sw of spec.swordfish ?? []) companyBySwordfishName.set(sw, id)
    for (const child of spec.children ?? []) addCompany(child, id)
    return id
  }

  const present = new Set(accounts.map((r) => (r['Client'] ?? '').trim()))
  const inSlice = (spec: SwordfishClientSpec): boolean =>
    (spec.swordfish ?? []).some((n) => present.has(n)) || (spec.children ?? []).some(inSlice)
  for (const spec of specs) if (!only || inSlice(spec)) addCompany(spec)

  // Anything Swordfish names that the configuration has not decided about. Imported under its own
  // name rather than dropped — losing accounts is worse than a client record somebody has to
  // merge — but reported loudly, because an unplanned client is usually a stale export.
  for (const name of present) {
    if (!name || companyBySwordfishName.has(name)) continue
    companyBySwordfishName.set(name, addCompany({ name, swordfish: [name] }))
    problem(`"${name}" is not in the client configuration — imported as its own client. Check whether it belongs under an existing one.`)
  }

  const companyById = new Map(companies.map((c) => [c.id, c]))
  const scheduleFor = (companyId: string): CommissionSchedule | undefined => {
    const c = companyById.get(companyId)
    return c?.commission_bands ? { source: c.commission_bands_source ?? '', bands: c.commission_bands } : undefined
  }
  const rateForPrefix = (prefix: string): number | undefined => {
    for (const spec of walk(specs)) {
      const r = spec.commissionByPrefix?.[prefix]
      if (r !== undefined) return r
    }
    return undefined
  }

  /* -------------------------------------------------------------- handovers */

  /*
   * A handover is a batch the client actually sent: one client, one date. Keyed on the *real*
   * client, not the Swordfish record — Growthpoint's GPS3/1 and GPS3/2 rows dated 2024/05/14 are
   * one delivery of 67 accounts, split by commission tier for Swordfish's convenience and for no
   * reason that survives the migration.
   */
  const handovers: HandoverRow[] = []
  const handoverByKey = new Map<string, HandoverRow>()
  for (const r of accounts) {
    const companyId = companyBySwordfishName.get((r['Client'] ?? '').trim())
    const when = isoDate(r['Load Date'])
    if (!companyId || !when) continue
    const key = `${companyId}|${when}`
    let h = handoverByKey.get(key)
    if (!h) {
      h = {
        id: newId(),
        company_id: companyId,
        received_at: `${when}T00:00:00Z`,
        capital_amount: 0,
        accounts_count: 0,
        reference: null,
        notes: 'Migrated from Swordfish.',
        logged_by: ownerId,
      }
      handovers.push(h)
      handoverByKey.set(key, h)
    }
    h.accounts_count++
    h.capital_amount += num(r['Capital on Default']) ?? num(r['Handover Balance']) ?? 0
  }

  /* --------------------------------------------------------------- accounts */

  const debtorAccounts: DebtorAccountRow[] = []
  const accountByRef = new Map<string, DebtorAccountRow>()
  let commissionDrift = 0
  let commissionUnknown = 0

  for (const r of accounts) {
    const ref = (r['Swordfish Reference'] ?? '').trim()
    if (!ref) { problem('An account row has no Swordfish Reference and was skipped.'); continue }
    if (accountByRef.has(ref)) { problem(`${ref} appears twice in the summary; the second row was skipped.`); continue }

    const companyId = companyBySwordfishName.get((r['Client'] ?? '').trim())
    if (!companyId) { problem(`${ref} has no client and was skipped.`); continue }

    const loadDate = isoDate(r['Load Date']) ?? null
    const capital = num(r['Capital on Default']) ?? num(r['Handover Balance'])
    if (capital === undefined) problem(`${ref} has no capital figure. Imported at zero — it will read as a settled account until someone corrects it.`)

    // The rate Swordfish billed, read off the client record it was filed under.
    const prefix = (r['Client Prefix'] ?? '').trim()
    const billedRate = rateForPrefix(prefix)
    if (billedRate === undefined) {
      commissionUnknown++
      problem(`${ref}: prefix "${prefix}" has no rate in the client configuration — commission left unresolved.`)
    }

    // What the mandate calls for. Reported, never applied: see rule 1 in the header.
    const schedule = scheduleFor(companyId)
    const expected = schedule && capital !== undefined ? rateForCapital(capital, schedule) : undefined
    if (expected !== undefined && billedRate !== undefined
      && Math.round(expected * 10000) !== Math.round(billedRate * 10000)) commissionDrift++

    // Prescription: Swordfish gives days remaining rather than the date.
    const days = num(r['Days To Prescription'])
    let prescriptionDate: string | null = null
    if (days !== undefined) {
      const d = new Date(`${today}T00:00:00Z`)
      d.setUTCDate(d.getUTCDate() + Math.round(days))
      prescriptionDate = d.toISOString().slice(0, 10)
    }

    const a: DebtorAccountRow = {
      id: newId(),
      company_id: companyId,
      handover_id: loadDate ? handoverByKey.get(`${companyId}|${loadDate}`)?.id ?? null : null,
      swordfish_reference: ref,
      account_number: ref,
      client_reference: text(r['Client Reference']),
      legacy_reference: text(r['Old Client Reference']) ?? text(r['Previous Swordfish Reference']),

      debtor_first_name: text(r['First Name']),
      debtor_surname: text(r['Surname']),
      debtor_id_number: text(r['ID Number']),

      capital_handed_over: capital ?? 0,
      // At the opening position — the handover — capital outstanding is the capital handed over,
      // by definition. The payment ledger reduces it from there.
      capital_outstanding: capital ?? 0,
      // In duplum caps non-capital at the capital outstanding when the debt was handed over, so
      // the ceiling is that capital, not twice it — the *balance* may reach twice capital, which
      // is the same rule stated about a different number. Fixed here and never recalculated.
      in_duplum_ceiling: capital ?? 0,

      commission_rate: billedRate ?? null,
      commission_rate_expected: expected ?? null,
      commission_rate_source: schedule?.source ?? null,

      interest_rate_annual: num(r['Current Interest Rate']) ?? 24,
      interest_from: isoDate(r['Initial Interest Date']) ?? loadDate,

      prescribed: r['Is Prescribed'] === 'Yes',
      prescription_date: prescriptionDate,
      last_interrupted_at: null,

      // See rule 2 in the header: the opening position is the handover.
      opening_as_at: loadDate,
      opening_capital: capital ?? 0,
      opening_fees: 0,
      opening_interest: 0,

      status: text(r['Status']) ?? 'Active',
      sub_status: text(r['Sub-status']),
      bucket: text(r['Account Bucket']),
      assigned_to: null,
      diary_date: isoDate(r['Diary Date']) ?? null,

      in_duplum: r['In Duplum'] === 'Yes',
      write_off_reason: text(r['Write Off Reason']),
      handover_date: loadDate,
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
      legal_stage_date: isoDate(r['Date of Current Legal Stage']) ?? null,
      last_action_at: isoDate(r['Last Action Date']) ?? null,
      last_payment_at: isoDate(r['Last Payment Date']) ?? null,
      source: 'swordfish',
      imported_at: nowIso,
    }
    debtorAccounts.push(a)
    accountByRef.set(ref, a)
  }

  /* --------------------------------------------------------------- payments */

  const payments: PaymentRow[] = []
  let orphanPayments = 0
  for (const p of exports.payments) {
    const acc = accountByRef.get((p['Swordfish Reference'] ?? '').trim())
    if (!acc) { orphanPayments++; continue }
    const when = isoDate(p['Payment Date'])
    const amount = num(p['Payment Amount'])
    if (!when || amount === undefined) {
      problem(`A payment on ${p['Swordfish Reference']} has no date or amount and was skipped.`)
      continue
    }
    const type = (p['Payment Type'] ?? '').trim()
    const reversed = isoDate(p['Reversal Date'])
    payments.push({
      id: newId(),
      account_id: acc.id,
      received_at: `${when}T00:00:00Z`,
      amount,
      method: type || null,
      reference: text(p['Bank Reference']) ?? text(p['Voucher Number']),
      depositor_name: text(p['Payment Depositor Name']),
      details: text(p['Payment Details']),
      // The client took the money directly and owes us our share. Still a full payment on the
      // account; it settles in the month-end reconciliation rather than arriving in our trust
      // account. Read off Payment Type, which states it, rather than matched out of the free-text
      // details, which merely tend to mention it.
      paid_to_client: type === 'Client Direct',
      // No reversals in the migrated data, but a reversal is a fact about a payment and has to
      // survive the import if one ever appears in a later export.
      reversed_at: reversed ? `${reversed}T00:00:00Z` : null,
      reversal_reason: text(p['Reversal Reason']),
      source: 'swordfish',
    })
  }

  /* ------------------------------------------------------------------- fees */

  const fees: FeeRow[] = []
  let orphanActions = 0
  let unbilledEvents = 0
  let quarantined = 0
  let quarantinedValue = 0
  const unmappedCharged = new Map<string, { n: number; total: number }>()

  for (const a of exports.actions) {
    const acc = accountByRef.get((a['Swordfish Reference'] ?? '').trim())
    if (!acc) { orphanActions++; continue }
    const when = isoDate(a['Action Date'])
    if (!when) continue

    const name = (a['Action Name'] ?? '').trim()
    const excl = num(a['Action Cost (excl VAT)']) ?? 0
    const code = codeForLegacyName(name)

    // Most of what Swordfish records are audit events — a file uploaded, a sub-status changed.
    // They belong in the account's history but were never billable, so they import as fees of
    // zero rather than being dropped: the history is the point, not the money.
    if (!code && excl === 0) unbilledEvents++

    // A name nobody can classify keeps its history but not its money — a fee filed under a
    // guessed Annexure B item is a wrong statement waiting to be reissued.
    const held = isQuarantinedLegacyName(name)
    if (held) { quarantined++; quarantinedValue += excl }
    if (!code && excl > 0 && !held) {
      const cur = unmappedCharged.get(name) ?? { n: 0, total: 0 }
      cur.n++; cur.total += excl
      unmappedCharged.set(name, cur)
    }

    const cancelled = isoDate(a['Cancel Date']) ?? null
    fees.push({
      id: newId(),
      account_id: acc.id,
      annexure_item: null,
      tariff_effective_from: null,
      description: name || 'Action',
      amount_excl_vat: excl,
      vat_rate: num(a['Action VAT Rate']) ?? 15,
      vat_amount: num(a['Action VAT Charged']) ?? 0,
      // A held fee stays visible but out of the recoverable total until it is classified.
      counts_toward_fee_cap: !held,
      incurred_at: `${when}T00:00:00Z`,
      source: 'swordfish',
      payment_id: null,
      action_code: code ?? null,
      legacy_name: name || null,
      segments: Math.max(1, Math.round(num(a['SMS Count']) ?? 1)),
      // False for an action taken past the Annexure B ceiling, or one that was never chargeable.
      // Both are real history; neither is revenue.
      billed: excl > 0,
      expense_or_fee: text(a['Expense or Fee']),
      destination: text(a['Action Destination']),
      cancelled_at: cancelled,
      cancel_reason: text(a['Cancel Reason']),
      performed_by: text(a['User']),
      swordfish_action_id: text(a['Action ID']),
    })
  }
  for (const [name, v] of unmappedCharged) {
    problem(`${v.n} charged actions named "${name}" (R${v.total.toFixed(2)} excl VAT) have no catalogue entry. Imported at their charged price with no action code.`)
  }

  /* --------------------------------------------------------------- interest */

  const accruals: AccrualRow[] = []
  let orphanInterest = 0
  const seenPeriod = new Set<string>()
  for (const r of exports.interest) {
    const acc = accountByRef.get((r['Swordfish Reference'] ?? '').trim())
    if (!acc) { orphanInterest++; continue }
    const from = isoDate(r['Date From'])
    const to = isoDate(r['Date To'])
    if (!from || !to) continue
    const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400000))
    // The unique key is (account, start, days). Concurrent accrual streams legitimately share a
    // start date — 804 accounts do — but an identical period twice would double-count.
    const key = `${acc.id}|${from}|${days}`
    if (seenPeriod.has(key)) {
      problem(`${r['Swordfish Reference']}: the period ${from}..${to} appears twice; the second was skipped.`)
      continue
    }
    seenPeriod.add(key)
    const amount = num(r['Interest Added']) ?? 0
    accruals.push({
      id: newId(),
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

  /* ----------------------------------------------------------------- report */

  const orphanMessage = (n: number, what: string) =>
    `${n} ${what} belong to accounts not in this import and were skipped.`
  for (const [n, what] of [[orphanPayments, 'payments'], [orphanActions, 'actions'], [orphanInterest, 'interest periods']] as const) {
    if (!n) continue
    // On a slice that is the rest of the book, which is the point of a slice, not a fault.
    ;(only ? notes : problems).push(orphanMessage(n, what))
  }
  if (unbilledEvents) notes.push(`${unbilledEvents} actions were audit events with no charge. Imported as history at zero.`)
  if (quarantined) notes.push(`${quarantined} fees totalling R${quarantinedValue.toFixed(2)} excl VAT are held out of the recoverable total pending classification.`)

  const oddIds = debtorAccounts.filter((a) => a.debtor_id_number && !/^\d{13}$/.test(a.debtor_id_number)).length
  if (oddIds) notes.push(`${oddIds} accounts have something other than a 13-digit ID in the ID field. Imported as found — it is Swordfish's data, not a mapping fault.`)

  const chargedPerAccount = new Map<string, number>()
  for (const f of fees) chargedPerAccount.set(f.account_id, (chargedPerAccount.get(f.account_id) ?? 0) + f.amount_excl_vat)
  const ceiling = Math.max(0, ...chargedPerAccount.values())
  const feeCeilingHit = [...chargedPerAccount.values()].filter((v) => v >= ceiling * 0.75).length

  return {
    companies,
    handovers,
    debtorAccounts,
    payments,
    fees,
    accruals,
    problems,
    notes,
    stats: {
      capital: debtorAccounts.reduce((t, a) => t + a.capital_handed_over, 0),
      paid: payments.reduce((t, p) => t + p.amount, 0),
      paidToClient: payments.filter((p) => p.paid_to_client).length,
      feesInclVat: fees.reduce((t, f) => t + f.amount_excl_vat + f.vat_amount, 0),
      interest: accruals.reduce((t, i) => t + i.amount_accrued, 0),
      commissionDrift,
      commissionUnknown,
      feeCeilingHit,
      freeBillableActions: fees.filter((f) => f.action_code && !f.billed).length,
      unbilledEvents,
    },
  }
}

/**
 * The tables an import writes, in dependency order. Exported so the writer and the wipe agree
 * about what an import consists of, rather than each keeping its own list.
 */
export const IMPORT_TABLES = [
  'companies', 'handovers', 'debtor_accounts', 'account_payments', 'account_fees',
  'account_interest_accruals',
] as const

/**
 * What a wipe clears, in reverse dependency order.
 *
 * Deliberately an explicit list rather than every table: profiles, teams and targets are
 * configuration a person set up by hand, and an import must never be the thing that deletes them.
 */
export const WIPE_TABLES = [
  'account_interest_accruals', 'account_fees', 'payment_allocations', 'account_payments',
  'debtor_accounts', 'handovers', 'notifications', 'activities', 'tasks', 'proposals',
  'deals', 'contacts', 'leads', 'companies',
] as const

export function planRows(plan: ImportPlan): Record<(typeof IMPORT_TABLES)[number], object[]> {
  return {
    companies: plan.companies,
    handovers: plan.handovers,
    debtor_accounts: plan.debtorAccounts,
    account_payments: plan.payments,
    account_fees: plan.fees,
    account_interest_accruals: plan.accruals,
  }
}
